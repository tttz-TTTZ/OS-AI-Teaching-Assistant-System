"""已填写的PPT-only审核包。无模型调用，默认只导入草稿，永不覆盖现有内容。"""

import hashlib
import json
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from .auth import teacher
from .digital import Content, Block, database, get, save_revision
from .access import visible_chapter

router = APIRouter(prefix="/api/teacher/chapter-content")
PACKAGE = Path(__file__).resolve().parents[1] / "content" / "chapter01.json"


def load_package():
    return json.loads(PACKAGE.read_text(encoding="utf-8"))


def source_note(package, item):
    sources = {s["id"]: s for s in package["sources"]}
    lines = [
        package["notice"],
        "原目录归属：" + item.get("original_section", item["section"]),
        "",
        "## PPT来源（物理幻灯片，从1开始）",
    ]
    for ref in item["refs"]:
        s = sources[ref["source_id"]]
        lines.append(
            f"- {s['id']}：{s['filename']}，第{ref['pages']}张；来源依据为报告，原PPT及视觉图示尚未核验。"
        )
    lines.extend(
        [
            "",
            "S：报告转述的课件概念；T：本次展开讲解、图形重绘与新例子；V：图形/代码待核验。不得将重绘称为原图复刻。",
            "",
            "## 保留的待核实事项",
        ]
    )
    lines.extend(f"- {i['code']}：{i['text']}" for i in package["issues"])
    return "\n".join(lines)


def content_for(package, item, chapter_id, section_id):
    return Content(
        chapter_id=chapter_id,
        section_id=section_id,
        code=item["code"],
        title=item["title"],
        summary=item["summary"],
        objectives=item["objectives"],
        emphasis=(
            "普通摘要"
            if item["code"].startswith("CH01-A")
            else "辅助关系图" if item["code"] == "CH01-K014" else "重点难点"
        ),
        source_title="四份教师PPT（依据报告，非教材PDF）",
        source_note=source_note(package, item),
        blocks=[Block(**b) for b in item["blocks"]],
        lab=item["lab"],
        sort_order=int(item["code"][-3:]) * 10,
    )


class ImportRequest(BaseModel):
    chapter_id: int = Field(gt=0)


@router.get("/chapter01")
def package_view(user=Depends(teacher)):
    return load_package()


@router.post("/chapter01/import")
def import_package(body: ImportRequest, user=Depends(teacher)):
    package = load_package()
    fingerprint = hashlib.sha256(PACKAGE.read_bytes()).hexdigest()
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        chapter = visible_chapter(db, body.chapter_id, user)
        previous = db.execute(
            "SELECT * FROM chapter_content_imports WHERE course_id=? AND package_id=?",
            (chapter["course_id"], package["package_id"]),
        ).fetchone()
        if previous:
            if (
                previous["chapter_id"] != body.chapter_id
                or previous["package_hash"] != fingerprint
            ):
                raise HTTPException(
                    409, "此课程已导入该包；目标或包版本不同，需先核对，未覆盖任何内容"
                )
            return {**json.loads(previous["result_json"]), "already_imported": True}
        # 不合并同名或相似编号目录，避免将课程原目录错当报告目录。
        section_ids = {}
        for s in package["sections"]:
            matches = db.execute(
                "SELECT * FROM sections WHERE chapter_id=? AND code=?",
                (body.chapter_id, s["code"]),
            ).fetchall()
            if len(matches) > 1 or (matches and matches[0]["title"] != s["title"]):
                raise HTTPException(
                    409,
                    f"小节{s['code']}已存在不同标题或重复编号，请先核对目录；本次未导入",
                )
            section_ids[s["code"]] = (
                matches[0]["id"]
                if matches
                else db.execute(
                    "INSERT INTO sections(chapter_id,code,title,sort_order,published) VALUES (?,?,?,?,0)",
                    (body.chapter_id, s["code"], s["title"], len(section_ids) * 10),
                ).lastrowid
            )
        # 稳定编号冲突只报错，不接管教师手工内容。
        for row in db.execute(
            "SELECT r.body FROM knowledge_points k JOIN chapters c ON c.id=k.chapter_id JOIN knowledge_revisions r ON r.id=k.draft_revision_id WHERE c.course_id=?",
            (chapter["course_id"],),
        ):
            if json.loads(row["body"]).get("code", "").startswith("CH01-"):
                raise HTTPException(
                    409, "课程中已有CH01编号内容，未覆盖；请先核对已有草稿"
                )
        items = [item for item in package["items"] if item["importable"]]
        ids = {}
        for item in items:
            ids[item["code"]] = db.execute(
                "INSERT INTO knowledge_points(chapter_id,title,content,published) VALUES (?,?,?,0)",
                (body.chapter_id, item["title"], ""),
            ).lastrowid
        points = []
        for item in items:
            content = content_for(
                package, item, body.chapter_id, section_ids[item["section"]]
            )
            content.related_ids = [ids[c] for c in item["related"] if c in ids]
            ident = ids[item["code"]]
            saved = save_revision(db, get(db, "knowledge_points", ident), content, user)
            points.append(
                dict(
                    code=item["code"],
                    id=ident,
                    revision_id=saved["revision_id"],
                    edit_version=saved["edit_version"],
                )
            )
        # 实验内容和计算沿用现有实现，不复制引擎；仍需在原实验页面试运行、审核与发布。
        from .experiments import ExperimentInput, save

        experiment = ExperimentInput(
            title="第一章：时间片轮转与分时服务（PPT审核草稿）",
            algorithm="rr",
            chapter_id=body.chapter_id,
            knowledge_ids=[ids["CH01-K009"]],
            objectives="解释时间片、就绪队列与完成离队；比较不同q的调度顺序。",
            instructions="先预测，再运行。单CPU、无I/O、无切换开销；边界新到达者先入队，再将未完成进程放回队尾。",
            tasks="核对P1/P2完成、周转和等待；改变q解释差异。另测边界到达、CPU空闲和恰好完成。",
            reference="SRC-02第27–29张：分时与轮转思想（报告转述，原PPT待核验）。具体数值为T：q=2，P1(a0,b5)、P2(a0,b3)，平均周转7.5、平均等待3.5。",
            defaults={
                "processes": [
                    {"pid": "P1", "arrival": 0, "burst": 5},
                    {"pid": "P2", "arrival": 0, "burst": 3},
                ],
                "quantum": 2,
            },
        )
        eid = db.execute(
            "INSERT INTO experiments(title) VALUES (?)", (experiment.title,)
        ).lastrowid
        save(db, eid, experiment, user)
        result = dict(
            chapter_id=body.chapter_id,
            points=points,
            experiment_id=eid,
            sections=list(section_ids.values()),
            deferred=["CH01-K012"],
            already_imported=False,
        )
        db.execute(
            "INSERT INTO chapter_content_imports(course_id,chapter_id,package_id,package_hash,actor_id,result_json) VALUES (?,?,?,?,?,?)",
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
