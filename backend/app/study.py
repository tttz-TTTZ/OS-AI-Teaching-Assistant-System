"""统一练习：多题型、知识点关联、本人作答快照与幂等提交。"""

import json
from typing import Any, Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from .auth import require_user, teacher
from .access import visible_chapter
from .digital import database, get, view_point

router = APIRouter(prefix="/api")


class Question(BaseModel):
    chapter_id: int
    prompt: str = Field(min_length=1, max_length=2000)
    kind: Literal["single", "multiple", "boolean", "short", "matching"] = "single"
    options: list[str] = Field(default_factory=list, max_length=8)
    items: list[str] = Field(default_factory=list, max_length=10)
    correct: Any = 0
    explanation: str = Field(default="", max_length=5000)
    published: bool = False
    knowledge_ids: list[int] = Field(default_factory=list, max_length=50)
    expected_version: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def valid(self):
        if not self.prompt.strip():
            raise ValueError("题干不能为空")
        if self.kind == "boolean":
            self.options = ["正确", "错误"]
        if self.kind == "short":
            if (
                not isinstance(self.correct, str)
                or not self.correct.strip()
                or len(self.correct) > 5000
            ):
                raise ValueError("简答题需要参考答案，最多5000字")
        else:
            if len(self.options) < 2 or any(
                not o.strip() or len(o) > 1000 for o in self.options
            ):
                raise ValueError("需要2–8个有效选项")
            if self.kind in ("single", "boolean"):
                if type(self.correct) != int or not 0 <= self.correct < len(
                    self.options
                ):
                    raise ValueError("正确选项无效")
            else:
                if (
                    not isinstance(self.correct, list)
                    or not self.correct
                    or any(
                        type(i) != int or not 0 <= i < len(self.options)
                        for i in self.correct
                    )
                ):
                    raise ValueError("答案应为有效选项数组")
                if self.kind == "multiple" and len(set(self.correct)) != len(
                    self.correct
                ):
                    raise ValueError("多选答案不能重复")
                if self.kind == "matching" and (
                    not self.items
                    or len(self.items) != len(self.correct)
                    or any(not i.strip() or len(i) > 500 for i in self.items)
                ):
                    raise ValueError("匹配题需逐项填写题项和正确分类")
        return self


def unpack(db, row, private=False):
    data = dict(row)
    result = {
        k: data[k]
        for k in ["id", "chapter_id", "prompt", "kind", "version", "published"]
    }
    result.update(options=json.loads(data["options"]), items=json.loads(data["items"]))
    result["knowledge_ids"] = [
        r[0]
        for r in db.execute(
            "SELECT point_id FROM question_knowledge WHERE question_id=?", (data["id"],)
        )
    ]
    if private:
        result.update(
            correct=(
                json.loads(data["answer_data"])
                if data["answer_data"] is not None
                else data["answer"]
            ),
            explanation=data["explanation"],
        )
    return result


@router.get("/teacher/study/questions")
def teacher_questions(user=Depends(teacher)):
    with database() as db:
        return [
            unpack(db, r, True)
            for r in db.execute("SELECT * FROM questions ORDER BY chapter_id,id")
        ]


def write_question(db, body, user, ident=None):
    chapter = visible_chapter(db, body.chapter_id, user)
    for pid in set(body.knowledge_ids):
        p = get(db, "knowledge_points", pid)
        if p["chapter_id"] != body.chapter_id:
            raise HTTPException(
                422, "题目与知识点必须在同一章；移动知识点后请重新核对题目归属"
            )
    answer = body.correct if type(body.correct) == int else 0
    values = (
        body.chapter_id,
        body.prompt,
        json.dumps(body.options, ensure_ascii=False),
        answer,
        body.explanation,
        body.published,
        body.kind,
        json.dumps(body.correct, ensure_ascii=False),
        json.dumps(body.items, ensure_ascii=False),
    )
    if ident:
        old = get(db, "questions", ident)
        if get(db, "chapters", old["chapter_id"])["course_id"] != chapter["course_id"]:
            raise HTTPException(422, "不支持跨课程移动题目")
        cur = db.execute(
            "UPDATE questions SET chapter_id=?,prompt=?,options=?,answer=?,explanation=?,published=?,kind=?,answer_data=?,items=?,version=version+1 WHERE id=? AND version=?",
            (*values, ident, body.expected_version),
        )
        if not cur.rowcount:
            raise HTTPException(409, "题目已被其他教师修改，请重新加载")
        db.execute("DELETE FROM question_knowledge WHERE question_id=?", (ident,))
    else:
        ident = db.execute(
            "INSERT INTO questions(chapter_id,prompt,options,answer,explanation,published,kind,answer_data,items) VALUES (?,?,?,?,?,?,?,?,?)",
            values,
        ).lastrowid
    for pid in set(body.knowledge_ids):
        db.execute("INSERT INTO question_knowledge VALUES (?,?)", (ident, pid))
    return unpack(db, get(db, "questions", ident), True)


