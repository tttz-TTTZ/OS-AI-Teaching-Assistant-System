"""用户授权的定向修复：导入登记定位；备份、事务迁移、4.*编号及页表拆分。"""

import json
import logging
import os
from datetime import datetime, timezone

from fastapi import Depends, HTTPException

from .auth import teacher
from .access import visible_chapter
from .chapter_content import router
from .chapter_import import resolve_sections
from .chapter03 import ImportRequest, load_package, current_package, content_for
from .chapter04_content import section_code, canonical_name, target_is_memory
from .digital import (
    Action,
    Content,
    body_of,
    database,
    get,
    save_revision,
    change_publication_in,
)

LOG = logging.getLogger(__name__)
MARK = "chapter04_correction_v1"


def entry_for(db, course_id):
    row = db.execute(
        "SELECT * FROM chapter_content_imports WHERE course_id=? AND package_id=?",
        (course_id, load_package()["package_id"]),
    ).fetchone()
    if not row:
        raise HTTPException(409, "本课程没有存储管理导入登记；未猜测或移动内容")
    return dict(row)


def rows_for(db, entry):
    result = json.loads(entry["result_json"])
    expected = {f"CH03-U{i:03}" for i in range(1, 13)}
    codes = [p["code"] for p in result["points"]]
    if (
        set(codes) not in (expected, expected | {"CH03-U013"})
        or len(codes) != len(set(codes))
        or len({p["id"] for p in result["points"]}) != len(codes)
    ):
        raise HTTPException(409, "导入登记不是完整的12个存储管理单元；未迁移")
    rows = []
    for record in result["points"]:
        point = get(db, "knowledge_points", record["id"])
        if (
            point["archived_at"]
            or point["chapter_id"] != entry["chapter_id"]
            or not point["digital_managed"]
        ):
            raise HTTPException(409, "登记中的知识点已归档或移出原章；未自动接管")
        history = db.execute(
            "SELECT body FROM knowledge_revisions WHERE point_id=?", (point["id"],)
        ).fetchall()
        if not any(
            json.loads(r["body"]).get("code") == record["code"] for r in history
        ):
            raise HTTPException(409, "登记与知识点历史不符；未迁移")
        rows.append((record, point))
    return result, rows


def archive_old_example(db, chapter_id, user):
    from .course import CHAPTERS

    seed = next(c for c in CHAPTERS if c[2] == "死锁的必要条件")
    rows = db.execute(
        "SELECT * FROM knowledge_points WHERE chapter_id=? AND title=? AND content=? AND digital_managed=0 AND archived_at IS NULL",
        (chapter_id, seed[2], seed[3]),
    ).fetchall()
    ids = []
    for row in rows:
        db.execute(
            "UPDATE knowledge_points SET archived_at=CURRENT_TIMESTAMP,edit_version=edit_version+1 WHERE id=?",
            (row["id"],),
        )
        db.execute(
            "INSERT INTO content_events(point_id,actor_id,action,revision_id) VALUES(?,?,?,NULL)",
            (row["id"], user["id"], "chapter04_old_deadlock_archive"),
        )
        ids.append(row["id"])
    return ids


def split_multilevel(body):
    old = next(i for i in load_package()["items"] if i["code"] == "CH03-U011")
    new = next(i for i in current_package()["items"] if i["code"] == "CH03-U011")
    for field in ("title", "summary"):
        if body.get(field) == old[field]:
            body[field] = new[field]
    original = {b["id"]: b for b in old["blocks"]}
    replacement = {b["id"]: b for b in new["blocks"]}
    blocks = []
    # Model_dump contains defaults; compare using the same Pydantic normalization.
    from .digital import Block

    for block in body["blocks"]:
        canonical = original.get(block["id"])
        if canonical and block == Block(**canonical).model_dump():
            if block["id"] not in replacement:
                continue
            block = Block(**replacement[block["id"]]).model_dump()
        blocks.append(block)
    body["blocks"] = blocks
    return body


