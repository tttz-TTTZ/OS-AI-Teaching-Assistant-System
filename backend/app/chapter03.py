"""第三章显式预填和一键发布：不猜章ID，不覆盖教师修改。"""

import hashlib
import json
from pathlib import Path

from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .access import visible_chapter
from .auth import teacher
from .chapter_content import router
from .chapter_import import prior, resolve_sections
from .chapter04_content import application_package, target_is_memory
from .digital import Content, database, get, save_revision

PACKAGE = Path(__file__).resolve().parents[1] / "content" / "chapter03.json"


def load_package():
    return json.loads(PACKAGE.read_text(encoding="utf-8"))


def current_package():
    return application_package(load_package())


def content_for(package, item, chapter_id, section_id):
    by = {r["id"]: r for r in package["records"]}
    lines = [
        "依据第三章完整V1.1报告；6份教师PPTX共118物理页，未使用教材PDF。",
        "S=课件支持，T=教学解释/协议，V=待核实。未重新读取原PPT；未绑定实际资料。",
        "分析记录：" + "、".join(item["record_ids"]),
    ]
    for r in item["record_ids"]:
        record = by[r]
        lines.append(
            f"{r} 原目录{record['section']}：{record['evidence_status']}；待核实：{'、'.join(record['issue_ids'])}"
        )
    for ref in item["refs"]:
        lines.append(
            f"{ref['source_id']} {ref['filename']}，物理页{','.join(map(str,ref['physical_pages']))}；第{ref['quote_page']}页摘录：{ref['short_quote']}（{ref['evidence_type']}）"
        )
    return Content(
        chapter_id=chapter_id,
        section_id=section_id,
        code=item["code"],
        title=item["title"],
        summary=item["summary"],
        objectives=item["objectives"],
        sort_order=item["sort_order"],
        emphasis="原理与静态图示",
        source_title="6份教师PPTX（118物理页；V1.1报告）",
        source_note="\n".join(lines),
        blocks=item["blocks"],
        lab=False,
    )


class ImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    chapter_id: int = Field(gt=0)
    section_map: dict[str, int] = Field(default_factory=dict, max_length=20)


def fingerprint():
    return hashlib.sha256(PACKAGE.read_bytes()).hexdigest()


def status_for(db, package, chapter):
    old = prior(db, package, chapter)
    if not old:
        return None
    return {
        **json.loads(old["result_json"]),
        "already_imported": True,
        "package_changed": old["package_hash"] != fingerprint(),
    }


@router.get("/chapter03")
def package_view(user=Depends(teacher)):
    return current_package()


@router.get("/chapter03/status")
def status(chapter_id: int, user=Depends(teacher)):
    with database() as db:
        return {
            "result": status_for(
                db, current_package(), visible_chapter(db, chapter_id, user)
            )
        }


@router.post("/chapter03/plan")
def plan(body: ImportRequest, user=Depends(teacher)):
    package = current_package()
    with database() as db:
        chapter = visible_chapter(db, body.chapter_id, user)
        return dict(
            chapter=chapter,
            sections=resolve_sections(db, package, body),
            result=status_for(db, package, chapter),
            units=len(package["items"]),
            experiments=0,
            notice="检查不写入；可一键应用并发布，或仅保存草稿；不覆盖已有修改。",
        )


@router.post("/chapter03/import")
def import_package(body: ImportRequest, user=Depends(teacher)):
    # Existing database() context rolls back all writes on an exception.
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        return import_into(db, body, user)


