"""第二章预填/审核闭环：临时数据库，不写工作区用户数据。"""

import json
import sqlite3
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import main, chapter02
from app.auth import create_user
from app.digital import Content
from app.persistence import backup_data, restore_data
from app.scheduling import ScheduleInput, calculate

BASE = "/api/teacher/chapter-content/chapter02"


@pytest.fixture
def clients(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "data" / "assistant.db")
    with TestClient(main.app) as t, TestClient(main.app) as s:
        for c, name, role in [
            (t, "ch02teacher", "teacher"),
            (s, "ch02student", "student"),
        ]:
            create_user(name, "chapter02-local-test-password", role)
            login = c.post(
                "/api/auth/login",
                json={"username": name, "password": "chapter02-local-test-password"},
            )
            c.headers["X-CSRF-Token"] = login.json()["csrf_token"]
        # ID is deliberately not assumed to equal 2.
        target = t.post(
            "/api/teacher/chapters", json={"title": "第二章自定标题", "published": True}
        ).json()["id"]
        yield t, s, target


def payload(d):
    return {
        k: v
        for k, v in d.items()
        if k in Content.model_fields and k != "expected_version"
    } | {"expected_version": d["edit_version"]}


def counts():
    with main.database() as db:
        return tuple(
            db.execute("SELECT count(*) FROM " + t).fetchone()[0]
            for t in [
                "sections",
                "knowledge_points",
                "experiments",
                "chapter_content_imports",
            ]
        )


def test_package_rules_and_authorization(clients):
    t, s, cid = clients
    p = t.get(BASE).json()
    assert s.get(BASE).status_code == 403
    assert s.post(BASE + "/plan", json={"chapter_id": cid}).status_code == 403
    assert s.post(BASE + "/import", json={"chapter_id": cid}).status_code == 403
    assert sum(x["slides"] for x in p["sources"]) == 169
    assert len(p["issues"]) == 21 and len(p["records"]) == 24 and len(p["items"]) == 12
    assert {r for item in p["items"] for r in item["record_ids"]} == {
        r["id"] for r in p["records"]
    }
    assert {x["algorithm"] for x in p["experiments"]} == {"fcfs", "sjf", "rr"}
    diagrams = {}
    for item in p["items"]:
        model = chapter02.content_for(p, item, cid, None)
        assert {"intro", "concept", "explanation", "case", "mistake", "summary"} <= {
            b.kind for b in model.blocks
        }
        assert not any(b.kind == "interaction" for b in model.blocks)
        for b in model.blocks:
            if b.diagram:
                diagrams[b.diagram.code] = b.diagram
    assert {f"CH02-G{x:03}" for x in range(1, 5)} <= diagrams.keys()
    assert {f"CH02-F{x:03}" for x in [1, 4, 7, 9]} <= diagrams.keys()
    before = counts()
    plan = t.post(BASE + "/plan", json={"chapter_id": cid})
    assert plan.status_code == 200 and plan.json()["units"] == 12
    assert counts() == before  # plan never creates sections or revisions
    assert (
        t.post(
            BASE + "/import", json={"chapter_id": cid, "section_map": {"bad": 1}}
        ).status_code
        == 422
    )


