import json
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from app import main
from app.auth import create_user
from app.chapter_apply import auto_apply_chapter
from app.persistence import restore_data
import sqlite3


@pytest.fixture
def clients(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "data" / "assistant.db")
    with TestClient(main.app) as t, TestClient(main.app) as s:
        for c, name, role in [(t, "teacher", "teacher"), (s, "student", "student")]:
            create_user(name, "chapter-apply-test-password", role)
            response = c.post(
                "/api/auth/login",
                json={"username": name, "password": "chapter-apply-test-password"},
            )
            c.headers["X-CSRF-Token"] = response.json()["csrf_token"]
        yield t, s


def test_direct_replace_publication_backup_and_scope(clients, tmp_path):
    t, s = clients
    with main.database() as db:
        old_id = db.execute(
            "SELECT id FROM knowledge_points WHERE chapter_id=1"
        ).fetchone()[0]
        other = [
            tuple(r)
            for r in db.execute("SELECT * FROM knowledge_points WHERE chapter_id<>1")
        ]
        uid = db.execute("SELECT id FROM users WHERE username='student'").fetchone()[0]
        db.execute(
            "INSERT INTO knowledge_progress(user_id,point_id,revision_id,note) VALUES (?,?,0,?)",
            (uid, old_id, "我的旧笔记"),
        )
        docs = [tuple(r) for r in db.execute("SELECT * FROM documents")]
    url = "/api/teacher/chapter-content/chapter01/apply"
    assert s.post(url, json={"chapter_id": 1}).status_code == 403
    r = t.post(url, json={"chapter_id": 1})
    assert r.status_code == 200, r.text
    applied = r.json()
    assert applied["direct_applied"] and applied["published_count"] == 16
    assert Path(applied["backup"], "manifest.json").is_file()
    points = s.get("/api/learning-content?chapter_id=1").json()
    assert len(points) == 16 and old_id not in [p["id"] for p in points]
    assert len(s.get("/api/knowledge?chapter_id=1").json()) == 16
    assert s.get(f"/api/knowledge/{old_id}").status_code == 404
    assert s.get("/api/experiments/" + str(applied["experiment_id"])).status_code == 200
    with main.database() as db:
        assert [
            tuple(r)
            for r in db.execute("SELECT * FROM knowledge_points WHERE chapter_id<>1")
        ] == other
        assert [tuple(r) for r in db.execute("SELECT * FROM documents")] == docs
        assert (
            db.execute(
                "SELECT note FROM knowledge_progress WHERE point_id=?", (old_id,)
            ).fetchone()[0]
            == "我的旧笔记"
        )
        assert db.execute(
            "SELECT archived_at FROM knowledge_points WHERE id=?", (old_id,)
        ).fetchone()[0]
    restored = restore_data(Path(applied["backup"]), tmp_path / "restored")
    with sqlite3.connect(restored) as db:
        assert (
            db.execute(
                "SELECT archived_at FROM knowledge_points WHERE id=?", (old_id,)
            ).fetchone()[0]
            is None
        )
        assert (
            db.execute(
                "SELECT note FROM knowledge_progress WHERE point_id=?", (old_id,)
            ).fetchone()[0]
            == "我的旧笔记"
        )
    again = t.post(url, json={"chapter_id": 1}).json()
    assert again["already_applied"]
    assert t.post(url, json={"chapter_id": 2}).status_code == 409


