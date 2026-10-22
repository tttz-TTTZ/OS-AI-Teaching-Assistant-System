"""第三章第一批：隔离库、真实修订/发布、导入失败回滚及无假实验。"""

import importlib.util
import json
import re
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import main, chapter03
from app.auth import create_user
from app.digital import Content
from app.persistence import backup_data, restore_data
from test_chapter02 import payload, counts

BASE = "/api/teacher/chapter-content/chapter03"


@pytest.fixture
def clients(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "data" / "assistant.db")
    with TestClient(main.app) as teacher, TestClient(main.app) as student:
        for c, name, role in [
            (teacher, "ch03teacher", "teacher"),
            (student, "ch03student", "student"),
        ]:
            create_user(name, "chapter03-isolated-test-password", role)
            r = c.post(
                "/api/auth/login",
                json={"username": name, "password": "chapter03-isolated-test-password"},
            )
            c.headers["X-CSRF-Token"] = r.json()["csrf_token"]
        target = teacher.post(
            "/api/teacher/chapters", json={"title": "自定存储管理章", "published": True}
        ).json()["id"]
        assert target != 3
        yield teacher, student, target


def test_reviewed_package_models_and_source_coverage(clients):
    t, s, cid = clients
    p = t.get(BASE).json()
    assert len(p["sources"]) == 6 and sum(x["slides"] for x in p["sources"]) == 118
    assert len(p["items"]) == 12 and len(p["records"]) == 21 and len(p["issues"]) == 28
    assert p["experiments"] == [] and len(p["summaries"]) == 8
    ids = [r for item in p["items"] for r in item["record_ids"]]
    assert len(ids) == len(set(ids)) == 21
    assert {i["id"] for i in p["issues"]} == {f"CH03-V{i:03}" for i in range(1, 29)}
    assert all("未解决" in i["status"] for i in p["issues"])
    diagrams = {}
    source = {x["id"]: x for x in p["sources"]}
    for item in p["items"]:
        model = chapter03.content_for(p, item, cid, None)
        assert not any(
            re.search(r"(?:CH03-|S3-|[FGK]\d{3}|T教学|T：|T/V：)", b.text)
            for b in model.blocks
        )
        assert not model.lab and not any(
            b.config or b.kind == "interaction" for b in model.blocks
        )
        assert {"intro", "concept", "explanation", "case", "mistake", "summary"} <= {
            b.kind for b in model.blocks
        }
        for b in model.blocks:
            if b.diagram:
                diagrams[b.diagram.code] = b.diagram
        for ref in item["refs"]:
            assert ref["quote_page"] in ref["physical_pages"]
            assert all(
                1 <= n <= source[ref["source_id"]]["slides"]
                for n in ref["physical_pages"]
            )
    assert len([d for d in diagrams.values() if d.type == "relation"]) == 6
    assert len([d for d in diagrams.values() if d.type == "flow"]) == 9
    assert sum(len(d.edges) for d in diagrams.values() if d.type == "relation") == 45
    flow = diagrams["CH03-F004"]
    labels = {n.id: n.label for n in flow.nodes}
    incoming = [e for e in flow.edges if labels[e.target] == "进入缺页处理"]
    assert len(incoming) == 1 and incoming[0].label == "合法且允许但不驻留"
    hit = [
        e
        for e in flow.edges
        if labels[e.source] == "检查缓存权限" and e.label == "允许"
    ]
    assert (
        labels[hit[0].target] == "输出地址"
    )  # no mandatory extra PTE read on a TLB hit
    assert all(
        e.direction == "directed" and e.label
        for d in diagrams.values()
        for e in d.edges
    )


