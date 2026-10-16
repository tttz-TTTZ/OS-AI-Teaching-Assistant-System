import copy
import sqlite3
import pytest
from fastapi.testclient import TestClient
from app import main
from app.auth import create_user


@pytest.fixture
def clients(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "digital.db")
    with TestClient(main.app) as t, TestClient(main.app) as s, TestClient(
        main.app
    ) as b:
        for client, name, role in [
            (t, "teacher", "teacher"),
            (s, "student", "student"),
            (b, "other", "student"),
        ]:
            create_user(name, "digital-test-password", role)
            r = client.post(
                "/api/auth/login",
                json={"username": name, "password": "digital-test-password"},
            )
            client.headers["X-CSRF-Token"] = r.json()["csrf_token"]
        yield t, s, b


def content():
    return dict(
        chapter_id=1,
        title="可编辑教学样板",
        code="待校对",
        objectives="理解原理",
        printed_pages="待核对",
        pdf_pages="",
        blocks=[
            dict(id=k, kind=k, title=k, text="教学演示内容，非正式教材")
            for k in ["intro", "concept", "explanation", "case", "mistake", "summary"]
        ],
    )


def test_revision_publication_and_conflict(clients):
    t, s, _ = clients
    old = s.get("/api/knowledge/1").json()["content"]
    body = content()
    saved = t.put("/api/teacher/learning-content/1", json=body)
    assert saved.status_code == 200, saved.text
    assert s.get("/api/learning-content/1").json()["blocks"][0]["text"] == old
    assert t.put("/api/teacher/learning-content/1", json=body).status_code == 409
    assert (
        t.put(
            "/api/teacher/knowledge/1",
            json={"chapter_id": 1, "title": "overwrite", "content": "bad"},
        ).status_code
        == 409
    )
    assert s.get("/api/learning-content/1?preview=true").status_code == 403
    assert s.put("/api/teacher/learning-content/1", json=body).status_code == 403
    version = saved.json()["edit_version"]
    pub = t.post(
        "/api/teacher/learning-content/1/publish", json={"expected_version": version}
    )
    assert pub.status_code == 200, pub.text
    data = s.get("/api/learning-content/1").json()
    assert data["code"] == "待校对" and data["printed_pages"] == "待核对"
    body.update(expected_version=pub.json()["edit_version"], title="仅新草稿")
    draft = t.put("/api/teacher/learning-content/1", json=body).json()
    assert s.get("/api/learning-content/1").json()["title"] == "可编辑教学样板"
    hist = t.get("/api/teacher/learning-content/1/history").json()
    assert len(hist) == 3
    assert (
        t.post(
            "/api/teacher/learning-content/1/withdraw",
            json={"expected_version": draft["edit_version"]},
        ).status_code
        == 200
    )
    assert s.get("/api/learning-content/1").status_code == 404


def test_sections_progress_and_private_notes(clients):
    t, s, b = clients
    sec = t.post(
        "/api/teacher/sections",
        json={"chapter_id": 1, "title": "自由小节", "code": "一、", "published": True},
    ).json()
    data = content()
    data["section_id"] = sec["id"]
    point = t.post("/api/teacher/learning-content", json=data).json()
    assert s.get(f"/api/learning-content/{point['id']}").status_code == 404
    assert (
        t.post(
            f"/api/teacher/learning-content/{point['id']}/publish",
            json={"expected_version": point["edit_version"]},
        ).status_code
        == 200
    )
    item = s.get(f"/api/learning-content/{point['id']}").json()
    progress = {
        "revision_id": item["revision_id"],
        "note": "我的私人笔记",
        "read_done": True,
        "position": "concept",
    }
    url = f"/api/learning-content/{point['id']}/progress"
    assert s.put(url, json=progress).status_code == 200
    assert s.put(url, json=progress).status_code == 409
    assert s.get(url).json()["note"] == "我的私人笔记"
    assert b.get(url).json()["note"] == ""
    assert t.get(url).json()["note"] == ""
    assert (
        t.put(
            f"/api/teacher/sections/{sec['id']}",
            json={"chapter_id": 1, "title": "重命名", "published": False},
        ).status_code
        == 200
    )
    assert s.get(f"/api/learning-content/{point['id']}").status_code == 404
    assert all(x["id"] != point["id"] for x in s.get("/api/learning-content").json())