def copy_notes(db, point_id, old_revision, new_revision):
    if not old_revision:
        return
    db.execute(
        """INSERT INTO knowledge_progress(user_id,point_id,revision_id,read_done,self_assessed,position,note,bookmarked,version,updated_at)
        SELECT user_id,point_id,?,read_done,self_assessed,position,note,bookmarked,version,updated_at
        FROM knowledge_progress WHERE point_id=? AND revision_id=?""",
        (new_revision, point_id, old_revision),
    )


def correct_into(db, body, user, backup):
    target = visible_chapter(db, body.chapter_id, user)
    if not target_is_memory(target):
        raise HTTPException(422, "目标必须是实际的存储管理或内存管理章节")
    entry = entry_for(db, target["course_id"])
    result = json.loads(entry["result_json"])
    if result.get(MARK):
        if entry["chapter_id"] != body.chapter_id:
            raise HTTPException(409, "已完成修正，不重复迁移到其他章")
        return {**result, "already_corrected": True}
    source = visible_chapter(db, entry["chapter_id"], user)
    if source["course_id"] != target["course_id"]:
        raise HTTPException(409, "导入登记的课程归属不一致；不跨课程迁移")
    result, rows = rows_for(db, entry)
    ids = {p["id"] for _, p in rows}
    # Resolve actual current section metadata. Never move shared source sections wholesale.
    specs = []
    used = set()
    for logical, ident in result["sections"].items():
        section = get(db, "sections", ident)
        if section["chapter_id"] != source["id"]:
            raise HTTPException(409, "原目录归属已改变；未迁移")
        newcode = section_code(logical)
        specs.append(
            dict(
                code=newcode,
                title=section["title"],
                old_id=ident,
                sort_order=section["sort_order"],
            )
        )
        used.add(ident)
    snapshots = []
    for record, point in rows:
        pub = (
            body_of(db, point, point["published_revision_id"])
            if point["published_revision_id"]
            else None
        )
        draft = body_of(db, point)
        for content in [pub, draft]:
            if not content:
                continue
            if content["chapter_id"] != source["id"] or (
                content.get("section_id") and content["section_id"] not in used
            ):
                raise HTTPException(409, "知识点另有手工跨章/目录调整；未覆盖修改")
        snapshots.append((record, point, pub, draft))
    # Do not silently move shared questions belonging to unrelated chapters.
    question_ids = set()
    for pid in ids:
        for row in db.execute(
            "SELECT question_id FROM question_knowledge WHERE point_id=?", (pid,)
        ):
            qid = row[0]
            for other in db.execute(
                "SELECT k.id,k.chapter_id FROM question_knowledge q JOIN knowledge_points k ON k.id=q.point_id WHERE q.question_id=?",
                (qid,),
            ):
                if other["id"] not in ids and other["chapter_id"] != target["id"]:
                    raise HTTPException(
                        409, "存在与原章其他内容共用的正式题；未自动改动题库归属"
                    )
            question_ids.add(qid)
    published = any(p["published"] for _, p in rows)
    if published and not target["course_published"]:
        raise HTTPException(409, "课程未发布；未扩大公开范围")
    # For an in-place renumber, section IDs and all unrelated links remain unchanged.
    old_to_new = {}
    section_ids = {}
    if source["id"] == target["id"]:
        if body.section_map:
            raise HTTPException(422, "原章内修正无需重新映射小节")
        for s in specs:
            clashes = db.execute(
                "SELECT id FROM sections WHERE chapter_id=? AND code=? AND id<>?",
                (target["id"], s["code"], s["old_id"]),
            ).fetchall()
            if clashes:
                raise HTTPException(409, "目标4.*目录存在重号；未覆盖")
            db.execute(
                "UPDATE sections SET code=? WHERE id=?", (s["code"], s["old_id"])
            )
            old_to_new[s["old_id"]] = s["old_id"]
            section_ids[s["code"]] = s["old_id"]
    else:
        resolved = resolve_sections(db, {"sections": specs}, body)
        if any(s["conflict"] for s in resolved):
            raise HTTPException(409, "目标目录编号冲突；请明确小节映射后重试")
        shared = set()
        for other in db.execute(
            "SELECT * FROM knowledge_points WHERE archived_at IS NULL"
        ):
            if other["id"] in ids or not other["digital_managed"]:
                continue
            for revision in {
                other["draft_revision_id"],
                other["published_revision_id"],
            } - {None}:
                section_id = json.loads(
                    get(db, "knowledge_revisions", revision)["body"]
                ).get("section_id")
                if section_id in used:
                    shared.add(section_id)
        for s in resolved:
            ident = old_to_new.get(s["old_id"]) or s["id"]
            if not ident and s["old_id"] not in shared:
                # Keep section IDs when exclusively used by these units; no orphan headings.
                db.execute(
                    "UPDATE sections SET chapter_id=?,code=? WHERE id=?",
                    (target["id"], s["code"], s["old_id"]),
                )
                ident = s["old_id"]
            if not ident:
                ident = db.execute(
                    "INSERT INTO sections(chapter_id,code,title,sort_order,published) VALUES(?,?,?,?,0)",
                    (target["id"], s["code"], s["title"], s["sort_order"]),
                ).lastrowid
            old_to_new[s["old_id"]] = ident
            section_ids[s["code"]] = ident
    if published:
        db.execute(
            "UPDATE chapters SET published=1,textbook_number=4 WHERE id=?",
            (target["id"],),
        )
        for ident in set(section_ids.values()):
            db.execute("UPDATE sections SET published=1 WHERE id=?", (ident,))
    else:
        db.execute("UPDATE chapters SET textbook_number=4 WHERE id=?", (target["id"],))
    # Set all moved point locations together, so references/shared questions remain consistent.
    for pid in ids:
        db.execute(
            "UPDATE knowledge_points SET chapter_id=? WHERE id=?", (target["id"], pid)
        )
    for qid in question_ids:
        db.execute(
            "UPDATE questions SET chapter_id=?,version=version+1 WHERE id=?",
            (target["id"], qid),
        )
    points = []
    for record, point, pub, draft in snapshots:

        def relocate(content):
            content = dict(content)
            content["chapter_id"] = target["id"]
            content["section_id"] = old_to_new.get(content.get("section_id"))
            if record["code"] == "CH03-U011":
                content = split_multilevel(content)
            return content

        pub_new = None
        if point["published"]:
            current = get(db, "knowledge_points", point["id"])
            saved = save_revision(
                db,
                current,
                Content(**relocate(pub), expected_version=current["edit_version"]),
                user,
            )
            change_publication_in(
                db,
                point["id"],
                "publish",
                Action(expected_version=saved["edit_version"]),
                user,
            )
            pub_new = saved["revision_id"]
            copy_notes(db, point["id"], point["published_revision_id"], pub_new)
            valid = {b["id"] for b in relocate(pub)["blocks"]}
            for progress in db.execute(
                "SELECT user_id,position FROM knowledge_progress WHERE point_id=? AND revision_id=?",
                (point["id"], pub_new),
            ).fetchall():
                if progress["position"] and progress["position"] not in valid:
                    db.execute(
                        "UPDATE knowledge_progress SET position='' WHERE user_id=? AND point_id=? AND revision_id=?",
                        (progress["user_id"], point["id"], pub_new),
                    )
        if (
            not point["published"]
            or point["draft_revision_id"] != point["published_revision_id"]
        ):
            current = get(db, "knowledge_points", point["id"])
            save_revision(
                db,
                current,
                Content(**relocate(draft), expected_version=current["edit_version"]),
                user,
            )
        current = get(db, "knowledge_points", point["id"])
        points.append(
            dict(
                code=record["code"],
                id=point["id"],
                revision_id=current["draft_revision_id"],
                edit_version=current["edit_version"],
            )
        )
        db.execute(
            "INSERT INTO content_events(point_id,actor_id,action,revision_id) VALUES(?,?,?,?)",
            (
                point["id"],
                user["id"],
                "chapter04_relocate",
                current["draft_revision_id"],
            ),
        )
    if not any(p["code"] == "CH03-U013" for p in points):
        package = current_package()
        item = next(i for i in package["items"] if i["code"] == "CH03-U013")
        ident = db.execute(
            "INSERT INTO knowledge_points(chapter_id,title,content,published) VALUES(?,?,?,0)",
            (target["id"], item["title"], ""),
        ).lastrowid
        content = content_for(package, item, target["id"], section_ids["4.3.5"])
        content.related_ids = [p["id"] for p in points if p["code"] in item["related"]]
        saved = save_revision(db, get(db, "knowledge_points", ident), content, user)
        # Match original multilevel visibility; never publish previously withdrawn content.
        multilevel = next(p for record, p in rows if record["code"] == "CH03-U011")
        if multilevel["published"]:
            change_publication_in(
                db,
                ident,
                "publish",
                Action(expected_version=saved["edit_version"]),
                user,
            )
        current = get(db, "knowledge_points", ident)
        points.append(
            dict(
                code=item["code"],
                id=ident,
                revision_id=current["draft_revision_id"],
                edit_version=current["edit_version"],
            )
        )
    retired = archive_old_example(db, source["id"], user)
    result.update(
        correction_original_sections=dict(result["sections"]),
        chapter_id=target["id"],
        sections=section_ids,
        points=points,
        chapter04_correction_v1=True,
        correction_source_chapter_id=source["id"],
        correction_backup=str(backup),
        archived_deadlock_example_ids=retired,
        already_corrected=False,
    )
    if result.get("direct_published"):
        result["published_count"] = sum(
            get(db, "knowledge_points", p["id"])["published"] for p in points
        )
    db.execute(
        "UPDATE chapter_content_imports SET chapter_id=?,result_json=? WHERE id=?",
        (target["id"], json.dumps(result, ensure_ascii=False), entry["id"]),
    )
    return result