def test_idempotence_preserves_edits_and_old_data(clients):
    t, s, cid = clients
    with main.database() as db:
        original = [
            tuple(r) for r in db.execute("SELECT * FROM knowledge_points ORDER BY id")
        ]
        versions = [
            tuple(r)
            for r in db.execute("SELECT * FROM schema_versions ORDER BY version")
        ]
    r = t.post(BASE + "/import", json={"chapter_id": cid})
    assert r.status_code == 200, r.text
    data = r.json()
    assert len(data["points"]) == 12 and len(data["experiments"]) == 3
    assert all(
        s.get("/api/learning-content/" + str(x["id"])).status_code == 404
        for x in data["points"]
    )
    assert s.get("/api/experiments").json() == []
    point = data["points"][0]["id"]
    path = f"/api/teacher/learning-content/{point}"
    draft = t.get(path).json()
    edited = payload(draft)
    edited["title"] = "教师已修改，不得被重导覆盖"
    assert t.put(path, json=edited).status_code == 200
    before = counts()
    again = t.post(BASE + "/import", json={"chapter_id": cid}).json()
    assert again["already_imported"] and again["points"] == data["points"]
    assert counts() == before and t.get(path).json()["title"] == edited["title"]
    assert t.post(BASE + "/import", json={"chapter_id": 1}).status_code == 409
    with main.database() as db:
        assert [
            tuple(
                db.execute(
                    "SELECT * FROM knowledge_points WHERE id=?", (row[0],)
                ).fetchone()
            )
            for row in original
        ] == original
        assert [
            tuple(r)
            for r in db.execute("SELECT * FROM schema_versions ORDER BY version")
        ] == versions
        assert (
            db.execute(
                "SELECT count(*) FROM experiments WHERE published_revision_id IS NOT NULL"
            ).fetchone()[0]
            == 0
        )
        assert (
            db.execute(
                "SELECT count(*) FROM sections WHERE chapter_id=? AND published=1",
                (cid,),
            ).fetchone()[0]
            == 0
        )


def test_conflict_requires_explicit_mapping_and_retains_directory(clients):
    t, s, cid = clients
    old = t.post(
        "/api/teacher/sections",
        json={
            "chapter_id": cid,
            "code": "2.1",
            "title": "老师自己的小节",
            "published": True,
        },
    ).json()
    before = counts()
    assert t.post(BASE + "/plan", json={"chapter_id": cid}).json()["sections"][0][
        "conflict"
    ]
    assert t.post(BASE + "/import", json={"chapter_id": cid}).status_code == 409
    assert counts() == before
    result = t.post(
        BASE + "/import", json={"chapter_id": cid, "section_map": {"2.1": old["id"]}}
    )
    assert result.status_code == 200, result.text
    assert result.json()["sections"]["2.1"] == old["id"]
    assert (
        next(x for x in t.get("/api/sections").json() if x["id"] == old["id"])["title"]
        == "老师自己的小节"
    )
    changed = {**old, "code": "二-A", "title": "改号后仍然是同一小节", "sort_order": 99}
    assert (
        t.put(
            f"/api/teacher/sections/{old['id']}",
            json={k: v for k, v in changed.items() if k != "id"},
        ).status_code
        == 200
    )
    assert t.post(BASE + "/import", json={"chapter_id": cid}).json()["already_imported"]
    with main.database() as db:
        assert (
            db.execute("SELECT code FROM sections WHERE id=?", (old["id"],)).fetchone()[
                0
            ]
            == "二-A"
        )


def test_foreign_section_and_existing_ch02_are_rejected(clients):
    t, s, cid = clients
    other = t.post(
        "/api/teacher/sections",
        json={"chapter_id": 1, "code": "other", "title": "其他章小节"},
    ).json()["id"]
    assert (
        t.post(
            BASE + "/plan", json={"chapter_id": cid, "section_map": {"2.1": other}}
        ).status_code
        == 422
    )
    model = chapter02.content_for(
        chapter02.load_package(), chapter02.load_package()["items"][0], cid, None
    )
    assert (
        t.post("/api/teacher/learning-content", json=model.model_dump()).status_code
        == 201
    )
    before = counts()
    assert t.post(BASE + "/import", json={"chapter_id": cid}).status_code == 409
    assert counts() == before


def test_failed_experiment_rolls_back_whole_import(clients, monkeypatch):
    t, s, cid = clients
    before = counts()

    def fail(*args):
        raise HTTPException(422, "模拟实验校验失败")

    monkeypatch.setattr(chapter02, "save_experiment", fail)
    assert t.post(BASE + "/import", json={"chapter_id": cid}).status_code == 422
    assert counts() == before


