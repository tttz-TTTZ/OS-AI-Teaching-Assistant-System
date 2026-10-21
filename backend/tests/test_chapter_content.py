"""Real content package import, authorization and immutable draft regression."""

import json
import sqlite3
import pytest
from fastapi.testclient import TestClient
from app import main
from app.auth import create_user
from app.chapter_content import load_package, content_for
from app.scheduling import calculate, ScheduleInput
from app.migrations import migrate
from app.persistence import restore_data


@pytest.fixture
def clients(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "data" / "assistant.db")
    with TestClient(main.app) as t, TestClient(main.app) as s:
        for client, name, role in [
            (t, "reviewteacher", "teacher"),
            (s, "reviewstudent", "student"),
        ]:
            create_user(name, "chapter-review-test-password", role)
            r = client.post(
                "/api/auth/login",
                json={"username": name, "password": "chapter-review-test-password"},
            )
            client.headers["X-CSRF-Token"] = r.json()["csrf_token"]
        yield t, s


def test_auth_and_complete_content(clients):
    t, s = clients
    url = "/api/teacher/chapter-content/chapter01"
    assert s.get(url).status_code == 403
    assert s.post(url + "/import", json={"chapter_id": 1}).status_code == 403
    p = t.get(url).json()
    assert sum(x["slides"] for x in p["sources"]) == 143
    assert len(p["issues"]) == 10 and len(p["summaries"]) == 12
    assert len({i["code"] for i in p["items"]}) == 17
    assert (
        next(i for i in p["items"] if i["code"] == "CH01-K012")["importable"] is False
    )
    diagrams = {}
    for item in p["items"]:
        content = content_for(p, item, 1, None)
        assert len(content.blocks) >= 6
        assert "原目录归属" in content.source_note
        for b in content.blocks:
            if b.diagram:
                diagrams[b.diagram.code] = b.diagram
    assert set(diagrams) == {
        "MAP-01",
        "MAP-02",
        "MAP-03",
        "MAP-04",
        "FLOW-01",
        "FLOW-02",
        "FLOW-03",
        "FLOW-04",
    }
    assert any(e.direction == "unconfirmed" for e in diagrams["MAP-04"].edges)


def test_import_drafts_idempotence_preserves_teacher_changes(clients):
    t, s = clients
    with main.database() as db:
        original = [
            tuple(r)
            for r in db.execute("SELECT id,title,content FROM knowledge_points")
        ]
    url = "/api/teacher/chapter-content/chapter01/import"
    r = t.post(url, json={"chapter_id": 1})
    assert r.status_code == 200, r.text
    result = r.json()
    assert len(result["points"]) == 16
    first = result["points"][0]
    edit = "/api/teacher/learning-content/" + str(first["id"])
    draft = t.get(edit).json()
    assert not draft["published"]
    assert s.get("/api/learning-content/" + str(first["id"])).status_code == 404
    payload = {
        k: draft[k]
        for k in [
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
    }
    payload.update(title="审核者已修改标题", expected_version=draft["edit_version"])
    assert t.put(edit, json=payload).status_code == 200
    again = t.post(url, json={"chapter_id": 1}).json()
    assert again["already_imported"] and again["points"] == result["points"]
    assert t.get(edit).json()["title"] == "审核者已修改标题"
    assert t.post(url, json={"chapter_id": 2}).status_code == 409
    with main.database() as db:
        assert [
            tuple(r)
            for r in db.execute(
                "SELECT id,title,content FROM knowledge_points WHERE id<=?",
                (max(x[0] for x in original),),
            )
        ] == original
        assert (
            db.execute(
                "SELECT count(*) FROM knowledge_points WHERE published=0"
            ).fetchone()[0]
            == 16
        )
        assert db.execute("SELECT count(*) FROM experiments").fetchone()[0] == 1
        assert (
            db.execute("SELECT published_revision_id FROM experiments").fetchone()[0]
            is None
        )
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
    # Teacher approves through existing publication; published graph revision is readable by student.
    sec = t.get("/api/sections").json()[0]
    assert (
        t.put(
            "/api/teacher/sections/" + str(sec["id"]),
            json={k: sec[k] for k in ["chapter_id", "code", "title", "sort_order"]}
            | {"published": True},
        ).status_code
        == 200
    )
    draft = t.get(edit).json()
    assert (
        t.post(
            edit + "/publish", json={"expected_version": draft["edit_version"]}
        ).status_code
        == 200
    )
    published = s.get("/api/learning-content/" + str(first["id"])).json()
    assert any(b["kind"] == "diagram" for b in published["blocks"])
    eid = result["experiment_id"]
    experiment = t.get("/api/teacher/experiments/" + str(eid)).json()
    computed = calculate("rr", ScheduleInput(**experiment["defaults"]))
    assert computed["average_waiting"] == 3.5 and computed["average_turnaround"] == 7.5
    assert s.get("/api/experiments/" + str(eid)).status_code == 404


def test_conflict_rolls_back_whole_import(clients):
    t, _ = clients
    with main.database() as db:
        db.execute(
            "INSERT INTO sections(chapter_id,code,title) VALUES (1,'1.2','已有自定义标题')"
        )
        before = db.execute("SELECT count(*) FROM knowledge_points").fetchone()[0]
    r = t.post("/api/teacher/chapter-content/chapter01/import", json={"chapter_id": 1})
    assert r.status_code == 409
    with main.database() as db:
        assert (
            db.execute("SELECT count(*) FROM knowledge_points").fetchone()[0] == before
        )
        assert (
            db.execute("SELECT count(*) FROM sections WHERE code='1.1'").fetchone()[0]
            == 0
        )
        assert (
            db.execute("SELECT count(*) FROM chapter_content_imports").fetchone()[0]
            == 0
        )


def test_v9_backup_and_idempotent_migration(clients, tmp_path):
    with main.database() as db:
        db.execute("DROP TABLE chapter_content_imports")
        db.execute("DELETE FROM schema_versions WHERE version=9")
        before = db.execute("SELECT count(*) FROM knowledge_points").fetchone()[0]
    migrate(main.DB_PATH)
    migrate(main.DB_PATH)
    backup = sorted((main.DB_PATH.parent / "backups").glob("before-v9-*"))[-1]
    restored = restore_data(backup, tmp_path / "restored")
    with sqlite3.connect(restored) as db:
        assert (
            db.execute("SELECT count(*) FROM knowledge_points").fetchone()[0] == before
        )
        assert (
            db.execute(
                "SELECT count(*) FROM schema_versions WHERE version=9"
            ).fetchone()[0]
            == 0
        )
    with main.database() as db:
        assert (
            db.execute(
                "SELECT count(*) FROM schema_versions WHERE version=9"
            ).fetchone()[0]
            == 1
        )
        assert db.execute("SELECT count(*) FROM users").fetchone()[0] == 2
