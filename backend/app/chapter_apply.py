"""用户授权的一次性第一章替换。先成套备份；归档旧内容，不删除个人记录。"""

import hashlib
import json
import logging
import os
from datetime import datetime, timezone
from fastapi import Depends, HTTPException
from .auth import teacher
from .access import visible_chapter
from .chapter_content import (
    router,
    ImportRequest,
    import_into,
    load_package,
    content_for,
    PACKAGE,
)
from .digital import database, get, save_revision, validate_refs

LOG = logging.getLogger(__name__)


def applied_result(db, course_id):
    row = db.execute(
        "SELECT result_json FROM chapter_content_imports WHERE course_id=? AND package_id=?",
        (course_id, load_package()["package_id"]),
    ).fetchone()
    result = json.loads(row["result_json"]) if row else None
    return result if result and result.get("direct_applied") else None


def apply_chapter(chapter_id, user):
    from .main import DB_PATH
    from .persistence import backup_data

    with database() as db:
        chapter = visible_chapter(db, chapter_id, user)
        done = applied_result(db, chapter["course_id"])
        if done:
            if done["chapter_id"] != chapter_id:
                raise HTTPException(409, "本课程已经应用到另一章，未再次覆盖")
            return {**done, "already_applied": True}
        if not chapter["course_published"]:
            raise HTTPException(409, "所属课程尚未发布，未改变课程公开范围")
    backup = backup_data(
        DB_PATH,
        DB_PATH.parent
        / "backups"
        / (
            "before-chapter01-apply-"
            + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")
        ),
    )
    package = load_package()
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        chapter = visible_chapter(db, chapter_id, user)
        done = applied_result(db, chapter["course_id"])
        if done:
            if done["chapter_id"] != chapter_id:
                raise HTTPException(409, "本课程已经应用到另一章，未再次覆盖")
            return {**done, "already_applied": True}
        if not chapter["course_published"]:
            raise HTTPException(409, "所属课程尚未发布")
        result = import_into(
            db, ImportRequest(chapter_id=chapter_id), user, replacing=True
        )
        points = {p["code"]: p for p in result["points"]}
        # 恢复为本次授权的规范内容，但之后的启动不会覆盖教师再修改的版本。
        for item in package["items"]:
            if not item["importable"]:
                continue
            record = points[item["code"]]
            point = get(db, "knowledge_points", record["id"])
            if point["chapter_id"] != chapter_id:
                raise HTTPException(409, "已导入知识点发生跨章移动，未覆盖其他章")
            old = json.loads(
                get(db, "knowledge_revisions", point["draft_revision_id"])["body"]
            )
            section_id = old.get("section_id")
            if (
                not section_id
                or get(db, "sections", section_id)["chapter_id"] != chapter_id
            ):
                raise HTTPException(409, "已有目录归属变化，未覆盖")
            body = content_for(package, item, chapter_id, section_id)
            body.related_ids = [points[c]["id"] for c in item["related"] if c in points]
            body.expected_version = point["edit_version"]
            # 首次导入已经是规范草稿，不再重复增加完全相同的修订。
            canonical = body.model_dump(exclude={"expected_version"})
            if canonical != old:
                saved = save_revision(db, point, body, user)
                record.update(
                    revision_id=saved["revision_id"], edit_version=saved["edit_version"]
                )
            validate_refs(db, body, point["id"])
            required = {"intro", "concept", "explanation", "case", "mistake", "summary"}
            if not body.objectives.strip() or not required.issubset(
                {b.kind for b in body.blocks if b.text.strip()}
            ):
                raise HTTPException(422, "内容包不完整，未替换第一章")
        keep = {p["id"] for p in result["points"]}
        archived = []
        for row in db.execute(
            "SELECT * FROM knowledge_points WHERE chapter_id=? AND archived_at IS NULL",
            (chapter_id,),
        ).fetchall():
            if row["id"] in keep:
                continue
            # 保留原发布标记、版本、文档题目和个人记录，仅从当前课程学习列表归档。
            db.execute(
                "UPDATE knowledge_points SET archived_at=CURRENT_TIMESTAMP,edit_version=edit_version+1 WHERE id=?",
                (row["id"],),
            )
            db.execute(
                "INSERT INTO content_events(point_id,actor_id,action,revision_id) VALUES (?,?,?,?)",
                (
                    row["id"],
                    user["id"],
                    "chapter01_replace_archive",
                    row["published_revision_id"],
                ),
            )
            archived.append(row["id"])
        db.execute("UPDATE chapters SET published=1 WHERE id=?", (chapter_id,))
        section_ids = set()
        for record in result["points"]:
            point = get(db, "knowledge_points", record["id"])
            body = json.loads(
                get(db, "knowledge_revisions", point["draft_revision_id"])["body"]
            )
            section_ids.add(body["section_id"])
            db.execute(
                "UPDATE sections SET published=1 WHERE id=?", (body["section_id"],)
            )
            db.execute(
                "UPDATE knowledge_points SET published=1,archived_at=NULL,published_revision_id=draft_revision_id,title=?,content=?,lab_path=?,edit_version=edit_version+1 WHERE id=?",
                (
                    body["title"],
                    "\n\n".join(b["text"] for b in body["blocks"]),
                    "/student/experiments" if body["lab"] else None,
                    point["id"],
                ),
            )
            db.execute(
                "INSERT INTO content_events(point_id,actor_id,action,revision_id) VALUES (?,?,?,?)",
                (
                    point["id"],
                    user["id"],
                    "chapter01_direct_publish",
                    point["draft_revision_id"],
                ),
            )
        # RR必须实际重算通过，不把“省去人工审核”等同于跳过计算校验。
        from .scheduling import calculate, ScheduleInput

        exp = get(db, "experiments", result["experiment_id"])
        exp_body = json.loads(
            get(db, "experiment_revisions", exp["draft_revision_id"])["body"]
        )
        if (
            exp_body["chapter_id"] != chapter_id
            or exp_body["algorithm"] != "rr"
            or exp_body["knowledge_ids"] != [points["CH01-K009"]["id"]]
        ):
            raise HTTPException(409, "RR实验归属或算法已变化，未替换")
        computed = calculate("rr", ScheduleInput(**exp_body["defaults"]))
        # 修改过的输入仍可验证，但发布本章固定的示例必须与报告一致。
        if exp_body["defaults"] != {
            "processes": [
                {"pid": "P1", "arrival": 0.0, "burst": 5.0},
                {"pid": "P2", "arrival": 0.0, "burst": 3.0},
            ],
            "quantum": 2.0,
        }:
            raise HTTPException(409, "RR示例输入已改变，未替换")
        if computed["average_waiting"] != 3.5 or computed["average_turnaround"] != 7.5:
            raise HTTPException(422, "RR结果与报告不一致，未替换")
        if not all(
            exp_body[k].strip() for k in ("objectives", "instructions", "tasks")
        ):
            raise HTTPException(422, "RR实验说明不完整，未替换")
        if exp_body["title"].endswith("（PPT审核草稿）"):
            from .experiments import ExperimentInput, save

            exp_body["title"] = exp_body["title"].removesuffix("（PPT审核草稿）")
            save(db, exp["id"], ExperimentInput(**exp_body), user)
            exp = get(db, "experiments", exp["id"])
        db.execute(
            "INSERT OR IGNORE INTO experiment_previews VALUES (?,?)",
            (user["id"], exp["draft_revision_id"]),
        )
        db.execute(
            "UPDATE experiments SET published_revision_id=draft_revision_id,edit_version=edit_version+1 WHERE id=?",
            (exp["id"],),
        )
        result.update(
            direct_applied=True,
            already_applied=False,
            archived_point_ids=archived,
            backup=str(backup),
            published_count=len(keep),
        )
        db.execute(
            "UPDATE chapter_content_imports SET package_hash=?,result_json=? WHERE course_id=? AND package_id=?",
            (
                hashlib.sha256(PACKAGE.read_bytes()).hexdigest(),
                json.dumps(result, ensure_ascii=False),
                chapter["course_id"],
                package["package_id"],
            ),
        )
        return result