def test_builder_reproducible_and_does_not_need_database(tmp_path):
    root = Path(__file__).resolve().parents[2]
    spec = importlib.util.spec_from_file_location(
        "chapter03_builder", root / "scripts/build_chapter03_content.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.DEST = tmp_path
    module.build()
    assert (tmp_path / "chapter03.json").read_bytes() == chapter03.PACKAGE.read_bytes()
    assert (tmp_path / "chapter03_reading.json").read_bytes() == (
        chapter03.PACKAGE.parent / "chapter03_reading.json"
    ).read_bytes()


def test_authorization_and_read_only_plan(clients):
    t, s, cid = clients
    for method, suffix in [
        ("get", ""),
        ("get", "/status?chapter_id=" + str(cid)),
        ("post", "/plan"),
        ("post", "/import"),
    ]:
        kwargs = {"json": {"chapter_id": cid}} if method == "post" else {}
        assert getattr(s, method)(BASE + suffix, **kwargs).status_code == 403
    before = counts()
    r = t.post(BASE + "/plan", json={"chapter_id": cid})
    assert (
        r.status_code == 200
        and r.json()["units"] == 12
        and r.json()["experiments"] == 0
    )
    assert counts() == before
    assert t.post(BASE + "/import", json={}).status_code == 422
    assert t.post(BASE + "/import", json={"chapter_id": 0}).status_code == 422
    assert t.post(BASE + "/import", json={"chapter_id": 999999}).status_code == 404
    assert t.post(BASE + "/publish", json={"chapter_id": cid}).status_code == 404
    assert counts() == before


def test_drafts_idempotent_preserve_old_data_and_teacher_changes(clients):
    t, s, cid = clients
    with main.database() as db:
        old = [
            tuple(r) for r in db.execute("SELECT * FROM knowledge_points ORDER BY id")
        ]
        versions = [tuple(r) for r in db.execute("SELECT * FROM schema_versions")]
        questions = [
            tuple(r) for r in db.execute("SELECT * FROM questions ORDER BY id")
        ]
        documents = [
            tuple(r) for r in db.execute("SELECT * FROM documents ORDER BY id")
        ]
    r = t.post(BASE + "/import", json={"chapter_id": cid})
    assert r.status_code == 200, r.text
    result = r.json()
    assert len(result["points"]) == 12 and result["experiments"] == []
    assert all(
        s.get("/api/learning-content/" + str(p["id"])).status_code == 404
        for p in result["points"]
    )
    path = "/api/teacher/learning-content/" + str(result["points"][0]["id"])
    draft = t.get(path).json()
    edited = payload(draft)
    edited["title"] = "教师自由修改后的标题"
    edited["blocks"][0]["text"] = "教师补充的正文与模型条件"
    assert t.put(path, json=edited).status_code == 200
    before = counts()
    again = t.post(BASE + "/import", json={"chapter_id": cid}).json()
    assert (
        again["already_imported"]
        and again["points"] == result["points"]
        and counts() == before
    )
    assert t.get(path).json()["blocks"][0]["text"] == edited["blocks"][0]["text"]
    assert t.post(BASE + "/import", json={"chapter_id": 1}).status_code == 409
    with main.database() as db:
        assert [
            tuple(
                db.execute(
                    "SELECT * FROM knowledge_points WHERE id=?", (r[0],)
                ).fetchone()
            )
            for r in old
        ] == old
        assert [
            tuple(r) for r in db.execute("SELECT * FROM schema_versions")
        ] == versions
        assert (
            db.execute(
                "SELECT count(*) FROM sections WHERE chapter_id=? AND published=1",
                (cid,),
            ).fetchone()[0]
            == 0
        )
        assert db.execute("SELECT count(*) FROM experiments").fetchone()[0] == 0
        assert [
            tuple(r) for r in db.execute("SELECT * FROM questions ORDER BY id")
        ] == questions
        assert [
            tuple(r) for r in db.execute("SELECT * FROM documents ORDER BY id")
        ] == documents


def test_directory_conflict_explicit_mapping_and_foreign_section(clients):
    t, s, cid = clients
    old = t.post(
        "/api/teacher/sections",
        json={
            "chapter_id": cid,
            "code": "3.1",
            "title": "教师自己的基础节",
            "published": True,
        },
    ).json()
    before = counts()
    assert t.post(BASE + "/plan", json={"chapter_id": cid}).json()["sections"][0][
        "conflict"
    ]
    assert t.post(BASE + "/import", json={"chapter_id": cid}).status_code == 409
    assert counts() == before
    foreign = t.post(
        "/api/teacher/sections",
        json={"chapter_id": 1, "code": "foreign", "title": "其他章"},
    ).json()
    for mapping in [{"bad": old["id"]}, {"3.1": foreign["id"]}]:
        assert (
            t.post(
                BASE + "/plan", json={"chapter_id": cid, "section_map": mapping}
            ).status_code
            == 422
        )
        assert (
            t.post(
                BASE + "/import", json={"chapter_id": cid, "section_map": mapping}
            ).status_code
            == 422
        )
    imported = t.post(
        BASE + "/import", json={"chapter_id": cid, "section_map": {"3.1": old["id"]}}
    ).json()
    assert imported["sections"]["3.1"] == old["id"]
    with main.database() as db:
        row = db.execute("SELECT * FROM sections WHERE id=?", (old["id"],)).fetchone()
        assert row["title"] == old["title"] and row["published"] == 1
    assert (
        t.post(
            BASE + "/import",
            json={"chapter_id": cid, "section_map": {"3.1": foreign["id"]}},
        ).status_code
        == 409
    )


def test_mid_import_failure_rolls_back_sections_points_revisions_and_ledger(
    clients, monkeypatch
):
    t, s, cid = clients
    before = counts()
    save = chapter03.save_revision
    calls = 0

    def fail_second(*args):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise HTTPException(422, "模拟第二条写入失败")
        return save(*args)

    monkeypatch.setattr(chapter03, "save_revision", fail_second)
    assert t.post(BASE + "/import", json={"chapter_id": cid}).status_code == 422
    assert counts() == before
    with main.database() as db:
        assert db.execute("SELECT count(*) FROM knowledge_revisions").fetchone()[0] == 0


def test_revision_history_not_taken_over(clients):
    t, s, cid = clients
    p = chapter03.load_package()
    model = chapter03.content_for(p, p["items"][0], cid, None)
    r = t.post("/api/teacher/learning-content", json=model.model_dump())
    assert r.status_code == 201
    before = counts()
    assert t.post(BASE + "/import", json={"chapter_id": cid}).status_code == 409
    assert counts() == before


def test_changed_bundle_conflicts_without_overwrite(clients, tmp_path, monkeypatch):
    t, s, cid = clients
    assert t.post(BASE + "/import", json={"chapter_id": cid}).status_code == 200
    before = counts()
    path = tmp_path / "changed.json"
    path.write_bytes(chapter03.PACKAGE.read_bytes() + b"\n")
    monkeypatch.setattr(chapter03, "PACKAGE", path)
    assert t.get(BASE + "/status", params={"chapter_id": cid}).json()["result"][
        "package_changed"
    ]
    assert t.post(BASE + "/import", json={"chapter_id": cid}).status_code == 409
    assert counts() == before


def test_normal_teacher_review_publication_and_private_student_reading(clients):
    t, s, cid = clients
    result = t.post(BASE + "/import", json={"chapter_id": cid}).json()
    point = next(p for p in result["points"] if p["code"] == "CH03-U006")
    path = f"/api/teacher/learning-content/{point['id']}"
    draft = t.get(path).json()
    assert "物理页" in draft["source_note"] and "CH03-V027" in draft["source_note"]
    assert (
        t.post(
            path + "/publish", json={"expected_version": draft["edit_version"]}
        ).status_code
        == 422
    )
    assert s.get(f"/api/learning-content/{point['id']}?preview=true").status_code == 403
    for sec in t.get("/api/sections", params={"chapter_id": cid}).json():
        assert (
            t.put(
                "/api/teacher/sections/" + str(sec["id"]),
                json={k: v for k, v in sec.items() if k != "id"} | {"published": True},
            ).status_code
            == 200
        )
    edited = payload(draft)
    edited["blocks"][0]["text"] = "教师补充：先判断上下文和权限"
    changed = t.put(path, json=edited).json()
    assert (
        t.post(
            path + "/publish", json={"expected_version": changed["edit_version"]}
        ).status_code
        == 200
    )
    response = s.get(f"/api/learning-content/{point['id']}")
    assert response.status_code == 200, response.text
    visible = response.json()
    assert (
        visible["source_note"] == visible["source_title"] == ""
        and visible["materials"] == []
    )
    assert visible["blocks"][0]["text"] == edited["blocks"][0]["text"]
    assert all(
        not b.get("diagram") or b["diagram"]["note"] == "" for b in visible["blocks"]
    )
    assert "260ns" in next(b for b in visible["blocks"] if b["id"] == "case")["text"]
    assert "无缺页" in next(b for b in visible["blocks"] if b["id"] == "case")["text"]
    assert s.get("/api/experiments", params={"knowledge_id": point["id"]}).json() == []
    assert (
        s.get(f"/api/learning-content/{point['id']}").json()["revision_id"]
        == visible["revision_id"]
    )


def test_import_survives_backup_restore(clients, tmp_path):
    t, s, cid = clients
    result = t.post(BASE + "/import", json={"chapter_id": cid}).json()
    backup = backup_data(main.DB_PATH, tmp_path / "backup")
    restore_data(backup, tmp_path / "restored")
    import sqlite3

    with sqlite3.connect(tmp_path / "restored" / "assistant.db") as db:
        row = db.execute(
            "SELECT result_json FROM chapter_content_imports WHERE package_id=?",
            (result["package_id"],),
        ).fetchone()
        assert json.loads(row[0]) == result
        assert (
            db.execute(
                "SELECT count(*) FROM knowledge_points WHERE digital_managed=1"
            ).fetchone()[0]
            == 12
        )


def test_student_projection_keeps_conditions_and_manual_diagram_notes():
    from app.reading import student_reading

    package = chapter03.load_package()
    item = next(i for i in package["items"] if i["code"] == "CH03-U006")
    body = chapter03.content_for(package, item, 99, None).model_dump()
    student = student_reading(body)
    diagram = next(
        b
        for b in student["blocks"]
        if b.get("diagram") and b["diagram"]["code"] == "CH03-F004"
    )
    assert diagram["diagram"]["note"] == ""
    assert "缓存命中权限" in diagram["text"]
    assert any("合法且允许但不驻留" in e["label"] for e in diagram["diagram"]["edges"])
    original = next(b for b in body["blocks"] if b["id"] == diagram["id"])
    original["diagram"]["note"] = "教师新增条件：此流程采用单级驻留页表模型。"
    modified = student_reading(body)
    assert (
        next(b for b in modified["blocks"] if b["id"] == diagram["id"])["diagram"][
            "note"
        ]
        == original["diagram"]["note"]
    )