def test_v3_migration_preserves_data_and_snapshot(tmp_path):
    from app.migrations import _migrate_v3, migrate
    from app.persistence import validate_backup

    path = tmp_path / "test.db"
    _migrate_v3(path)
    with sqlite3.connect(path) as db:
        before = db.execute("SELECT id,title,content FROM knowledge_points").fetchall()
    migrate(path)
    snapshots = list((tmp_path / "backups").glob("before-v4-*"))
    assert len(snapshots) == 1
    validate_backup(snapshots[0])
    migrate(path)
    assert len(list((tmp_path / "backups").glob("before-v4-*"))) == 1
    with sqlite3.connect(path) as db:
        assert (
            before
            == db.execute("SELECT id,title,content FROM knowledge_points").fetchall()
        )
        assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"


def test_images_authorized_by_publication_and_backup(clients, tmp_path):
    import io
    from PIL import Image
    from app.persistence import backup_data, validate_backup, restore_data

    t, s, _ = clients
    image = io.BytesIO()
    Image.new("RGB", (3, 3), (255, 0, 0)).save(image, "PNG")
    assert (
        s.post(
            "/api/teacher/learning-assets", files={"file": ("x.png", image.getvalue())}
        ).status_code
        == 403
    )
    assert (
        t.post(
            "/api/teacher/learning-assets",
            files={"file": ("evil.svg", b'<svg onload="evil()"/>')},
        ).status_code
        == 422
    )
    asset = t.post(
        "/api/teacher/learning-assets", files={"file": ("x.png", image.getvalue())}
    ).json()["id"]
    url = f"/api/learning-assets/{asset}"
    assert s.get(url).status_code == 404
    data = content()
    data["blocks"].append(
        {
            "id": "picture",
            "kind": "image",
            "title": "图",
            "asset_id": asset,
            "alt": "测试用红色图",
        }
    )
    point = t.post("/api/teacher/learning-content", json=data).json()
    pid = point["id"]
    pub = t.post(
        f"/api/teacher/learning-content/{pid}/publish",
        json={"expected_version": point["edit_version"]},
    ).json()
    assert s.get(url).status_code == 200
    root = backup_data(main.DB_PATH, tmp_path / "asset-backup")
    validate_backup(root)
    restored = restore_data(root, tmp_path / "restored")
    with sqlite3.connect(restored) as db:
        name = db.execute(
            "SELECT stored_name FROM knowledge_assets WHERE id=?", (asset,)
        ).fetchone()[0]
        assert (restored.parent / "uploads" / name).read_bytes() == image.getvalue()
    t.post(
        f"/api/teacher/learning-content/{pid}/withdraw",
        json={"expected_version": pub["edit_version"]},
    )
    assert s.get(url).status_code == 404


def test_simulation_invariants():
    from app.simulations import simulate
    from app.digital import Config
    from fastapi import HTTPException

    assert (
        simulate(Config(template="race", locked=False, interleaved=True))["frames"][-1][
            "nodes"
        ][0]["value"]
        == 1
    )
    assert (
        simulate(Config(template="race", locked=False, interleaved=False))["frames"][
            -1
        ]["nodes"][0]["value"]
        == 2
    )
    assert (
        simulate(Config(template="race", locked=True, interleaved=True))["frames"][-1][
            "nodes"
        ][0]["value"]
        == 2
    )
    memory = simulate(Config(template="memory"))
    assert all(sum(n["value"] for n in f["nodes"]) == 1024 for f in memory["frames"])
    with pytest.raises(HTTPException):
        simulate(Config(template="memory", capacity=100))
    for cores in (1, 2):
        trace = simulate(
            Config(
                template="concurrency",
                tasks=5,
                cores=cores,
                duration=5,
                arrival_gap=2,
                switch_cost=1,
                io_delay=4,
            )
        )
        for f in trace["frames"]:
            running = [
                n["state"]
                for n in f["nodes"]
                if n["name"].startswith("CPU") and n["state"].startswith("运行")
            ]
            assert len(running) == len(set(running))
        assert all(
            n["state"] == "完成" and n["value"] == 5
            for n in trace["frames"][-1]["nodes"]
            if n["name"].startswith("P")
        )
    for template in [
        "timeshare",
        "printer",
        "layers",
        "perspectives",
        "goals",
        "resources",
        "roles",
        "async",
        "history",
    ]:
        assert len(simulate(Config(template=template))["frames"]) >= 2


