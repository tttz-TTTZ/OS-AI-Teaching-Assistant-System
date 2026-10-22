"""第二章预填包：显式目标、事务性草稿导入、重复导入不覆盖教师修改。"""

import hashlib
import json
from pathlib import Path

from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .access import visible_chapter
from .auth import teacher
from .chapter_content import router
from .digital import Block, Content, database, get, save_revision
from .experiments import ExperimentInput, save as save_experiment

PACKAGE = Path(__file__).resolve().parents[1] / "content" / "chapter02.json"


def load_package():
    return json.loads(PACKAGE.read_text(encoding="utf-8"))


def content_for(package, item, chapter_id, section_id):
    source = {s["id"]: s for s in package["sources"]}
    records = {c["id"]: c for c in package["records"]}
    lines = [
        "分析记录：" + "、".join(item["record_ids"]),
        "S=课件摘录；T=教学重述/示例/图示；V=待核实；P=现有引擎。目录2.5/2.6版本待确认。",
        "来源物理页从1开始，含隐藏页；未绑定实际文件，不能冒充附件已可读。",
    ]
    for ref in item["refs"]:
        lines.append(
            f"- {source[ref['source_id']]['filename']}；物理{ref['pages']}页；{ref['quote']}"
        )
    for code in item["record_ids"]:
        lines.append(
            code
            + " 原目录 "
            + records[code]["section"]
            + "："
            + records[code]["status"]
        )
    lines.append(
        "全包待核实："
        + "、".join(i["code"] for i in package["issues"])
        + "；教师预填页保留完整清单。"
    )
    return Content(
        chapter_id=chapter_id,
        section_id=section_id,
        code=item["code"],
        title=item["title"],
        summary=item["summary"],
        objectives=item["objectives"],
        emphasis="可选进阶·静态推演" if item["code"] == "CH02-U012" else "概念与机制",
        source_title="11份教师PPT/PPTX（169物理页；V1.1报告）",
        source_note="\n".join(lines),
        blocks=[Block(**b) for b in item["blocks"]],
        lab=item["lab"],
        sort_order=item["sort_order"],
    )


class ImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    chapter_id: int = Field(gt=0)
    section_map: dict[str, int] = Field(default_factory=dict, max_length=5)


def prior(db, package, chapter):
    row = db.execute(
        "SELECT * FROM chapter_content_imports WHERE course_id=? AND package_id=?",
        (chapter["course_id"], package["package_id"]),
    ).fetchone()
    return dict(row) if row else None


def status_for(db, package, chapter):
    old = prior(db, package, chapter)
    if not old:
        return None
    return {
        **json.loads(old["result_json"]),
        "already_imported": True,
        "package_changed": old["package_hash"]
        != hashlib.sha256(PACKAGE.read_bytes()).hexdigest(),
    }


def resolve_sections(db, package, body):
    codes = {s["code"] for s in package["sections"]}
    if set(body.section_map) - codes:
        raise HTTPException(422, "存在不属于本包的小节映射")
    result = []
    for section in package["sections"]:
        ident = body.section_map.get(section["code"])
        if ident is not None:
            row = get(db, "sections", ident)
            if row["chapter_id"] != body.chapter_id:
                raise HTTPException(422, "映射的小节必须属于所选目标章节")
            result.append(
                {
                    **section,
                    "id": ident,
                    "existing_title": row["title"],
                    "conflict": False,
                }
            )
            continue
        matches = db.execute(
            "SELECT * FROM sections WHERE chapter_id=? AND code=?",
            (body.chapter_id, section["code"]),
        ).fetchall()
        exact = len(matches) == 1 and matches[0]["title"] == section["title"]
        result.append(
            {
                **section,
                "id": matches[0]["id"] if exact else None,
                "conflict": bool(matches) and not exact,
                "existing_title": matches[0]["title"] if exact else "",
            }
        )
    return result


@router.get("/chapter02")
def package_view(user=Depends(teacher)):
    return load_package()


@router.get("/chapter02/status")
def status(chapter_id: int, user=Depends(teacher)):
    with database() as db:
        chapter = visible_chapter(db, chapter_id, user)
        return {"result": status_for(db, load_package(), chapter)}


