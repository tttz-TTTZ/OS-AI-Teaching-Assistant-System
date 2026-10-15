"""课程查询、知识点、练习与实验接口。"""

import json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from .algorithms import FCFSInput, fcfs

router = APIRouter(prefix="/api")


def db_context():
    from .main import database

    return database()


@router.get("/chapters")
def chapters():
    with db_context() as db:
        return [dict(r) for r in db.execute("SELECT * FROM chapters ORDER BY id")]


@router.get("/knowledge")
def knowledge(chapter_id: int | None = None):
    with db_context() as db:
        return [
            dict(r)
            for r in db.execute(
                "SELECT * FROM knowledge WHERE (? IS NULL OR chapter_id=?) ORDER BY id",
                (chapter_id, chapter_id),
            )
        ]


@router.get("/knowledge/{item_id}")
def knowledge_detail(item_id: int):
    with db_context() as db:
        row = db.execute("SELECT * FROM knowledge WHERE id=?", (item_id,)).fetchone()
        if not row:
            raise HTTPException(404, "知识点不存在")
        result = dict(row)
        result["materials"] = [
            dict(r)
            for r in db.execute(
                "SELECT id,title FROM materials WHERE chapter=(SELECT title FROM chapters WHERE id=?)",
                (row["chapter_id"],),
            )
        ]
        return result


@router.post("/labs/fcfs")
def run_fcfs(body: FCFSInput):
    return fcfs(body.processes)


@router.get("/questions")
def questions(chapter_id: int):
    with db_context() as db:
        return [
            {**dict(r), "options": json.loads(r["options"])}
            for r in db.execute(
                "SELECT id,chapter_id,prompt,options FROM questions WHERE chapter_id=? ORDER BY id",
                (chapter_id,),
            )
        ]


class Submission(BaseModel):
    answers: dict[int, int] = Field(min_length=1, max_length=100)


@router.post("/practice/submit")
def submit(body: Submission):
    results = []
    with db_context() as db:
        for qid, selected in body.answers.items():
            row = db.execute("SELECT * FROM questions WHERE id=?", (qid,)).fetchone()
            if not row or selected not in range(len(json.loads(row["options"]))):
                raise HTTPException(422, "题目或选项无效")
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