def test_startup_applies_once_and_preserves_later_edits(clients, monkeypatch):
    t, s = clients
    monkeypatch.setenv("CHAPTER01_AUTO_APPLY", "1")
    with TestClient(main.app):
        pass
    status = t.get("/api/teacher/chapter-content/chapter01/application").json()[
        "applications"
    ]
    assert len(status) == 1
    p = status[0]["points"][0]
    detail = t.get("/api/teacher/learning-content/" + str(p["id"])).json()
    keys = [
        "chapter_id",
        "section_id",
        "code",
        "title",
        "summary",
        "sort_order",
        "minutes",
        "emphasis",
        "objectives",
        "source_title",
        "printed_pages",
        "pdf_pages",
        "source_note",
        "blocks",
        "related_ids",
        "lab",
    ]
    payload = {k: detail[k] for k in keys}
    payload.update(title="之后人工修改的标题", expected_version=detail["edit_version"])
    assert (
        t.put("/api/teacher/learning-content/" + str(p["id"]), json=payload).status_code
        == 200
    )
    with main.database() as db:
        before = db.execute("SELECT count(*) FROM knowledge_revisions").fetchone()[0]
    with TestClient(main.app):
        pass
    assert (
        t.get("/api/teacher/learning-content/" + str(p["id"])).json()["title"]
        == "之后人工修改的标题"
    )
    with main.database() as db:
        assert (
            db.execute("SELECT count(*) FROM knowledge_revisions").fetchone()[0]
            == before
        )
    assert (
        len(list((main.DB_PATH.parent / "backups").glob("before-chapter01-apply-*")))
        == 1
    )


def test_existing_drafts_are_applied_without_manual_review(clients):
    t, s = clients
    draft = t.post(
        "/api/teacher/chapter-content/chapter01/import", json={"chapter_id": 1}
    ).json()
    # Simulate a previously shipped content package hash; explicit replacement is allowed.
    with main.database() as db:
        db.execute("UPDATE chapter_content_imports SET package_hash='previous-version'")
    r = t.post("/api/teacher/chapter-content/chapter01/apply", json={"chapter_id": 1})
    assert r.status_code == 200, r.text
    assert r.json()["experiment_id"] == draft["experiment_id"]
    assert [p["id"] for p in r.json()["points"]] == [p["id"] for p in draft["points"]]
    assert len(s.get("/api/learning-content?chapter_id=1").json()) == 16
    assert (
        "草稿"
        not in s.get("/api/experiments/" + str(draft["experiment_id"])).json()["title"]
    )


def test_invalid_rr_rolls_back_replacement(clients):
    t, _ = clients
    draft = t.post(
        "/api/teacher/chapter-content/chapter01/import", json={"chapter_id": 1}
    ).json()
    with main.database() as db:
        exp = db.execute(
            "SELECT draft_revision_id FROM experiments WHERE id=?",
            (draft["experiment_id"],),
        ).fetchone()[0]
        body = json.loads(
            db.execute(
                "SELECT body FROM experiment_revisions WHERE id=?", (exp,)
            ).fetchone()[0]
        )
        body["defaults"]["quantum"] = 3
        db.execute(
            "UPDATE experiment_revisions SET body=? WHERE id=?", (json.dumps(body), exp)
        )
        before = [tuple(r) for r in db.execute("SELECT * FROM knowledge_points")]
    r = t.post("/api/teacher/chapter-content/chapter01/apply", json={"chapter_id": 1})
    assert r.status_code == 409
    with main.database() as db:
        assert [
            tuple(r) for r in db.execute("SELECT * FROM knowledge_points")
        ] == before
        assert not json.loads(
            db.execute("SELECT result_json FROM chapter_content_imports").fetchone()[0]
        ).get("direct_applied")


def test_ambiguous_first_chapter_is_not_guessed(clients, monkeypatch):
    with main.database() as db:
        db.execute("UPDATE chapters SET textbook_number=1 WHERE id IN (1,2)")
    monkeypatch.setenv("CHAPTER01_AUTO_APPLY", "1")
    auto_apply_chapter()
    with main.database() as db:
        assert (
            db.execute("SELECT count(*) FROM chapter_content_imports").fetchone()[0]
            == 0
        )


def test_first_chapter_uses_number_not_database_id(clients, monkeypatch):
    with main.database() as db:
        db.execute("UPDATE chapters SET textbook_number=1 WHERE id=2")
    monkeypatch.setenv("CHAPTER01_AUTO_APPLY", "1")
    auto_apply_chapter()
    with main.database() as db:
        assert (
            db.execute("SELECT chapter_id FROM chapter_content_imports").fetchone()[0]
            == 2
        )
        assert (
            db.execute(
                "SELECT count(*) FROM knowledge_points WHERE chapter_id=1 AND archived_at IS NULL"
            ).fetchone()[0]
            == 1
        )