def import_into(db, body, user):
    package = current_package()
    digest = fingerprint()
    chapter = visible_chapter(db, body.chapter_id, user)
    # Validate all models before the first write, including related targets.
    codes = {item["code"] for item in package["items"]}
    for item in package["items"]:
        content_for(package, item, body.chapter_id, None)
        if set(item["related"]) - codes:
            raise HTTPException(422, "内容包关联目标无效；未写入")
    old = prior(db, package, chapter)
    if old:
        if old["chapter_id"] != body.chapter_id or old["package_hash"] != digest:
            raise HTTPException(
                409, "本课程已导入此包，但目标章或版本不同；未覆盖已有内容"
            )
        result = json.loads(old["result_json"])
        if any(result["sections"].get(k) != v for k, v in body.section_map.items()):
            raise HTTPException(409, "已导入目录请在现有编辑页调整；未重复导入")
        return {**result, "already_imported": True}
    sections = resolve_sections(db, package, body)
    if any(s["conflict"] for s in sections):
        raise HTTPException(409, "现有目录编号冲突，请明确映射到已有小节；未写入")
    # Inspect revision history, including archived/renamed content. Never take it over.
    for row in db.execute(
        "SELECT r.body FROM knowledge_revisions r JOIN knowledge_points k ON k.id=r.point_id JOIN chapters c ON c.id=k.chapter_id WHERE c.course_id=?",
        (chapter["course_id"],),
    ):
        if json.loads(row["body"]).get("code", "").startswith("CH03-"):
            raise HTTPException(
                409, "本课程已有CH03历史内容，请先核对；不自动复制或覆盖"
            )
    section_ids = {}
    for s in sections:
        section_ids[s["code"]] = (
            s["id"]
            or db.execute(
                "INSERT INTO sections(chapter_id,code,title,sort_order,published) VALUES(?,?,?,?,0)",
                (body.chapter_id, s["code"], s["title"], len(section_ids) * 10),
            ).lastrowid
        )
    ids = {
        item["code"]: db.execute(
            "INSERT INTO knowledge_points(chapter_id,title,content,published) VALUES(?,?,?,0)",
            (body.chapter_id, item["title"], ""),
        ).lastrowid
        for item in package["items"]
    }
    points = []
    for item in package["items"]:
        content = content_for(
            package, item, body.chapter_id, section_ids[item["section"]]
        )
        content.related_ids = [ids[c] for c in item["related"]]
        saved = save_revision(
            db, get(db, "knowledge_points", ids[item["code"]]), content, user
        )
        points.append(
            dict(
                code=item["code"],
                id=saved["id"],
                revision_id=saved["revision_id"],
                edit_version=saved["edit_version"],
            )
        )
    result = dict(
        package_id=package["package_id"],
        chapter_id=body.chapter_id,
        sections=section_ids,
        points=points,
        experiments=[],
        already_imported=False,
    )
    if len(package["items"]) == 13 and target_is_memory(chapter):
        db.execute(
            "UPDATE chapters SET textbook_number=4 WHERE id=?", (body.chapter_id,)
        )
        result["chapter04_correction_v1"] = True
    db.execute(
        "INSERT INTO chapter_content_imports(course_id,chapter_id,package_id,package_hash,actor_id,result_json) VALUES(?,?,?,?,?,?)",
        (
            chapter["course_id"],
            body.chapter_id,
            package["package_id"],
            digest,
            user["id"],
            json.dumps(result, ensure_ascii=False),
        ),
    )
    return result


def published_result(db, package, body, user):
    chapter = visible_chapter(db, body.chapter_id, user)
    old = prior(db, package, chapter)
    if not old:
        return None
    if old["chapter_id"] != body.chapter_id or old["package_hash"] != fingerprint():
        raise HTTPException(409, "本课程已导入此包，但目标章或版本不同；未覆盖已有内容")
    result = json.loads(old["result_json"])
    if any(result["sections"].get(k) != v for k, v in body.section_map.items()):
        raise HTTPException(409, "已导入目录请在现有编辑页调整；未重复发布")
    return result if result.get("direct_published") else None


@router.post("/chapter03/publish")
def direct_publish(body: ImportRequest, user=Depends(teacher)):
    """按用户授权一次性发布本包当前内容；重复调用不恢复撤回项。"""
    from datetime import datetime, timezone
    from .main import DB_PATH
    from .persistence import backup_data
    from .digital import Action, body_of, change_publication_in

    package = current_package()
    with database() as db:
        chapter = visible_chapter(db, body.chapter_id, user)
        done = published_result(db, package, body, user)
        if done:
            return {**done, "already_published": True}
        if not chapter["course_published"]:
            raise HTTPException(
                409, "所属课程未发布；请先发布课程，未扩大整门课程公开范围"
            )
    backup = backup_data(
        DB_PATH,
        DB_PATH.parent
        / "backups"
        / (
            "before-chapter03-publish-"
            + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")
        ),
    )
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        done = published_result(db, package, body, user)
        if done:
            return {**done, "already_published": True}
        chapter = visible_chapter(db, body.chapter_id, user)
        if not chapter["course_published"]:
            raise HTTPException(409, "课程已撤回；未发布第三章")
        result = import_into(db, body, user)
        db.execute("UPDATE chapters SET published=1 WHERE id=?", (body.chapter_id,))
        for record in result["points"]:
            point = get(db, "knowledge_points", record["id"])
            content = Content(**body_of(db, point))
            if (
                point["archived_at"]
                or point["chapter_id"] != body.chapter_id
                or content.chapter_id != body.chapter_id
            ):
                raise HTTPException(409, "包内知识点已归档或跨章移动；未覆盖或恢复")
            if content.section_id:
                section = get(db, "sections", content.section_id)
                if section["chapter_id"] != body.chapter_id:
                    raise HTTPException(409, "小节归属已变化；未跨章发布")
                db.execute(
                    "UPDATE sections SET published=1 WHERE id=?", (content.section_id,)
                )
            if (
                not point["published"]
                or point["published_revision_id"] != point["draft_revision_id"]
            ):
                change_publication_in(
                    db,
                    point["id"],
                    "publish",
                    Action(expected_version=point["edit_version"]),
                    user,
                )
            record["edit_version"] = get(db, "knowledge_points", point["id"])[
                "edit_version"
            ]
        result.update(
            direct_published=True,
            already_published=False,
            published_count=len(result["points"]),
            backup=str(backup),
        )
        db.execute(
            "UPDATE chapter_content_imports SET result_json=? WHERE course_id=? AND package_id=?",
            (
                json.dumps(result, ensure_ascii=False),
                chapter["course_id"],
                package["package_id"],
            ),
        )
        return result
