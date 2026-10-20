import hashlib
from io import BytesIO
from pathlib import Path
import runpy
from zipfile import ZipFile
import pytest
from fastapi.testclient import TestClient
from app import main, files
from app.auth import create_user
from app.persistence import backup_data, restore_data

fixtures = runpy.run_path(
    str(Path(__file__).resolve().parents[2] / "scripts/presentation_fixture.py")
)
pptx_bytes, ppt_bytes = fixtures["pptx_bytes"], fixtures["ppt_bytes"]


@pytest.fixture
def clients(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "data" / "test.db")
    with TestClient(main.app) as teacher, TestClient(main.app) as student, TestClient(
        main.app
    ) as other:
        for c, name, role in [
            (teacher, "teacher", "teacher"),
            (student, "student", "student"),
            (other, "other", "student"),
        ]:
            create_user(name, "presentation-test-password", role)
            r = c.post(
                "/api/auth/login",
                json={"username": name, "password": "presentation-test-password"},
            )
            c.headers["X-CSRF-Token"] = r.json()["csrf_token"]
        yield teacher, student, other


def publish(c, ident):
    return c.put(
        f"/api/teacher/documents/{ident}",
        json={
            "title": "课堂课件",
            "chapter_id": 1,
            "knowledge_ids": [1],
            "published": True,
        },
    )


def test_400_slides_public_private_and_backup(clients, tmp_path):
    t, s, o = clients
    content = pptx_bytes(reverse=True, media_bytes=11 * 1024 * 1024)
    r = t.post(
        "/api/materials/upload",
        data={"category": "public", "chapter_id": 1},
        files={"file": ("400页.pptx", content)},
    )
    assert r.status_code == 201, r.text
    d = r.json()
    ident = d["id"]
    url = f"/api/materials/{ident}"
    assert (
        d["file_size"] > 10 * 1024 * 1024
        and d["sha256"] == hashlib.sha256(content).hexdigest()
    )
    assert s.get(url + "/slides").status_code == 404
    assert publish(t, ident).status_code == 200
    pages = s.get(url + "/slides?offset=390&limit=10").json()
    assert pages["total"] == 400 and len(pages["slides"]) == 10
    assert (
        pages["slides"][-1]["number"] == 400
        and pages["slides"][-1]["text"] == "演示第1页"
    )
    assert s.get(url + "/slides").json()["slides"][0]["text"] == "演示第400页"
    assert s.get(url + "/slides?limit=1000").status_code == 422
    download = s.get(url + "/file")
    assert download.content == content
    assert (
        download.headers["content-type"]
        == "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    )
    assert download.headers["content-disposition"].startswith("attachment")
    private = s.post(
        "/api/materials/upload", files={"file": ("private.pptx", pptx_bytes(3))}
    ).json()["id"]
    for viewer in [t, o]:
        assert viewer.get(f"/api/materials/{private}/slides").status_code == 404
        assert viewer.get(f"/api/materials/{private}/file").status_code == 404
    assert s.get(f"/api/materials/{private}/slides").json()["total"] == 3
    snapshot = backup_data(main.DB_PATH, tmp_path / "snapshot")
    restored = restore_data(snapshot, tmp_path / "restored")
    assert (restored.parent / "uploads" / d["stored_name"]).read_bytes() == content


def test_replacement_reverts_to_draft_and_preserves_file_version(clients):
    t, s, _ = clients
    old = pptx_bytes(400)
    d = t.post(
        "/api/materials/upload",
        data={"category": "public"},
        files={"file": ("book.pptx", old)},
    ).json()
    publish(t, d["id"])
    changed = t.post(
        f'/api/materials/{d["id"]}/replace', files={"file": ("new.pptx", pptx_bytes(2))}
    )
    assert changed.status_code == 200, changed.text
    assert not changed.json()["published"]
    assert s.get(f'/api/materials/{d["id"]}/slides').status_code == 404
    assert (files.storage() / d["stored_name"]).read_bytes() == old
    assert len(t.get(f'/api/materials/{d["id"]}/versions').json()) == 1
    assert publish(t, d["id"]).status_code == 200
    assert s.get(f'/api/materials/{d["id"]}/slides').json()["total"] == 2


@pytest.mark.parametrize(
    "name,content",
    [
        ("wrong.pptx", b"not a zip"),
        ("wrong.ppt", b"not an ole"),
        ("macros.pptm", b"no"),
        ("bad.pptx", b"PK\x03\x04"),
    ],
)
def test_bad_presentations_leave_no_files(clients, name, content):
    t, _, _ = clients
    with main.database() as db:
        count = db.execute("SELECT count(*) FROM documents").fetchone()[0]
    r = t.post(
        "/api/materials/upload",
        data={"category": "public"},
        files={"file": (name, content)},
    )
    assert r.status_code == 415, r.text
    with main.database() as db:
        assert db.execute("SELECT count(*) FROM documents").fetchone()[0] == count
    assert not list((main.DB_PATH.parent / ".incoming").glob("*"))


def test_legacy_ppt_download_and_explicit_preview_limit(clients):
    t, _, _ = clients
    raw = ppt_bytes()
    r = t.post(
        "/api/materials/upload",
        data={"category": "public"},
        files={"file": ("old.ppt", raw)},
    )
    assert r.status_code == 201, r.text
    ident = r.json()["id"]
    assert t.get(f"/api/materials/{ident}/file").content == raw
    assert (
        t.get(f"/api/materials/{ident}/file").headers["content-type"]
        == "application/vnd.ms-powerpoint"
    )
    assert t.get(f"/api/materials/{ident}/slides").status_code == 415


def test_limits_and_zip_traversal(clients, monkeypatch):
    t, s, _ = clients
    monkeypatch.setattr(files, "PUBLIC_PRESENTATION_MAX_SIZE", 32 * 1024)
    r = t.post(
        "/api/materials/upload",
        data={"category": "public"},
        files={"file": ("oversize.pptx", pptx_bytes(1, media_bytes=64 * 1024))},
    )
    assert r.status_code == 413
    attack = BytesIO(pptx_bytes(1))
    with ZipFile(attack, "a") as book:
        book.writestr("../bad.xml", "<a/>")
    assert (
        t.post(
            "/api/materials/upload",
            data={"category": "public"},
            files={"file": ("bad.pptx", attack.getvalue())},
        ).status_code
        == 415
    )
    assert (
        s.post(
            "/api/materials/upload",
            data={"category": "public"},
            files={"file": ("x.pptx", pptx_bytes(1))},
        ).status_code
        == 403
    )
    config = s.get("/api/config").json()
    assert config["personal_presentation_upload_limit_bytes"] == 50 * 1024 * 1024
