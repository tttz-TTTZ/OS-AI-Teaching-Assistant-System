import hashlib
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from app import main
from app.auth import create_user
from app.persistence import backup_data, restore_data, validate_backup


@pytest.fixture
def users(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "live" / "assistant.db")
    with TestClient(main.app) as client:
        for name, role in [
            ("teacher", "teacher"),
            ("admin", "teacher"),
            ("alice", "student"),
            ("bob", "student"),
        ]:
            create_user(name, "test-password-12345", role)
        with main.database() as db:
            db.execute("UPDATE users SET is_admin=1 WHERE username='admin'")
        yield client


def login(client, name, context=None):
    if context:
        client.headers["X-Session-Context"] = context
    else:
        client.headers.pop("X-Session-Context", None)
    r = client.post(
        "/api/auth/login", json={"username": name, "password": "test-password-12345"}
    )
    assert r.status_code == 200, r.text
    client.headers["X-CSRF-Token"] = r.json()["csrf_token"]
    return r.json()


def test_same_browser_contexts_and_file_links(users):
    c = users
    teacher = login(c, "teacher", "a" * 32)
    upload = c.post(
        "/api/materials/upload", files={"file": ("private.txt", b"teacher private")}
    )
    assert upload.status_code == 201
    did = upload.json()["id"]
    student = login(c, "alice", "b" * 32)
    assert c.get("/api/auth/me").json()["username"] == "alice"
    assert c.get(f"/api/materials/{did}/file").status_code == 404
    c.headers.pop("X-Session-Context")
    assert (
        c.get(f'/api/materials/{did}/file?session_context={"a"*32}').text
        == "teacher private"
    )
    assert (
        c.get(f'/api/materials/{did}/file?session_context={"b"*32}').status_code == 404
    )
    c.headers["X-Session-Context"] = "b" * 32
    assert c.post("/api/auth/logout").status_code == 204
    assert c.get("/api/auth/me").status_code == 401
    c.headers["X-Session-Context"] = "a" * 32
    c.headers["X-CSRF-Token"] = teacher["csrf_token"]
    assert c.get("/api/auth/me").json()["username"] == "teacher"
    assert (
        c.get("/api/auth/me", headers={"X-Session-Context": "invalid"}).status_code
        == 400
    )


def test_account_roles_reset_disable_and_self_password(users):
    c = users
    login(c, "teacher")
    assert all(u["role"] == "student" for u in c.get("/api/teacher/accounts").json())
    assert (
        c.post(
            "/api/teacher/accounts",
            json={
                "username": "badteacher",
                "password": "long-test-password",
                "role": "teacher",
            },
        ).status_code
        == 403
    )
    r = c.post(
        "/api/teacher/accounts",
        json={"username": "newstudent", "password": "long-test-password"},
    )
    assert r.status_code == 201
    sid = r.json()["id"]
    assert "password_hash" not in r.json()
    assert (
        c.post(
            "/api/teacher/accounts",
            json={"username": "newstudent", "password": "long-test-password"},
        ).status_code
        == 409
    )
    with TestClient(main.app) as second:
        me = login(second, "alice")
        aid = me["id"]
        assert (
            c.put(
                f"/api/teacher/accounts/{aid}/status", json={"active": False}
            ).status_code
            == 200
        )
        assert second.get("/api/auth/me").status_code == 401
        assert (
            c.put(
                f"/api/teacher/accounts/{aid}/status", json={"active": True}
            ).status_code
            == 200
        )
        login(second, "alice")
        assert (
            c.post(
                f"/api/teacher/accounts/{aid}/password",
                json={"password": "new-password-98765"},
            ).status_code
            == 204
        )
        assert second.get("/api/auth/me").status_code == 401
        assert (
            second.post(
                "/api/auth/login",
                json={"username": "alice", "password": "test-password-12345"},
            ).status_code
            == 401
        )
    login(c, "admin")
    created = c.post(
        "/api/teacher/accounts",
        json={
            "username": "secondteacher",
            "password": "long-test-password",
            "role": "teacher",
        },
    )
    assert created.status_code == 201
    me = c.get("/api/auth/me").json()
    assert (
        c.put(
            f"/api/teacher/accounts/{me['id']}/status", json={"active": False}
        ).status_code
        == 409
    )
    assert (
        c.post(
            "/api/auth/password",
            json={"current_password": "wrong", "new_password": "new-password-54321"},
        ).status_code
        == 400
    )
    assert (
        c.post(
            "/api/auth/password",
            json={
                "current_password": "test-password-12345",
                "new_password": "new-password-54321",
            },
        ).status_code
        == 204
    )
    assert c.get("/api/auth/me").status_code == 200
    assert (
        c.post(
            "/api/teacher/accounts", json={"username": "short", "password": "short"}
        ).status_code
        == 422
    )
    login(c, "bob")
    assert c.get("/api/teacher/accounts").status_code == 403


