import copy
import json
import struct
import sqlite3
import runpy
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from fastapi import HTTPException
from app import main, ai_lessons
from app.auth import create_user
from app.legacy_ppt import parse_document, inspect_ppt
from app.migrations import migrate
from app.persistence import backup_data, restore_data

TEXT = "操作系统负责管理计算机硬件和软件资源，为用户和应用程序提供服务。进程调度需要根据算法选择就绪进程。"


@pytest.fixture
def clients(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "data" / "test.db")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-only-key")
    with TestClient(main.app) as t, TestClient(main.app) as s, TestClient(
        main.app
    ) as o:
        for c, name, role in [
            (t, "teacher", "teacher"),
            (s, "student", "student"),
            (o, "other", "teacher"),
        ]:
            create_user(name, "lesson-test-password", role)
            r = c.post(
                "/api/auth/login",
                json={"username": name, "password": "lesson-test-password"},
            )
            c.headers["X-CSRF-Token"] = r.json()["csrf_token"]
        yield t, s, o


def prepare(t):
    d = t.post(
        "/api/materials/upload", files={"file": ("备课专用.txt", TEXT.encode())}
    ).json()
    selection = {"sources": [{"document_id": d["id"], "start_page": 1, "end_page": 1}]}
    p = t.post("/api/teacher/ai-questions/sources/preview", json=selection)
    assert p.status_code == 200, p.text
    return {
        **selection,
        "fingerprint": p.json()["fingerprint"],
        "chapter_id": 1,
        "max_points": 4,
        "request_key": "lesson-request-000001",
    }, p.json()


def generated(preview):
    p = {
        "title": "操作系统的职责",
        "summary": "资源管理与服务",
        "objectives": "解释基本职责",
        "blocks": [
            {"kind": kind, "title": label, "text": TEXT}
            for kind, label in [
                ("intro", "问题导入"),
                ("concept", "核心概念"),
                ("explanation", "原理精讲"),
                ("case", "典型案例"),
                ("mistake", "易错辨析"),
                ("summary", "练习建议"),
            ]
        ],
        "source_ref": preview["chunks"][0]["ref"],
        "source_quote": TEXT[:25],
        "teaching_note": "图示待教师核对",
    }
    # 同章不同小节可有不同知识点数量，绝不限制成固定目录。
    return {
        "sections": [
            {"title": "系统概观（候选）", "points": [p]},
            {
                "title": "资源服务（候选）",
                "points": [{**p, "title": "资源管理"}, {**p, "title": "用户服务"}],
            },
        ]
    }


def mock_generation(monkeypatch, calls):
    async def fake(body, preview, **kw):
        calls.append(kw)
        return generated(preview)

    monkeypatch.setattr(ai_lessons, "call_deepseek", fake)


def rec(kind, payload=b"", flags=0):
    return struct.pack("<HHI", flags, kind, len(payload)) + payload


def slide_list(texts):
    return rec(
        4080,
        b"".join(
            rec(1011, struct.pack("<IIIII", i + 2, 0, 1, i + 256, 0))
            + rec(4000, text.encode("utf-16le"))
            for i, text in enumerate(texts)
        ),
        15,
    )


