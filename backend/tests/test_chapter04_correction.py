"""用户确认的误放修复；模拟上一版12项安装，禁止使用工作区真实库。"""

import json
from pathlib import Path

import pytest
from fastapi import HTTPException

from app import main, chapter03, chapter04_correction as correction
from app.course import CHAPTERS
from test_chapter03 import clients, BASE, payload, counts


@pytest.fixture
def misplaced(clients, monkeypatch):
    t, s, source = clients
    with main.database() as db:
        db.execute("UPDATE chapters SET title='同步、通信与死锁' WHERE id=?", (source,))
        target = db.execute(
            "SELECT id FROM chapters WHERE title='内存管理'"
        ).fetchone()[0]
    # Exact old bundle shape, including 3.* sections and the combined U011.
    with monkeypatch.context() as legacy:
        legacy.setattr(chapter03, "current_package", chapter03.load_package)
        r = t.post(BASE + "/publish", json={"chapter_id": source})
        assert r.status_code == 200, r.text
        result = r.json()
    seed = next(c for c in CHAPTERS if c[2] == "死锁的必要条件")
    old = t.post(
        "/api/teacher/knowledge",
        json={
            "chapter_id": source,
            "title": seed[2],
            "content": seed[3],
            "published": True,
        },
    ).json()["id"]
    own = t.post(
        "/api/teacher/knowledge",
        json={
            "chapter_id": source,
            "title": "真实同步内容须保留",
            "content": "教师自己的同步内容",
            "published": True,
        },
    ).json()["id"]
    return t, s, source, target, result, old, own


def snapshot_history():
    with main.database() as db:
        return [
            tuple(r)
            for r in db.execute("SELECT * FROM knowledge_revisions ORDER BY id")
        ]


def test_move_only_registered_units_renumber_split_and_keep_notes(misplaced):
    t, s, source, target, old, legacy, own = misplaced
    point = old["points"][0]["id"]
    api = f"/api/learning-content/{point}"
    before = s.get(api).json()
    note = s.put(
        api + "/progress",
        json={
            "revision_id": before["revision_id"],
            "position": "concept",
            "note": "迁移前的私人笔记",
            "bookmarked": True,
            "read_done": True,
        },
    )
    assert note.status_code == 200
    history = snapshot_history()
    # Keep a pending draft distinct from the student's published text.
    path = f"/api/teacher/learning-content/{point}"
    draft = payload(t.get(path).json())
    draft["title"] = "尚未发布的教师修改"
    assert t.put(path, json=draft).status_code == 200
    r = t.post(BASE + "/correct-location", json={"chapter_id": target})
    assert r.status_code == 200, r.text
    result = r.json()
    assert result["chapter_id"] == target and result["chapter04_correction_v1"]
    assert len(result["points"]) == 13
    assert {p["id"] for p in old["points"]} <= {p["id"] for p in result["points"]}
    assert result["archived_deadlock_example_ids"] == [legacy]
    assert (Path(result["correction_backup"]) / "manifest.json").exists()
    assert s.get(api).json()["chapter_id"] == target
    assert (
        s.get(api).json()["title"] == before["title"]
    )  # pending draft was not published
    assert t.get(path).json()["title"] == draft["title"]
    progress = s.get(api + "/progress").json()
    assert (
        progress["note"] == "迁移前的私人笔记"
        and progress["read_done"]
        and progress["bookmarked"]
    )
    with main.database() as db:
        for row in history:
            assert (
                tuple(
                    db.execute(
                        "SELECT * FROM knowledge_revisions WHERE id=?", (row[0],)
                    ).fetchone()
                )
                == row
            )
        assert (
            db.execute(
                "SELECT note FROM knowledge_progress WHERE point_id=? AND revision_id=?",
                (point, before["revision_id"]),
            ).fetchone()[0]
            == "迁移前的私人笔记"
        )
        assert (
            db.execute(
                "SELECT chapter_id FROM knowledge_points WHERE id=?", (own,)
            ).fetchone()[0]
            == source
        )
        assert not db.execute(
            "SELECT archived_at FROM knowledge_points WHERE id=?", (own,)
        ).fetchone()[0]
        assert (
            db.execute(
                "SELECT textbook_number FROM chapters WHERE id=?", (target,)
            ).fetchone()[0]
            == 4
        )
    assert s.get(f"/api/learning-content/{legacy}").status_code == 404
    assert s.get(f"/api/learning-content/{own}").status_code == 200
    sections = t.get("/api/sections", params={"chapter_id": target}).json()
    used = {r["id"]: r["code"] for r in sections}
    visible = s.get("/api/learning-content", params={"chapter_id": target}).json()
    multi = next(
        x
        for x in visible
        if x["id"] == next(p["id"] for p in old["points"] if p["code"] == "CH03-U011")
    )
    ipt = next(x for x in visible if x["code"] == "CH03-U013")
    assert used[multi["section_id"]] == "4.3.6" and used[ipt["section_id"]] == "4.3.5"
    assert multi["title"] == "多级页表的规模与查找"
    multi = s.get(f"/api/learning-content/{multi['id']}").json()
    ipt = s.get(f"/api/learning-content/{ipt['id']}").json()
    assert not any(b["id"] == "advanced" for b in multi["blocks"])
    assert (
        "反置页表" in ipt["title"]
        and "12296" in next(b for b in ipt["blocks"] if b["kind"] == "case")["text"]
    )
    before_counts = counts()
    backups = list(Path(result["correction_backup"]).parent.iterdir())
    assert t.post(BASE + "/correct-location", json={"chapter_id": target}).json()[
        "already_corrected"
    ]
    assert (
        counts() == before_counts
        and list(Path(result["correction_backup"]).parent.iterdir()) == backups
    )
    # The old import ledger now points to the corrected target, not an obsolete chapter.
    assert t.post(BASE + "/publish", json={"chapter_id": target}).json()[
        "already_published"
    ]