def test_document_version_recycle_and_scoped_dedup(users):
    c = users
    login(c, "teacher")
    first = c.post(
        "/api/materials/upload",
        files={"file": ("notes.txt", b"original")},
        data={"category": "public"},
    ).json()
    did = first["id"]
    assert len(first["sha256"]) == 64
    assert (
        c.post(
            "/api/materials/upload",
            files={"file": ("duplicate.txt", b"original")},
            data={"category": "public"},
        ).status_code
        == 409
    )
    assert (
        c.put(
            f"/api/teacher/documents/{did}",
            json={
                "title": "notes",
                "published": True,
                "source_title": "my notes",
                "summary": "summary",
            },
        ).status_code
        == 200
    )
    assert (
        c.post(
            f"/api/materials/{did}/replace", files={"file": ("new.txt", b"new version")}
        ).status_code
        == 200
    )
    assert not c.get(f"/api/materials/{did}").json()["published"]
    assert c.get(f"/api/materials/{did}/file").text == "new version"
    assert len(c.get(f"/api/materials/{did}/versions").json()) == 1
    assert len(list((main.DB_PATH.parent / "uploads").iterdir())) == 2
    assert c.delete(f"/api/materials/{did}").status_code == 204
    assert c.get(f"/api/materials/{did}/file").status_code == 404
    assert c.get("/api/teacher/documents?trash=true").json()[0]["id"] == did
    assert c.post(f"/api/materials/{did}/restore").status_code == 200
    assert c.get(f"/api/materials/{did}/file").text == "new version"
    assert not c.get(f"/api/materials/{did}").json()["published"]
    login(c, "alice")
    assert (
        c.post(
            "/api/materials/upload", files={"file": ("personal.txt", b"original")}
        ).status_code
        == 201
    )
    assert c.post(f"/api/materials/{did}/restore").status_code == 403
    # list只有元数据，正文必须单独请求。
    assert all("content" not in d for d in c.get("/api/materials").json())


def test_public_large_pdf_and_personal_limit(users):
    c = users
    login(c, "teacher")
    large = b"%PDF-1.4\n" + b"x" * (11 * 1024 * 1024)
    r = c.post(
        "/api/materials/upload",
        files={"file": ("large.pdf", large)},
        data={"category": "public"},
    )
    assert r.status_code == 201, r.text
    login(c, "alice")
    assert (
        c.post(
            "/api/materials/upload", files={"file": ("large.pdf", large)}
        ).status_code
        == 413
    )
    assert c.get("/api/config").json()["public_upload_limit_bytes"] == 150 * 1024 * 1024


def test_backup_restart_restore_and_tamper(users, tmp_path, monkeypatch):
    c = users
    login(c, "alice")
    r = c.post(
        "/api/materials/upload",
        files={"file": ("mine.txt", b"persistent private content")},
    )
    assert r.status_code == 201
    did = r.json()["id"]
    old_path = main.DB_PATH
    with TestClient(main.app) as restart:
        login(restart, "alice")
        assert (
            restart.get(f"/api/materials/{did}/file").text
            == "persistent private content"
        )
    folder = backup_data(old_path, tmp_path / "backup")
    validate_backup(folder)
    restored = restore_data(folder, tmp_path / "restored")
    monkeypatch.setattr(main, "DB_PATH", restored)
    with TestClient(main.app) as rebuilt:
        assert rebuilt.get("/api/auth/me").status_code == 401
        login(rebuilt, "alice")
        assert (
            rebuilt.get(f"/api/materials/{did}/file").text
            == "persistent private content"
        )
        login(rebuilt, "bob")
        assert rebuilt.get(f"/api/materials/{did}/file").status_code == 404
    with pytest.raises(ValueError):
        restore_data(folder, tmp_path / "restored")
    file = next((folder / "uploads").iterdir())
    file.write_bytes(b"corrupt")
    with pytest.raises(ValueError):
        validate_backup(folder)
    assert old_path.exists()


def test_textbook_alignment_preserves_associations(users):
    c = users
    login(c, "teacher")
    r = c.post(
        "/api/materials/upload",
        files={"file": ("chapter.pdf", b"%PDF-1.4\nnotes")},
        data={"category": "public", "chapter_id": "3"},
    )
    assert r.status_code == 201, r.text
    did = r.json()["id"]
    before = c.get("/api/teacher/textbook/plan").json()
    assert len(before["changes"]) == 7
    assert (
        c.post("/api/teacher/textbook/apply", json={"fingerprint": "wrong"}).status_code
        == 409
    )
    assert (
        c.post(
            "/api/teacher/textbook/apply", json={"fingerprint": before["fingerprint"]}
        ).status_code
        == 200
    )
    chapters = c.get("/api/chapters").json()
    assert len(chapters) == 7 and [x["textbook_number"] for x in chapters] == list(
        range(1, 8)
    )
    processor = next(x for x in chapters if x["textbook_number"] == 2)
    assert c.get(f"/api/materials/{did}").json()["chapter_id"] == processor["id"]
    assert c.get("/api/knowledge/3").json()["chapter_id"] == processor["id"]
    again = c.get("/api/teacher/textbook/plan").json()
    assert (
        c.post(
            "/api/teacher/textbook/apply", json={"fingerprint": again["fingerprint"]}
        ).status_code
        == 200
    )
    assert len(c.get("/api/chapters").json()) == 7
    assert list((main.DB_PATH.parent / "backups").glob("textbook-*/manifest.json"))
