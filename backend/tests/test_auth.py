import hashlib
import time
import pytest
from fastapi.testclient import TestClient
from app import main
from app.auth import create_user


@pytest.fixture
def clients(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "auth.db")
    with TestClient(main.app) as admin, TestClient(main.app) as alice, TestClient(
        main.app
    ) as bob:
        for name, role in [
            ("teacher", "teacher"),
            ("alice", "student"),
            ("bob", "student"),
        ]:
            create_user(name, "test-password-12345", role)
        for c, name in [(admin, "teacher"), (alice, "alice"), (bob, "bob")]:
            r = c.post(
                "/api/auth/login",
                json={"username": name, "password": "test-password-12345"},
            )
            assert r.status_code == 200, r.text
            c.headers["X-CSRF-Token"] = r.json()["csrf_token"]
        yield admin, alice, bob


def test_sessions_and_csrf(clients):
    admin, alice, bob = clients
    assert admin.get("/api/auth/me").json()["role"] == "teacher"
    assert alice.get("/api/auth/me").json()["role"] == "student"
    with main.database() as db:
        user = db.execute("SELECT * FROM users WHERE username='alice'").fetchone()
        assert user["password_hash"].startswith("$argon2id$")
        assert db.execute("SELECT count(*) FROM sessions").fetchone()[0] == 3
    csrf = alice.headers.pop("X-CSRF-Token")
    assert alice.post("/api/materials", json={"title": "x"}).status_code == 403
    alice.headers["X-CSRF-Token"] = csrf
    token = alice.cookies.get("os_session")
    assert alice.post("/api/auth/logout").status_code == 204
    assert alice.get("/api/auth/me").status_code == 401
    alice.cookies.set("os_session", token)
    assert alice.get("/api/materials").status_code == 401
    with main.database() as db:
        db.execute("UPDATE sessions SET expires_at=?", (int(time.time()) - 1,))
    assert bob.get("/api/auth/me").status_code == 401


def test_personal_access_all_paths(clients, monkeypatch):
    admin, alice, bob = clients
    monkeypatch.setenv("LLM_MODE", "mock")
    r = alice.post("/api/materials/upload", files={"file": ("mine.txt", b"private")})
    assert r.status_code == 201, r.text
    mid = r.json()["id"]
    assert alice.get(f"/api/materials/{mid}/file").text == "private"
    for other in [admin, bob]:
        assert all(d["id"] != mid for d in other.get("/api/materials").json())
        assert other.get(f"/api/materials/{mid}").status_code == 404
        assert other.get(f"/api/materials/{mid}/file").status_code == 404
        assert (
            other.put(f"/api/materials/{mid}", json={"title": "hack"}).status_code
            == 404
        )
        assert other.delete(f"/api/materials/{mid}").status_code == 404
        assert (
            other.post(
                "/api/chat", json={"question": "read", "material_id": mid}
            ).status_code
            == 404
        )
    assert (
        alice.post(
            "/api/chat", json={"question": "read", "material_id": mid}
        ).status_code
        == 200
    )
    assert alice.get("/api/conversations").json()
    assert bob.get("/api/conversations").json() == []


def test_wrong_login_and_origin(clients):
    _, alice, _ = clients
    assert (
        alice.post(
            "/api/auth/login", json={"username": "alice", "password": "wrong"}
        ).status_code
        == 401
    )
    assert (
        alice.post(
            "/api/auth/login", json={"username": "nobody", "password": "wrong"}
        ).status_code
        == 401
    )
    assert (
        alice.post(
            "/api/auth/login",
            json={"username": "alice", "password": "test-password-12345"},
            headers={"Origin": "https://evil.example"},
        ).status_code
        == 403
    )