def test_permission_wrong_target_and_missing_ledger(clients, misplaced):
    t, s, source, target, *_ = misplaced
    assert (
        s.post(BASE + "/correct-location", json={"chapter_id": target}).status_code
        == 403
    )
    before = counts()
    assert (
        t.post(BASE + "/correct-location", json={"chapter_id": source}).status_code
        == 422
    )
    assert counts() == before


def test_late_failure_rolls_back_relocation_split_archive_and_ledger(
    misplaced, monkeypatch
):
    t, s, source, target, old, legacy, own = misplaced
    before = counts()
    history = snapshot_history()

    def fail(*args):
        raise HTTPException(422, "模拟末尾归档失败")

    monkeypatch.setattr(correction, "archive_old_example", fail)
    assert (
        t.post(BASE + "/correct-location", json={"chapter_id": target}).status_code
        == 422
    )
    assert counts() == before and snapshot_history() == history
    with main.database() as db:
        assert (
            db.execute("SELECT chapter_id FROM chapter_content_imports").fetchone()[0]
            == source
        )
        assert all(
            db.execute(
                "SELECT chapter_id FROM knowledge_points WHERE id=?", (p["id"],)
            ).fetchone()[0]
            == source
            for p in old["points"]
        )
        assert not db.execute(
            "SELECT archived_at FROM knowledge_points WHERE id=?", (legacy,)
        ).fetchone()[0]
        assert not db.execute(
            "SELECT count(*) FROM sections WHERE chapter_id=?", (target,)
        ).fetchone()[0]


def test_auto_correction_uses_course_and_unique_title_and_is_repeat_safe(
    misplaced, monkeypatch
):
    t, s, source, target, old, legacy, own = misplaced
    monkeypatch.setenv("CHAPTER04_AUTO_CORRECT", "1")
    correction.auto_correct()
    with main.database() as db:
        row = db.execute(
            "SELECT chapter_id,result_json FROM chapter_content_imports"
        ).fetchone()
        assert (
            row["chapter_id"] == target
            and json.loads(row["result_json"])["chapter04_correction_v1"]
        )
    before = counts()
    history = snapshot_history()
    correction.auto_correct()
    assert counts() == before and snapshot_history() == history


def test_ambiguous_memory_targets_do_not_trigger_auto_write(misplaced, monkeypatch):
    t, s, source, target, *_ = misplaced
    assert (
        t.post(
            "/api/teacher/chapters", json={"title": "存储管理", "published": True}
        ).status_code
        == 201
    )
    monkeypatch.setenv("CHAPTER04_AUTO_CORRECT", "1")
    before = counts()
    history = snapshot_history()
    correction.auto_correct()
    assert counts() == before and snapshot_history() == history
    with main.database() as db:
        assert (
            db.execute("SELECT chapter_id FROM chapter_content_imports").fetchone()[0]
            == source
        )


def test_current_memory_install_is_renumbered_without_duplicate_point_ids(clients):
    t, s, cid = clients
    with main.database() as db:
        db.execute("UPDATE chapters SET title='存储管理' WHERE id=?", (cid,))
    result = t.post(BASE + "/publish", json={"chapter_id": cid}).json()
    ids = {p["id"] for p in result["points"]}
    r = t.post(BASE + "/correct-location", json={"chapter_id": cid})
    assert r.status_code == 200, r.text
    assert {p["id"] for p in r.json()["points"]} == ids
    assert len(ids) == 13
    assert all(
        x["code"].startswith("4.")
        for x in t.get("/api/sections", params={"chapter_id": cid}).json()
    )