def test_multiple_question_types_attempts_and_privacy(clients):
    t, s, b = clients
    point = t.post("/api/teacher/learning-content", json=content()).json()
    pid = point["id"]
    t.post(
        f"/api/teacher/learning-content/{pid}/publish",
        json={"expected_version": point["edit_version"]},
    )
    revision = s.get(f"/api/learning-content/{pid}").json()["revision_id"]
    qs = []
    for kind, options, answer, items in [
        ("single", ["x", "y"], 1, []),
        ("multiple", ["x", "y", "z"], [0, 2], []),
        ("boolean", [], 0, []),
        ("short", [], "参考解释", []),
        ("matching", ["硬件", "应用"], [0, 1], ["CPU", "浏览器"]),
    ]:
        body = {
            "chapter_id": 1,
            "prompt": kind,
            "kind": kind,
            "options": options,
            "correct": answer,
            "items": items,
            "knowledge_ids": [pid],
            "published": True,
        }
        r = t.post("/api/teacher/study/questions", json=body)
        assert r.status_code == 201, r.text
        qs.append(r.json())
    public = s.get(f"/api/study/questions?knowledge_id={pid}").json()
    assert len(public) == 5 and all(
        "correct" not in q and "explanation" not in q for q in public
    )
    answers = {
        str(q["id"]): q["correct"] if q["kind"] != "short" else "学生自己的理解"
        for q in qs
    }
    payload = {
        "request_key": "test-unique-submit-1",
        "knowledge_id": pid,
        "revision_id": revision,
        "answers": answers,
        "versions": {str(q["id"]): q["version"] for q in qs},
    }
    result = s.post("/api/study/submit", json=payload)
    assert result.status_code == 200, result.text
    assert (
        result.json()["score"] == 4
        and result.json()["total"] == 4
        and result.json()["ungraded"] == 1
    )
    assert (
        s.post("/api/study/submit", json=payload).json()["attempt_id"]
        == result.json()["attempt_id"]
    )
    assert len(s.get("/api/study/attempts").json()) == 1
    assert b.get("/api/study/attempts").json() == []
    assert s.get(f"/api/learning-content/{pid}/progress").json()["practice_completed"]
    assert (
        s.post(
            "/api/teacher/study/questions", json={"chapter_id": 1, "prompt": "hack"}
        ).status_code
        == 403
    )
    old = qs[0]
    changed = {k: v for k, v in old.items() if k not in ("id", "version")}
    changed.update(expected_version=old["version"], correct=0)
    assert (
        t.put(f"/api/teacher/study/questions/{old['id']}", json=changed).status_code
        == 200
    )
    payload["request_key"] = "test-unique-submit-2"
    assert s.post("/api/study/submit", json=payload).status_code == 409
    assert s.get("/api/study/attempts").json()[0]["results"][0]["answer"] == 1


def test_multicore_never_executes_same_task_twice_in_one_tick():
    from app.simulations import simulate
    from app.digital import Config

    for tasks in range(1, 6):
        for quantum in (1, 2, 3):
            trace = simulate(
                Config(
                    template="concurrency",
                    tasks=tasks,
                    cores=2,
                    quantum=quantum,
                    duration=5,
                    switch_cost=1,
                )
            )
            previous = 0
            for frame in trace["frames"]:
                running = [
                    n["state"]
                    for n in frame["nodes"]
                    if n["name"].startswith("CPU") and n["state"].startswith("运行")
                ]
                assert len(running) == len(set(running))
                total = sum(
                    n["value"] for n in frame["nodes"] if n["name"].startswith("P")
                )
                assert previous <= total <= previous + 2
                previous = total
            assert previous == tasks * 5


def test_drafts_can_be_incomplete_and_feedback_is_separate_from_notes(clients):
    t, s, b = clients
    data = content()
    data["blocks"].append(
        {"id": "unfinished-image", "kind": "image", "title": "待补配图"}
    )
    saved = t.post("/api/teacher/learning-content", json=data).json()
    pid = saved["id"]
    assert (
        t.post(
            f"/api/teacher/learning-content/{pid}/publish",
            json={"expected_version": saved["edit_version"]},
        ).status_code
        == 422
    )
    data["blocks"].pop()
    data["expected_version"] = saved["edit_version"]
    saved = t.put(f"/api/teacher/learning-content/{pid}", json=data).json()
    assert (
        t.post(
            f"/api/teacher/learning-content/{pid}/publish",
            json={"expected_version": saved["edit_version"]},
        ).status_code
        == 200
    )
    revision = s.get(f"/api/learning-content/{pid}").json()["revision_id"]
    s.put(
        f"/api/learning-content/{pid}/progress",
        json={"revision_id": revision, "note": "只给自己看"},
    )
    assert (
        s.post(
            f"/api/learning-content/{pid}/feedback",
            json={"message": "请解释一下这个例子"},
        ).status_code
        == 201
    )
    summary = t.get("/api/teacher/study/summary").json()
    assert summary["feedback"][0]["message"] == "请解释一下这个例子"
    assert "只给自己看" not in str(summary)
    assert b.get("/api/teacher/study/summary").status_code == 403