def test_teacher_crud_publication_and_student_denied(clients):
    admin, alice, _ = clients
    for path in [
        "/api/teacher/chapters",
        "/api/teacher/knowledge",
        "/api/teacher/documents",
        "/api/teacher/questions",
    ]:
        assert alice.get(path).status_code == 403
    assert (
        alice.post("/api/teacher/chapters", json={"title": "越权"}).status_code == 403
    )
    body = {
        "title": "测试章",
        "description": "草稿",
        "sort_order": 99,
        "published": False,
    }
    r = admin.post("/api/teacher/chapters", json=body)
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    assert all(c["id"] != cid for c in alice.get("/api/chapters").json())
    k = admin.post(
        "/api/teacher/knowledge",
        json={
            "chapter_id": cid,
            "title": "测试知识点",
            "content": "内容",
            "published": True,
        },
    )
    assert k.status_code == 201, k.text
    kid = k.json()["id"]
    assert alice.get(f"/api/knowledge/{kid}").status_code == 404
    assert (
        admin.put(
            f"/api/teacher/chapters/{cid}",
            json={**body, "published": True, "sort_order": 0},
        ).status_code
        == 200
    )
    assert alice.get("/api/chapters").json()[0]["id"] == cid
    assert alice.get(f"/api/knowledge/{kid}").status_code == 200
    assert (
        admin.put(
            f"/api/teacher/knowledge/{kid}",
            json={
                "chapter_id": cid,
                "title": "修改知识点",
                "content": "更新",
                "published": False,
            },
        ).status_code
        == 200
    )
    assert alice.get(f"/api/knowledge/{kid}").status_code == 404
    assert admin.delete(f"/api/teacher/chapters/{cid}").status_code == 409
    empty = admin.post("/api/teacher/chapters", json={"title": "可删空章"}).json()["id"]
    assert admin.delete(f"/api/teacher/chapters/{empty}").status_code == 204
    assert (
        alice.put(
            f"/api/teacher/knowledge/{kid}",
            json={"chapter_id": cid, "title": "hack", "content": "hack"},
        ).status_code
        == 403
    )
    assert (
        alice.post(
            "/api/labs/fcfs",
            json={"processes": [{"pid": "P", "arrival": 0, "burst": 2}]},
        ).json()["results"][0]["completion"]
        == 2
    )


def test_public_upload_linking_and_parent_visibility(clients):
    admin, alice, bob = clients
    assert (
        alice.post(
            "/api/materials/upload",
            files={"file": ("hack.txt", b"x")},
            data={"category": "public"},
        ).status_code
        == 403
    )
    r = admin.post(
        "/api/materials/upload",
        files={"file": ("course.txt", b"public notes")},
        data={"category": "public", "chapter_id": "3"},
    )
    assert r.status_code == 201, r.text
    did = r.json()["id"]
    assert r.json()["category"] == "public" and not r.json()["published"]
    assert alice.get(f"/api/materials/{did}/file").status_code == 404
    body = {
        "title": "公开资料",
        "chapter_id": 3,
        "knowledge_ids": [3],
        "published": True,
    }
    assert alice.put(f"/api/teacher/documents/{did}", json=body).status_code == 403
    assert admin.put(f"/api/teacher/documents/{did}", json=body).status_code == 200
    assert alice.get(f"/api/materials/{did}/file").text == "public notes"
    assert did in [m["id"] for m in alice.get("/api/knowledge/3").json()["materials"]]
    assert alice.delete(f"/api/materials/{did}").status_code == 403
    with main.database() as db:
        db.execute("UPDATE chapters SET published=0 WHERE id=3")
    assert bob.get("/api/knowledge/3").status_code == 404
    assert bob.get(f"/api/materials/{did}/file").status_code == 404
    assert all(d["id"] != did for d in bob.get("/api/materials").json())
    with main.database() as db:
        db.execute("UPDATE chapters SET published=1 WHERE id=3")
        db.execute("UPDATE courses SET published=0 WHERE id=1")
    assert bob.get(f"/api/materials/{did}/file").status_code == 404
    with main.database() as db:
        db.execute("UPDATE courses SET published=1 WHERE id=1")
    assert (
        admin.put(
            f"/api/teacher/documents/{did}", json={**body, "published": False}
        ).status_code
        == 200
    )
    assert bob.get(f"/api/materials/{did}/file").status_code == 404
    assert admin.delete(f"/api/materials/{did}").status_code == 204
    with main.database() as db:
        assert (
            db.execute(
                "SELECT count(*) FROM document_knowledge_points WHERE document_id=?",
                (did,),
            ).fetchone()[0]
            == 0
        )