def test_shared_source_section_is_copied_not_stolen(misplaced):
    t, s, source, target, old, *_ = misplaced
    section = old["sections"]["3.1"]
    other = t.post(
        "/api/teacher/learning-content",
        json={
            "chapter_id": source,
            "section_id": section,
            "title": "共享小节中的其他教师草稿",
        },
    ).json()
    r = t.post(BASE + "/correct-location", json={"chapter_id": target})
    assert r.status_code == 200, r.text
    assert r.json()["sections"]["4.1"] != section
    with main.database() as db:
        assert (
            db.execute(
                "SELECT chapter_id FROM sections WHERE id=?", (section,)
            ).fetchone()[0]
            == source
        )
        assert (
            db.execute(
                "SELECT chapter_id FROM knowledge_points WHERE id=?", (other["id"],)
            ).fetchone()[0]
            == source
        )


def test_conflicting_target_directory_requires_mapping_without_partial_move(misplaced):
    t, s, source, target, old, *_ = misplaced
    section = t.post(
        "/api/teacher/sections",
        json={"chapter_id": target, "code": "4.1", "title": "已经存在的教师目录"},
    ).json()
    history = snapshot_history()
    before = counts()
    assert (
        t.post(BASE + "/correct-location", json={"chapter_id": target}).status_code
        == 409
    )
    assert snapshot_history() == history and counts() == before
    moved = t.post(
        BASE + "/correct-location",
        json={"chapter_id": target, "section_map": {"4.1": section["id"]}},
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["sections"]["4.1"] == section["id"]
    assert (
        next(
            r
            for r in t.get("/api/sections", params={"chapter_id": target}).json()
            if r["id"] == section["id"]
        )["title"]
        == section["title"]
    )


def test_shared_question_blocks_move_then_moves_with_all_linked_units(misplaced):
    t, s, source, target, old, legacy, own = misplaced
    with main.database() as db:
        qid = db.execute(
            "INSERT INTO questions(chapter_id,prompt,options,answer,explanation,published) VALUES(?,?,?,?,?,1)",
            (source, "共用正式题", '["A","B"]', 0, "说明"),
        ).lastrowid
        for pid in (old["points"][0]["id"], old["points"][1]["id"], own):
            db.execute("INSERT INTO question_knowledge VALUES(?,?)", (qid, pid))
    before = counts()
    history = snapshot_history()
    assert (
        t.post(BASE + "/correct-location", json={"chapter_id": target}).status_code
        == 409
    )
    assert counts() == before and snapshot_history() == history
    with main.database() as db:
        db.execute(
            "DELETE FROM question_knowledge WHERE question_id=? AND point_id=?",
            (qid, own),
        )
    r = t.post(BASE + "/correct-location", json={"chapter_id": target})
    assert r.status_code == 200, r.text
    with main.database() as db:
        assert (
            db.execute(
                "SELECT chapter_id FROM questions WHERE id=?", (qid,)
            ).fetchone()[0]
            == target
        )


def test_withdrawn_multilevel_and_new_ipt_are_not_silently_published(misplaced):
    t, s, source, target, old, *_ = misplaced
    pid = next(p["id"] for p in old["points"] if p["code"] == "CH03-U011")
    path = f"/api/teacher/learning-content/{pid}"
    point = t.get(path).json()
    assert (
        t.post(
            path + "/withdraw", json={"expected_version": point["edit_version"]}
        ).status_code
        == 200
    )
    r = t.post(BASE + "/correct-location", json={"chapter_id": target})
    assert r.status_code == 200, r.text
    ipt = next(p["id"] for p in r.json()["points"] if p["code"] == "CH03-U013")
    assert s.get(f"/api/learning-content/{pid}").status_code == 404
    assert s.get(f"/api/learning-content/{ipt}").status_code == 404


def test_other_deadlock_content_is_not_archived_by_title_alone(misplaced):
    t, s, source, target, old, *_ = misplaced
    own = t.post(
        "/api/teacher/knowledge",
        json={
            "chapter_id": source,
            "title": "死锁的必要条件",
            "content": "教师自己的详细分析，与初始化示例不同。",
            "published": True,
        },
    ).json()["id"]
    r = t.post(BASE + "/correct-location", json={"chapter_id": target})
    assert r.status_code == 200, r.text
    assert own not in r.json()["archived_deadlock_example_ids"]
    assert s.get(f"/api/learning-content/{own}").status_code == 200


def test_inconsistent_course_ledger_cannot_move_content_across_courses(misplaced):
    t, s, source, target, *_ = misplaced
    with main.database() as db:
        other = db.execute(
            "INSERT INTO courses(title,published) VALUES('其他课程',1)"
        ).lastrowid
        db.execute("UPDATE chapters SET course_id=? WHERE id=?", (other, source))
    before = counts()
    history = snapshot_history()
    assert (
        t.post(BASE + "/correct-location", json={"chapter_id": target}).status_code
        == 409
    )
    assert counts() == before and snapshot_history() == history