def test_restore_and_move_keep_history_and_question_links(clients):
    t, s, _ = clients
    data = content()
    saved = t.post("/api/teacher/learning-content", json=data).json()
    pid = saved["id"]
    v = t.post(
        f"/api/teacher/learning-content/{pid}/publish",
        json={"expected_version": saved["edit_version"]},
    ).json()["edit_version"]
    original_revision = s.get(f"/api/learning-content/{pid}").json()["revision_id"]
    question = t.post(
        "/api/teacher/study/questions",
        json={
            "chapter_id": 1,
            "prompt": "随知识点移动",
            "options": ["a", "b"],
            "correct": 0,
            "published": True,
            "knowledge_ids": [pid],
        },
    ).json()
    data.update(
        chapter_id=2,
        title="移动后的标题",
        printed_pages="任意待校对页",
        expected_version=v,
    )
    saved = t.put(f"/api/teacher/learning-content/{pid}", json=data).json()
    assert s.get(f"/api/learning-content/{pid}").json()["chapter_id"] == 1
    pub = t.post(
        f"/api/teacher/learning-content/{pid}/publish",
        json={"expected_version": saved["edit_version"]},
    ).json()
    assert s.get(f"/api/learning-content/{pid}").json()["chapter_id"] == 2
    q = s.get(f"/api/study/questions?knowledge_id={pid}").json()[0]
    assert q["chapter_id"] == 2 and q["version"] > question["version"]
    restored = t.post(
        f"/api/teacher/learning-content/{pid}/restore",
        json={
            "expected_version": pub["edit_version"],
            "revision_id": original_revision,
        },
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["chapter_id"] == 1
    assert s.get(f"/api/learning-content/{pid}").json()["chapter_id"] == 2
    assert len(t.get(f"/api/teacher/learning-content/{pid}/history").json()) == 3


def test_learning_records_survive_backup_restore_and_new_app_session(
    clients, tmp_path, monkeypatch
):
    from app.persistence import backup_data, restore_data

    t, s, _ = clients
    saved = t.post("/api/teacher/learning-content", json=content()).json()
    pid = saved["id"]
    t.post(
        f"/api/teacher/learning-content/{pid}/publish",
        json={"expected_version": saved["edit_version"]},
    )
    revision = s.get(f"/api/learning-content/{pid}").json()["revision_id"]
    s.put(
        f"/api/learning-content/{pid}/progress",
        json={
            "revision_id": revision,
            "note": "重启后仍存在",
            "read_done": True,
            "position": "concept",
        },
    )
    q = t.post(
        "/api/teacher/study/questions",
        json={
            "chapter_id": 1,
            "prompt": "持久作答",
            "options": ["正确", "错误"],
            "correct": 0,
            "published": True,
            "knowledge_ids": [pid],
        },
    ).json()
    r = s.post(
        "/api/study/submit",
        json={
            "request_key": "persist-test-submit",
            "knowledge_id": pid,
            "revision_id": revision,
            "answers": {str(q["id"]): 0},
            "versions": {str(q["id"]): q["version"]},
        },
    )
    assert r.status_code == 200
    restored = restore_data(
        backup_data(main.DB_PATH, tmp_path / "full-snapshot"), tmp_path / "full-restore"
    )
    with monkeypatch.context() as patch:
        patch.setattr(main, "DB_PATH", restored)
        with TestClient(main.app) as restarted:
            assert (
                restarted.get(f"/api/learning-content/{pid}/progress").status_code
                == 401
            )
            login = restarted.post(
                "/api/auth/login",
                json={"username": "student", "password": "digital-test-password"},
            )
            assert login.status_code == 200
            p = restarted.get(f"/api/learning-content/{pid}/progress").json()
            assert (
                p["note"] == "重启后仍存在"
                and p["read_done"]
                and p["practice_completed"]
            )
            assert restarted.get("/api/my/learning-resume").json()["point"] == pid
            assert restarted.get("/api/study/attempts").json()[0]["score"] == 1


def test_old_textbook_bulk_merge_cannot_bypass_revision_structure(clients):
    t, s, _ = clients
    point = t.post("/api/teacher/learning-content", json=content()).json()
    plan = t.get("/api/teacher/textbook/plan").json()
    r = t.post("/api/teacher/textbook/apply", json={"fingerprint": plan["fingerprint"]})
    assert r.status_code == 409 and "数字教材" in r.json()["detail"]
    kept = next(
        p
        for p in t.get("/api/teacher/learning-content").json()
        if p["id"] == point["id"]
    )
    assert kept["title"] == point["title"] and kept["chapter_id"] == point["chapter_id"]
    assert len(s.get("/api/chapters").json()) == 7
