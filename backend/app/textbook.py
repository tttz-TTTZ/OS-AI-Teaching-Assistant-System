"""显式预览再应用教材目录；合并关联、归档旧目录，保留内容ID与所有者。"""

import hashlib
import json
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from .auth import teacher
from .persistence import backup_data, storage_lock

router = APIRouter(prefix="/api/teacher/textbook", dependencies=[Depends(teacher)])
CHAPTERS = [
    (1, "操作系统概论", 11, 64, ["操作系统概述"]),
    (2, "处理器管理", 65, 132, ["进程与线程", "处理机调度"]),
    (3, "同步、通信与死锁", 133, 202, ["进程同步与死锁"]),
    (4, "存储管理", 203, 264, ["内存管理"]),
    (5, "设备管理", 265, 306, ["I/O 管理", "I/O管理"]),
    (6, "文件管理", 307, 366, []),
    (7, "操作系统安全与保护", 367, 411, []),
]


def database():
    from .main import database as context

    return context()


def build_plan(db):
    chapters = [
        dict(r)
        for r in db.execute(
            "SELECT * FROM chapters WHERE course_id=1 AND archived_at IS NULL ORDER BY id"
        )
    ]
    changes = []
    for number, title, start, end, old_names in CHAPTERS:
        candidates = [
            c for c in chapters if c["title"] == title or c["title"] in old_names
        ]
        canonical = [c for c in candidates if c["title"] == title]
        if len(canonical) > 1 or len({c["title"] for c in candidates}) != len(
            candidates
        ):
            raise HTTPException(409, "存在同名章节，请先人工确认，未修改数据")
        target = canonical[0] if canonical else candidates[0] if candidates else None
        changes.append(
            {
                "number": number,
                "title": title,
                "pdf_start": start,
                "pdf_end": end,
                "target_id": target["id"] if target else None,
                "source_ids": [c["id"] for c in candidates],
                "source_titles": [c["title"] for c in candidates],
            }
        )
    references = {
        table: [
            tuple(r)
            for r in db.execute(f"SELECT id,chapter_id FROM {table} ORDER BY id")
        ]
        for table in ["documents", "knowledge_points", "questions"]
    }
    fingerprint = hashlib.sha256(
        json.dumps(
            {"chapters": chapters, "references": references},
            ensure_ascii=False,
            sort_keys=True,
        ).encode()
    ).hexdigest()
    return {
        "fingerprint": fingerprint,
        "changes": changes,
        "note": "仅对已识别的旧示例目录和同名正式目录迁移；其他自定义章节保留。源章节归档，不删除内容。",
    }


@router.get("/plan")
def plan():
    with database() as db:
        return build_plan(db)


class Apply(BaseModel):
    fingerprint: str


@router.post("/apply")
def apply(body: Apply):
    from .main import DB_PATH

    with database() as db:
        if build_plan(db)["fingerprint"] != body.fingerprint:
            raise HTTPException(409, "数据已变化，请重新预览")
    backup = (
        DB_PATH.parent
        / "backups"
        / ("textbook-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f"))
    )
    backup_data(DB_PATH, backup)
    with storage_lock(DB_PATH), database() as db:
        db.execute("BEGIN IMMEDIATE")
        result = build_plan(db)
        if result["fingerprint"] != body.fingerprint:
            raise HTTPException(409, "备份期间数据已变化，请重新预览")
        for c in result["changes"]:
            target = c["target_id"]
            if target is None:
                target = db.execute(
                    "INSERT INTO chapters(title,description,course_id,sort_order,published) VALUES (?,?,1,?,1)",
                    (c["title"], "教材目录；知识点内容待教师整理", c["number"] * 10),
                ).lastrowid
            db.execute(
                "UPDATE chapters SET title=?,sort_order=?,textbook_number=?,pdf_start=?,pdf_end=? WHERE id=?",
                (
                    c["title"],
                    c["number"] * 10,
                    c["number"],
                    c["pdf_start"],
                    c["pdf_end"],
                    target,
                ),
            )
            for source in c["source_ids"]:
                if source != target:
                    for table in ["knowledge_points", "questions", "documents"]:
                        db.execute(
                            f"UPDATE {table} SET chapter_id=? WHERE chapter_id=?",
                            (target, source),
                        )
                    db.execute(
                        "UPDATE chapters SET archived_at=CURRENT_TIMESTAMP,published=0 WHERE id=?",
                        (source,),
                    )
            db.execute(
                "UPDATE documents SET chapter=? WHERE chapter_id=?",
                (c["title"], target),
            )
    return {"status": "applied", "backup": backup.name, "chapters": 7}