@router.post("/chapter01/apply")
def apply_endpoint(body: ImportRequest, user=Depends(teacher)):
    return apply_chapter(body.chapter_id, user)


def auto_apply_chapter():
    """仅识别唯一第一章与已有教师；不以数据库ID=1猜测。不自动处理多课程。"""
    if os.getenv("CHAPTER01_AUTO_APPLY", "1") == "0":
        return
    with database() as db:
        teacher_row = db.execute(
            "SELECT * FROM users WHERE role='teacher' AND active=1 ORDER BY id LIMIT 1"
        ).fetchone()
        if not teacher_row:
            return
        # 有明确教材章号时优先采用；没有时仅匹配既定中文标题。
        candidates = db.execute(
            "SELECT ch.* FROM chapters ch JOIN courses c ON c.id=ch.course_id WHERE ch.archived_at IS NULL AND c.published=1 AND ch.textbook_number=1"
        ).fetchall()
        if not candidates:
            candidates = db.execute(
                "SELECT ch.* FROM chapters ch JOIN courses c ON c.id=ch.course_id WHERE ch.archived_at IS NULL AND c.published=1 AND ch.textbook_number IS NULL AND ch.title IN ('操作系统概论','操作系统概述','操作系统概观','第一章 操作系统概论','第1章 操作系统概论')"
            ).fetchall()
        if len(candidates) != 1:
            LOG.warning(
                "第一章未自动替换：无法唯一定位第一章；可用教师端应用入口指定，未改课程内容。"
            )
            return
        target = candidates[0]["id"]
        actor = dict(teacher_row)
    try:
        result = apply_chapter(target, actor)
        if not result.get("already_applied"):
            LOG.info(
                "第一章新内容已应用：%s项；旧内容已备份并归档。",
                result["published_count"],
            )
    except (HTTPException, ValueError, OSError) as exc:
        LOG.warning(
            "第一章未自动替换：%s；原发布内容保留。", getattr(exc, "detail", str(exc))
        )


@router.get("/chapter01/application")
def application_status(user=Depends(teacher)):
    with database() as db:
        rows = db.execute(
            "SELECT result_json FROM chapter_content_imports WHERE package_id=?",
            (load_package()["package_id"],),
        ).fetchall()
    return {
        "applications": [
            data
            for r in rows
            if (data := json.loads(r["result_json"])).get("direct_applied")
        ]
    }