def test_migration_backup_and_idempotence(tmp_path, monkeypatch):
    import sqlite3
    from app.migrations import migrate

    path = tmp_path / "legacy.db"
    upload = tmp_path / "uploads"
    upload.mkdir()
    (upload / "old.txt").write_bytes(b"old personal file")
    with sqlite3.connect(path) as db:
        db.execute(
            "CREATE TABLE materials(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,content TEXT NOT NULL,chapter TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,category TEXT NOT NULL DEFAULT 'personal',original_name TEXT,stored_name TEXT,file_size INTEGER,file_type TEXT)"
        )
        db.execute(
            "INSERT INTO materials(id,title,content,stored_name,file_type) VALUES(42,'Important','original','old.txt','txt')"
        )
        db.execute(
            "CREATE TABLE conversations(id INTEGER PRIMARY KEY AUTOINCREMENT,material_id INTEGER,question TEXT NOT NULL,answer TEXT NOT NULL,model TEXT NOT NULL,mode TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
        )
        db.execute(
            "INSERT INTO conversations(material_id,question,answer,model,mode) VALUES(42,'private q','private answer','mock','mock')"
        )
    migrate(path)
    snapshots = list((tmp_path / "backups").iterdir())
    assert len(snapshots) == 1
    assert (snapshots[0] / "uploads/old.txt").read_bytes() == b"old personal file"
    with sqlite3.connect(snapshots[0] / "legacy.db") as db:
        assert (
            db.execute("SELECT title FROM materials WHERE id=42").fetchone()[0]
            == "Important"
        )
    migrate(path)
    assert len(list((tmp_path / "backups").iterdir())) == 1
    monkeypatch.setattr(main, "DB_PATH", path)
    with TestClient(main.app) as c:
        create_user("newstudent", "only-a-test-password", "student")
        login = c.post(
            "/api/auth/login",
            json={"username": "newstudent", "password": "only-a-test-password"},
        )
        assert login.status_code == 200
        assert c.get("/api/materials/42").status_code == 404
        assert c.get("/api/materials/42/file").status_code == 404
        assert c.get("/api/conversations").json() == []
        with main.database() as db:
            row = db.execute("SELECT * FROM documents WHERE id=42").fetchone()
            assert (
                row["title"] == "Important"
                and row["content"] == "original"
                and row["stored_name"] == "old.txt"
                and row["owner_id"] is None
            )
            assert (
                db.execute("SELECT answer,user_id FROM conversations").fetchone()[
                    "answer"
                ]
                == "private answer"
            )
            assert db.execute("PRAGMA quick_check").fetchone()[0] == "ok"


def test_all_mutations_require_csrf_and_teacher_role(clients):
    teacher, alice, bob = clients
    operations = [
        ("POST", "/api/teacher/chapters", {"title": "x"}),
        ("PUT", "/api/teacher/chapters/1", {"title": "x"}),
        ("DELETE", "/api/teacher/chapters/1", None),
        (
            "POST",
            "/api/teacher/knowledge",
            {"title": "x", "content": "x", "chapter_id": 1},
        ),
        (
            "PUT",
            "/api/teacher/knowledge/1",
            {"title": "x", "content": "x", "chapter_id": 1},
        ),
        (
            "POST",
            "/api/teacher/questions",
            {"prompt": "x", "chapter_id": 1, "options": ["a", "b"], "answer": 0},
        ),
        (
            "PUT",
            "/api/teacher/questions/1",
            {"prompt": "x", "chapter_id": 1, "options": ["a", "b"], "answer": 0},
        ),
    ]
    for method, path, body in operations:
        r = alice.request(method, path, json=body)
        assert r.status_code == 403 and "教师" in r.json()["detail"]
    csrf = teacher.headers.pop("X-CSRF-Token")
    assert teacher.post("/api/teacher/chapters", json={"title": "x"}).status_code == 403
    teacher.headers["X-CSRF-Token"] = csrf
    # 身份、角色都不能由资料写入参数伪造。
    r = alice.post(
        "/api/materials",
        json={
            "title": "mine",
            "owner_id": bob.get("/api/auth/me").json()["id"],
            "category": "public",
            "published": True,
        },
    )
    assert (
        r.status_code == 201
        and r.json()["owner_id"] == alice.get("/api/auth/me").json()["id"]
        and r.json()["category"] == "personal"
    )
    assert r.headers["cache-control"] == "no-store"


def test_draft_questions_and_course_filter(clients):
    t, s, _ = clients
    q = t.post(
        "/api/teacher/questions",
        json={
            "chapter_id": 1,
            "prompt": "Draft?",
            "options": ["yes", "no"],
            "answer": 0,
            "published": False,
        },
    ).json()
    assert all(
        item["id"] != q["id"] for item in s.get("/api/questions?chapter_id=1").json()
    )
    assert (
        s.post("/api/practice/submit", json={"answers": {str(q["id"]): 0}}).status_code
        == 404
    )
    with main.database() as db:
        db.execute("UPDATE courses SET published=0 WHERE id=1")
    assert s.get("/api/courses").json() == []
    assert s.get("/api/chapters").json() == []
    assert s.get("/api/knowledge").json() == []
    assert s.get("/api/questions?chapter_id=1").status_code == 404
    assert t.get("/api/courses").json()


def test_legacy_text_write_tracks_chapter_id(clients):
    _, student, _ = clients
    r = student.post(
        "/api/materials",
        json={"title": "个人笔记", "chapter": "进程与线程", "content": "text"},
    )
    assert r.status_code == 201 and r.json()["chapter_id"] == 2
    mid = r.json()["id"]
    r = student.put(
        f"/api/materials/{mid}", json={"title": "更新", "chapter": "处理机调度"}
    )
    assert r.status_code == 200 and r.json()["chapter_id"] == 3
    assert (
        student.post(
            "/api/materials", json={"title": "unknown", "chapter": "不存在的章节"}
        ).status_code
        == 422
    )