def test_legacy_ppt_text_order_notes_excluded_and_real_upload(clients, tmp_path):
    from app.legacy_ppt import records

    t, _, _ = clients
    notes = rec(
        4080,
        rec(1011, struct.pack("<IIIII", 9, 0, 1, 999, 0))
        + rec(4000, "备注不应进入出题资料".encode("utf-16le")),
        0x2F,
    )
    doc = rec(
        1000,
        slide_list([TEXT, "第二页的操作系统服务正文，用于文字提取和来源测试。", ""])
        + notes,
        15,
    )
    ppt_bytes = runpy.run_path(
        str(Path(__file__).resolve().parents[2] / "scripts/presentation_fixture.py")
    )["ppt_bytes"]
    # 真正OLE容器和PowerPoint文档流，不mock文件读取。
    raw = ppt_bytes()[:-4096] + doc.ljust(4096, b"\0")
    path = tmp_path / "legacy.ppt"
    path.write_bytes(raw)
    data = inspect_ppt(path, 0, 2)
    assert data["total"] == 3 and [s["number"] for s in data["slides"]] == [1, 2]
    assert data["slides"][0]["text"] == TEXT
    assert "备注" not in str(data)
    d = t.post("/api/materials/upload", files={"file": ("旧授课.ppt", raw)})
    assert d.status_code == 201, d.text
    selected = {
        "sources": [{"document_id": d.json()["id"], "start_page": 1, "end_page": 2}]
    }
    r = t.post("/api/teacher/ai-questions/sources/preview", json=selected)
    assert r.status_code == 200, r.text
    assert r.json()["chunks"][0]["text"] == TEXT
    assert r.json()["warnings"]
    with pytest.raises(ValueError):
        list(records(rec(4000, b"ok")[:-1]))
    with pytest.raises(ValueError):
        parse_document(doc + doc)


def test_legacy_current_revision_persist_chain():
    old_doc = rec(1000, slide_list(["旧版本不得混入"]), 15)
    new_doc = rec(1000, slide_list([TEXT, "第二页"]), 15)
    start_new = len(old_doc)
    directory_offset = start_new + len(new_doc)
    directory = rec(6002, struct.pack("<II", (1 << 20) | 1, start_new))
    edit_offset = directory_offset + len(directory)
    edit = rec(4085, struct.pack("<IIIIIIHH", 0, 0, 0, directory_offset, 1, 4, 0, 0))
    slides = parse_document(old_doc + new_doc + directory + edit, edit_offset)
    assert len(slides) == 2 and slides[0]["text"] == TEXT


def test_v7_backup_and_repeat_migration_preserves_data(clients):
    from app.ai_lesson_migration import migrate_ai_lessons

    t, _, _ = clients
    before = t.get("/api/teacher/learning-content").json()
    with sqlite3.connect(main.DB_PATH) as db:
        db.execute("DROP TABLE ai_lesson_jobs")
        db.execute("DELETE FROM schema_versions WHERE version=7")
    migrate(main.DB_PATH)
    assert list((main.DB_PATH.parent / "backups").glob("before-v7-*"))
    migrate(main.DB_PATH)
    assert len(list((main.DB_PATH.parent / "backups").glob("before-v7-*"))) == 1
    assert t.get("/api/teacher/learning-content").json() == before


def test_teacher_preparation_retired_without_deleting_history(clients):
    t, s, other = clients
    body, preview = prepare(t)
    assert t.post("/api/teacher/ai-lessons/generate", json=body).status_code == 410
    assert s.post("/api/teacher/ai-lessons/generate", json=body).status_code == 403
    with main.database() as db:
        user = db.execute("SELECT id FROM users WHERE username='teacher'").fetchone()[0]
        ident = db.execute(
            "INSERT INTO ai_lesson_jobs(user_id,request_key,request_hash,config_json,sources_json,model,status) VALUES(?,?,?,?,?,?,'ready')",
            (
                user,
                "retired-history-000001",
                "hash",
                json.dumps(body),
                json.dumps(preview),
                "old-test-model",
            ),
        ).lastrowid
    assert t.get(f"/api/teacher/ai-lessons/jobs/{ident}").status_code == 200
    assert other.get(f"/api/teacher/ai-lessons/jobs/{ident}").status_code == 404
    review = {
        "plan": {"chapter_id": 1, "sections": generated(preview)["sections"]},
        "expected_version": 0,
        "reviewed": True,
    }
    assert (
        t.put(f"/api/teacher/ai-lessons/jobs/{ident}", json=review).status_code == 410
    )
    assert (
        t.post(f"/api/teacher/ai-lessons/jobs/{ident}/import", json=review).status_code
        == 410
    )
    assert t.get(f"/api/teacher/ai-lessons/jobs/{ident}").json()["status"] == "ready"