@router.post("/teacher/study/questions", status_code=201)
def create_question(body: Question, user=Depends(teacher)):
    with database() as db:
        return write_question(db, body, user)


@router.put("/teacher/study/questions/{ident}")
def edit_question(ident: int, body: Question, user=Depends(teacher)):
    with database() as db:
        return write_question(db, body, user, ident)


@router.get("/study/questions")
def questions(
    chapter_id: int | None = None,
    knowledge_id: int | None = None,
    user=Depends(require_user),
):
    with database() as db:
        if knowledge_id:
            point = view_point(db, get(db, "knowledge_points", knowledge_id), user)
            chapter_id = point["chapter_id"]
        if chapter_id:
            visible_chapter(db, chapter_id, user)
        rows = db.execute(
            "SELECT q.* FROM questions q WHERE (? IS NULL OR q.chapter_id=?) AND (? IS NULL OR EXISTS(SELECT 1 FROM question_knowledge k WHERE k.question_id=q.id AND k.point_id=?)) ORDER BY id LIMIT 100",
            (chapter_id, chapter_id, knowledge_id, knowledge_id),
        ).fetchall()
        result = []
        for row in rows:
            try:
                visible_chapter(db, row["chapter_id"], user)
                if user["role"] == "teacher" or row["published"]:
                    result.append(unpack(db, row))
            except HTTPException:
                pass
        return result


class Submission(BaseModel):
    request_key: str = Field(pattern=r"^[a-zA-Z0-9_-]{16,80}$")
    knowledge_id: int | None = None
    revision_id: int = Field(default=0, ge=0)
    answers: dict[int, Any] = Field(min_length=1, max_length=100)
    versions: dict[int, int] = Field(default_factory=dict, max_length=100)