def correct(body, user):
    from .main import DB_PATH
    from .persistence import backup_data

    with database() as db:
        target = visible_chapter(db, body.chapter_id, user)
        if not target_is_memory(target):
            raise HTTPException(422, "目标不是存储管理/内存管理")
        entry = entry_for(db, target["course_id"])
        result = json.loads(entry["result_json"])
        if result.get(MARK):
            if entry["chapter_id"] != body.chapter_id:
                raise HTTPException(409, "已修正到其他章")
            return {**result, "already_corrected": True}
    backup = backup_data(
        DB_PATH,
        DB_PATH.parent
        / "backups"
        / (
            "before-chapter04-correction-"
            + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")
        ),
    )
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        return correct_into(db, body, user, backup)


@router.post("/chapter03/correct-location")
def correct_location(body: ImportRequest, user=Depends(teacher)):
    return correct(body, user)


def auto_correct():
    """Only known misfiling or the already-correct memory chapter, within ledger's course."""
    if os.getenv("CHAPTER04_AUTO_CORRECT", "1") == "0":
        return
    with database() as db:
        entries = [
            dict(r)
            for r in db.execute(
                "SELECT * FROM chapter_content_imports WHERE package_id=?",
                (load_package()["package_id"],),
            )
        ]
    for entry in entries:
        try:
            if json.loads(entry["result_json"]).get(MARK):
                continue
            with database() as db:
                source = get(db, "chapters", entry["chapter_id"])
                name = canonical_name(source["title"])
                if not target_is_memory(source) and not (
                    ("同步" in name and "死锁" in name) or name == "死锁管理"
                ):
                    continue
                targets = [
                    dict(r)
                    for r in db.execute(
                        "SELECT * FROM chapters WHERE course_id=? AND archived_at IS NULL",
                        (entry["course_id"],),
                    )
                    if target_is_memory(dict(r))
                ]
                actor = db.execute(
                    "SELECT * FROM users WHERE id=? AND role='teacher' AND active=1",
                    (entry["actor_id"],),
                ).fetchone()
                if len(targets) != 1 or not actor:
                    LOG.warning(
                        "第四章未自动修正：目标不唯一或原导入教师不可用；可在教师端指定目标。"
                    )
                    continue
            correct(ImportRequest(chapter_id=targets[0]["id"]), dict(actor))
        except (HTTPException, ValueError, OSError) as exc:
            LOG.warning(
                "第四章修正未完成：%s；原数据保留。", getattr(exc, "detail", str(exc))
            )