def test_review_publish_student_projection_and_experiment_links(clients):
    t, s, cid = clients
    result = t.post(BASE + "/import", json={"chapter_id": cid}).json()
    point = next(x for x in result["points"] if x["code"] == "CH02-U010")
    path = f"/api/teacher/learning-content/{point['id']}"
    draft = t.get(path).json()
    assert "CH02-K017" in draft["source_note"]
    assert s.get(f"/api/learning-content/{point['id']}?preview=true").status_code == 403
    assert (
        t.post(
            path + "/publish", json={"expected_version": draft["edit_version"]}
        ).status_code
        == 422
    )
    for sec in t.get("/api/sections", params={"chapter_id": cid}).json():
        assert (
            t.put(
                f"/api/teacher/sections/{sec['id']}",
                json={k: v for k, v in sec.items() if k != "id"} | {"published": True},
            ).status_code
            == 200
        )
    assert (
        t.post(
            path + "/publish", json={"expected_version": draft["edit_version"]}
        ).status_code
        == 200
    )
    visible = s.get(f"/api/learning-content/{point['id']}").json()
    assert (
        visible["source_note"] == ""
        and visible["source_title"] == ""
        and visible["materials"] == []
    )
    assert all(
        not b.get("diagram") or b["diagram"]["note"] == "" for b in visible["blocks"]
    )
    assert s.get("/api/experiments", params={"knowledge_id": point["id"]}).json() == []
    for exp in result["experiments"]:
        if exp["algorithm"] == "rr":
            continue
        ep = f"/api/teacher/experiments/{exp['id']}"
        response = t.post(ep + "/preview", json={"edit_version": exp["edit_version"]})
        assert response.status_code == 200
        expected = 35 if exp["algorithm"] == "fcfs" else 55 / 3
        assert response.json()["average_turnaround"] == pytest.approx(expected)
        assert (
            t.post(
                ep + "/publish", json={"edit_version": exp["edit_version"]}
            ).status_code
            == 200
        )
    assert {
        x["algorithm"]
        for x in s.get("/api/experiments", params={"knowledge_id": point["id"]}).json()
    } == {"fcfs", "sjf"}
    # A later teacher draft does not change what students read before republishing.
    current = t.get(path).json()
    edit = payload(current)
    edit["blocks"][0]["text"] = "老师保留的个性化问题"
    assert t.put(path, json=edit).status_code == 200
    assert (
        s.get(f"/api/learning-content/{point['id']}").json()["blocks"][0]["text"]
        != "老师保留的个性化问题"
    )
    fresh = t.get(path).json()
    assert (
        t.post(
            path + "/publish", json={"expected_version": fresh["edit_version"]}
        ).status_code
        == 200
    )
    assert (
        s.get(f"/api/learning-content/{point['id']}").json()["blocks"][0]["text"]
        == "老师保留的个性化问题"
    )


def test_changed_package_does_not_replace_import(clients, tmp_path, monkeypatch):
    t, s, cid = clients
    t.post(BASE + "/import", json={"chapter_id": cid})
    before = counts()
    modified = tmp_path / "package.json"
    modified.write_text(chapter02.PACKAGE.read_text() + "\n")
    monkeypatch.setattr(chapter02, "PACKAGE", modified)
    assert t.get(BASE + "/status", params={"chapter_id": cid}).json()["result"][
        "package_changed"
    ]
    assert t.post(BASE + "/import", json={"chapter_id": cid}).status_code == 409
    assert counts() == before


def test_persistence_backup_restores_import_state(clients, tmp_path):
    t, s, cid = clients
    result = t.post(BASE + "/import", json={"chapter_id": cid}).json()
    backup = tmp_path / "saved"
    backup_data(main.DB_PATH, backup)
    target = tmp_path / "restored"
    restore_data(backup, target)
    with sqlite3.connect(target / "assistant.db") as db:
        record = json.loads(
            db.execute("SELECT result_json FROM chapter_content_imports").fetchone()[0]
        )
        assert record["points"] == result["points"] and len(record["experiments"]) == 3