@router.post("/chapter02/plan")
def plan(body: ImportRequest, user=Depends(teacher)):
    package = load_package()
    with database() as db:
        chapter = visible_chapter(db, body.chapter_id, user)
        return dict(
            chapter=dict(chapter),
            sections=resolve_sections(db, package, body),
            result=status_for(db, package, chapter),
            units=len(package["items"]),
            experiments=len(package["experiments"]),
            notice="仅新增草稿；不改章名、不发布目录、不覆盖已有内容。",
        )


@router.post("/chapter02/import")
def import_package(body: ImportRequest, user=Depends(teacher)):
    package = load_package()
    fingerprint = hashlib.sha256(PACKAGE.read_bytes()).hexdigest()
    # 包中的每条结构在写入前校验，避免正文不合schema而部分写入。
    for item in package["items"]:
        content_for(package, item, body.chapter_id, None)
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        chapter = visible_chapter(db, body.chapter_id, user)
        old = prior(db, package, chapter)
        if old:
            if (
                old["chapter_id"] != body.chapter_id
                or old["package_hash"] != fingerprint
            ):
                raise HTTPException(
                    409, "同课程已导入该内容包，但目标章或包版本不同；未覆盖已有内容"
                )
            result = json.loads(old["result_json"])
            if any(result["sections"].get(k) != v for k, v in body.section_map.items()):
                raise HTTPException(
                    409, "已导入内容的小节归属请在现有编辑页调整；未重复导入"
                )
            return {**result, "already_imported": True}
        sections = resolve_sections(db, package, body)
        if any(s["conflict"] for s in sections):
            raise HTTPException(
                409,
                "现有小节编号/标题有冲突，请在预览中明确映射到已有小节；未写入任何内容",
            )
        # 不接管任何已有CH02记录，包括已归档或曾发表、当前代码已改的旧修订。
        for row in db.execute(
            "SELECT r.body FROM knowledge_revisions r JOIN knowledge_points k ON k.id=r.point_id JOIN chapters c ON c.id=k.chapter_id WHERE c.course_id=?",
            (chapter["course_id"],),
        ):
            if json.loads(row["body"]).get("code", "").startswith("CH02-"):
                raise HTTPException(
                    409, "课程已有CH02内容记录，请先核对，不自动覆盖或复制"
                )
        section_ids = {}
        for section in sections:
            section_ids[section["code"]] = (
                section["id"]
                or db.execute(
                    "INSERT INTO sections(chapter_id,code,title,sort_order,published) VALUES(?,?,?,?,0)",
                    (
                        body.chapter_id,
                        section["code"],
                        section["title"],
                        len(section_ids) * 10,
                    ),
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
            content.related_ids = [ids[k] for k in item["related"]]
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
        experiments = []
        for data in package["experiments"]:
            payload = {
                k: v for k, v in data.items() if k not in ("code", "knowledge_codes")
            }
            model = ExperimentInput(
                **payload,
                chapter_id=body.chapter_id,
                knowledge_ids=[ids[k] for k in data["knowledge_codes"]],
            )
            eid = db.execute(
                "INSERT INTO experiments(title) VALUES(?)", (model.title,)
            ).lastrowid
            saved = save_experiment(db, eid, model, user)
            experiments.append(
                dict(
                    code=data["code"],
                    id=eid,
                    algorithm=model.algorithm,
                    edit_version=saved["edit_version"],
                )
            )
        result = dict(
            chapter_id=body.chapter_id,
            points=points,
            experiments=experiments,
            sections=section_ids,
            package_id=package["package_id"],
            already_imported=False,
        )
        db.execute(
            "INSERT INTO chapter_content_imports(course_id,chapter_id,package_id,package_hash,actor_id,result_json) VALUES(?,?,?,?,?,?)",
            (
                chapter["course_id"],
                body.chapter_id,
                package["package_id"],
                fingerprint,
                user["id"],
                json.dumps(result, ensure_ascii=False),
            ),
        )
        return result
