"""课程查询、知识点、练习与实验接口。"""

import json
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from .algorithms import FCFSInput, fcfs

from .auth import require_user
from .access import visible_chapter, document_visible

router = APIRouter(prefix="/api")


def db_context():
    from .main import database

    return database()


@router.get("/chapters")
def chapters(user: dict = Depends(require_user)):
    with db_context() as db:
        return [
            dict(r)
            for r in db.execute(
                "SELECT ch.* FROM chapters ch JOIN courses c ON c.id=ch.course_id WHERE (? OR (ch.published=1 AND c.published=1)) ORDER BY ch.sort_order,ch.id",
                (user["role"] == "teacher",),
            )
        ]


@router.get("/knowledge")
def knowledge(chapter_id: int | None = None, user: dict = Depends(require_user)):
    with db_context() as db:
        return [
            dict(r)
            for r in db.execute(
                "SELECT k.* FROM knowledge_points k JOIN chapters ch ON ch.id=k.chapter_id JOIN courses c ON c.id=ch.course_id WHERE (? IS NULL OR k.chapter_id=?) AND (? OR (k.published=1 AND ch.published=1 AND c.published=1)) ORDER BY ch.sort_order,k.id",
                (chapter_id, chapter_id, user["role"] == "teacher"),
            )
        ]


@router.get("/knowledge/{item_id}")
def knowledge_detail(item_id: int, user: dict = Depends(require_user)):
    with db_context() as db:
        row = db.execute(
            "SELECT * FROM knowledge_points WHERE id=?", (item_id,)
        ).fetchone()
        if not row:
            raise HTTPException(404, "知识点不存在")
        visible_chapter(db, row["chapter_id"], user)
        if user["role"] != "teacher" and not row["published"]:
            raise HTTPException(404, "知识点不存在或未发布")
        result = dict(row)
        docs = [
            dict(r)
            for r in db.execute(
                "SELECT d.* FROM documents d JOIN document_knowledge_points dk ON dk.document_id=d.id WHERE dk.knowledge_point_id=?",
                (item_id,),
            )
        ]
        result["materials"] = [d for d in docs if document_visible(db, d, user)]
        return result


@router.post("/labs/fcfs")
def run_fcfs(body: FCFSInput):
    return fcfs(body.processes)


@router.get("/questions")
def questions(chapter_id: int, user: dict = Depends(require_user)):
    with db_context() as db:
        visible_chapter(db, chapter_id, user)
        return [
            {**dict(r), "options": json.loads(r["options"])}
            for r in db.execute(
                "SELECT id,chapter_id,prompt,options FROM questions WHERE chapter_id=? AND (? OR published=1) ORDER BY id",
                (chapter_id, user["role"] == "teacher"),
            )
        ]


class Submission(BaseModel):
    answers: dict[int, int] = Field(min_length=1, max_length=100)


@router.post("/practice/submit")
def submit(body: Submission, user: dict = Depends(require_user)):
    results = []
    with db_context() as db:
        for qid, selected in body.answers.items():
            row = db.execute("SELECT * FROM questions WHERE id=?", (qid,)).fetchone()
            if not row or selected not in range(len(json.loads(row["options"]))):
                raise HTTPException(422, "题目或选项无效")
            visible_chapter(db, row["chapter_id"], user)
            if user["role"] != "teacher" and not row["published"]:
                raise HTTPException(404, "题目未发布")
            results.append(
                {
                    "id": qid,
                    "selected": selected,
                    "correct": selected == row["answer"],
                    "answer": row["answer"],
                    "explanation": row["explanation"],
                }
            )
    return {
        "results": results,
        "score": sum(r["correct"] for r in results),
        "total": len(results),
    }


@router.get("/courses")
def courses(user: dict = Depends(require_user)):
    with db_context() as db:
        return [
            dict(r)
            for r in db.execute(
                "SELECT * FROM courses WHERE (? OR published=1) ORDER BY id",
                (user["role"] == "teacher",),
            )
        ]