@router.post("/study/submit")
def submit(body: Submission, user=Depends(require_user)):
    with database() as db:
        # 读写一致且同一请求幂等；重复按钮不产生重复成绩。
        db.execute("BEGIN IMMEDIATE")
        duplicate = db.execute(
            "SELECT id,payload FROM study_attempts WHERE user_id=? AND request_key=?",
            (user["id"], body.request_key),
        ).fetchone()
        if duplicate:
            return {
                **json.loads(duplicate["payload"])["result"],
                "attempt_id": duplicate["id"],
            }
        if body.knowledge_id:
            point = view_point(db, get(db, "knowledge_points", body.knowledge_id), user)
            if point["revision_id"] != body.revision_id:
                raise HTTPException(409, "教材已更新，请刷新题组")
            required = {
                r[0]
                for r in db.execute(
                    "SELECT q.id FROM questions q JOIN question_knowledge k ON k.question_id=q.id WHERE k.point_id=? AND q.published=1 ORDER BY q.id LIMIT 100",
                    (body.knowledge_id,),
                )
            }
            if set(body.answers) != required:
                raise HTTPException(422, "请完成当前知识点的完整题组")
        results = []
        snapshots = []
        for ident, answer in body.answers.items():
            row = get(db, "questions", ident)
            visible_chapter(db, row["chapter_id"], user)
            if user["role"] != "teacher" and not row["published"]:
                raise HTTPException(404, "题目已撤回")
            if (
                body.knowledge_id
                and not db.execute(
                    "SELECT 1 FROM question_knowledge WHERE question_id=? AND point_id=?",
                    (ident, body.knowledge_id),
                ).fetchone()
            ):
                raise HTTPException(422, "题目不属于本知识点")
            q = unpack(db, row, True)
            if body.versions.get(ident) != q["version"]:
                raise HTTPException(409, "题目已更新，请刷新；本次未生成成绩")
            kind = q["kind"]
            correct = None
            if kind == "short":
                if (
                    not isinstance(answer, str)
                    or not answer.strip()
                    or len(answer) > 5000
                ):
                    raise HTTPException(422, "简答题需要1–5000字作答")
            elif kind in ("multiple", "matching"):
                if (
                    not isinstance(answer, list)
                    or not answer
                    or any(
                        type(i) != int or not 0 <= i < len(q["options"]) for i in answer
                    )
                ):
                    raise HTTPException(422, "选项无效")
                if kind == "matching" and len(answer) != len(q["items"]):
                    raise HTTPException(422, "请完成全部匹配")
                if kind == "multiple" and len(set(answer)) != len(answer):
                    raise HTTPException(422, "重复选项")
                correct = (
                    (set(answer) == set(q["correct"]))
                    if kind == "multiple"
                    else answer == q["correct"]
                )
            else:
                if type(answer) != int or not 0 <= answer < len(q["options"]):
                    raise HTTPException(422, "请选择有效选项")
                correct = answer == q["correct"]
            results.append(
                {
                    "id": ident,
                    "selected": answer,
                    "correct": correct,
                    "answer": q["correct"],
                    "explanation": q["explanation"],
                    "kind": kind,
                    "prompt": q["prompt"],
                    "options": q["options"],
                    "items": q["items"],
                }
            )
            snapshots.append(q)
        result = {
            "results": results,
            "score": sum(r["correct"] is True for r in results),
            "total": sum(r["correct"] is not None for r in results),
            "ungraded": sum(r["correct"] is None for r in results),
        }
        ident = db.execute(
            "INSERT INTO study_attempts(user_id,point_id,revision_id,request_key,payload) VALUES (?,?,?,?,?)",
            (
                user["id"],
                body.knowledge_id,
                body.revision_id,
                body.request_key,
                json.dumps(
                    {"questions": snapshots, "result": result}, ensure_ascii=False
                ),
            ),
        ).lastrowid
        return {**result, "attempt_id": ident}


@router.get("/study/attempts")
def attempts(user=Depends(require_user)):
    with database() as db:
        return [
            {
                "id": r["id"],
                "point_id": r["point_id"],
                "revision_id": r["revision_id"],
                "created_at": r["created_at"],
                **json.loads(r["payload"])["result"],
            }
            for r in db.execute(
                "SELECT * FROM study_attempts WHERE user_id=? ORDER BY id DESC LIMIT 50",
                (user["id"],),
            )
        ]


class Feedback(BaseModel):
    message: str = Field(min_length=1, max_length=2000)


@router.post("/learning-content/{ident}/feedback", status_code=201)
def feedback(ident: int, body: Feedback, user=Depends(require_user)):
    if not body.message.strip():
        raise HTTPException(422, "反馈不能为空")
    with database() as db:
        point = view_point(db, get(db, "knowledge_points", ident), user)
        db.execute(
            "INSERT INTO learning_feedback(user_id,point_id,revision_id,message) VALUES (?,?,?,?)",
            (user["id"], ident, point["revision_id"], body.message.strip()),
        )
        return {"ok": True}


@router.get("/teacher/study/summary")
def summary(user=Depends(teacher)):
    with database() as db:
        # 仅统计当前发布修订，避免将同一学生旧版本重复计入掌握人数。
        progress = db.execute(
            "SELECT p.point_id,k.title,count(DISTINCT p.user_id) AS learners,sum(p.read_done) AS read_count,sum(p.self_assessed) AS self_assessed_count FROM knowledge_progress p JOIN knowledge_points k ON k.id=p.point_id JOIN users u ON u.id=p.user_id WHERE p.revision_id=coalesce(k.published_revision_id,0) AND u.role='student' GROUP BY p.point_id"
        ).fetchall()
        feedback = db.execute(
            "SELECT f.id,f.point_id,f.message,f.created_at,u.username,k.title FROM learning_feedback f JOIN users u ON u.id=f.user_id JOIN knowledge_points k ON k.id=f.point_id ORDER BY f.id DESC LIMIT 100"
        ).fetchall()
        return {
            "progress": [dict(r) for r in progress],
            "attempts": db.execute(
                "SELECT count(*) FROM study_attempts a JOIN users u ON u.id=a.user_id WHERE u.role='student'"
            ).fetchone()[0],
            "feedback": [dict(r) for r in feedback],
        }
