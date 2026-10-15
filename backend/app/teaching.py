"""教师管理接口；路由级角色权限不依赖前端菜单。"""

import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from .auth import teacher, require_user
from .access import visible_chapter, list_documents

router = APIRouter(prefix="/api/teacher", dependencies=[Depends(teacher)])


def database():
    from .main import database as context

    return context()


def exists(db, table: str, item_id: int):
    # table 只能来自下方固定调用点，不能来自请求参数。
    row = db.execute(f"SELECT * FROM {table} WHERE id=?", (item_id,)).fetchone()
    if not row:
        raise HTTPException(404, "内容不存在")
    return dict(row)


class ChapterInput(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=5000)
    course_id: int = 1
    sort_order: int = Field(default=0, ge=0, le=100000)
    published: bool = False

    @field_validator("title")
    @classmethod
    def title_not_blank(cls, value):
        if not value.strip():
            raise ValueError("标题不能为空")
        return value.strip()


@router.get("/chapters")
def chapters():
    with database() as db:
        return [
            dict(r)
            for r in db.execute(
                "SELECT * FROM chapters WHERE archived_at IS NULL ORDER BY sort_order,id"
            )
        ]


@router.post("/chapters", status_code=201)
def add_chapter(body: ChapterInput):
    with database() as db:
        exists(db, "courses", body.course_id)
        cur = db.execute(
            "INSERT INTO chapters(title,description,course_id,sort_order,published) VALUES (?,?,?,?,?)",
            (
                body.title,
                body.description,
                body.course_id,
                body.sort_order,
                body.published,
            ),
        )
        return exists(db, "chapters", cur.lastrowid)


@router.put("/chapters/{item_id}")
def edit_chapter(item_id: int, body: ChapterInput):
    with database() as db:
        old = exists(db, "chapters", item_id)
        if old["course_id"] != body.course_id:
            raise HTTPException(422, "本版不支持跨课程移动已有章节")
        db.execute(
            "UPDATE chapters SET title=?,description=?,sort_order=?,published=? WHERE id=?",
            (body.title, body.description, body.sort_order, body.published, item_id),
        )
        # 保留旧 API 的章节名称展示字段，但关联一律以 ID 为准。
        db.execute(
            "UPDATE documents SET chapter=? WHERE chapter_id=?", (body.title, item_id)
        )
        return exists(db, "chapters", item_id)


@router.delete("/chapters/{item_id}", status_code=204)
def delete_chapter(item_id: int):
    with database() as db:
        exists(db, "chapters", item_id)
        if any(
            db.execute(
                f"SELECT 1 FROM {table} WHERE chapter_id=? LIMIT 1", (item_id,)
            ).fetchone()
            for table in ["knowledge_points", "questions", "documents"]
        ):
            raise HTTPException(
                409, "章节仍有关联内容，请先调整归属或取消发布；不会级联删除"
            )
        db.execute("DELETE FROM chapters WHERE id=?", (item_id,))


class KnowledgeInput(BaseModel):
    chapter_id: int
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=50000)
    published: bool = False
    lab_path: str | None = None

    @field_validator("lab_path")
    @classmethod
    def allowed_lab(cls, value):
        if value not in (None, "", "/lab", "/student/experiments"):
            raise ValueError("只允许关联现有 FCFS 实验")
        return value or None


@router.get("/knowledge")
def knowledge():
    with database() as db:
        return [
            dict(r)
            for r in db.execute("SELECT * FROM knowledge_points ORDER BY chapter_id,id")
        ]


@router.post("/knowledge", status_code=201)
def add_knowledge(body: KnowledgeInput):
    with database() as db:
        exists(db, "chapters", body.chapter_id)
        cur = db.execute(
            "INSERT INTO knowledge_points(chapter_id,title,content,lab_path,published) VALUES (?,?,?,?,?)",
            (body.chapter_id, body.title, body.content, body.lab_path, body.published),
        )
        return exists(db, "knowledge_points", cur.lastrowid)


@router.put("/knowledge/{item_id}")
def edit_knowledge(item_id: int, body: KnowledgeInput):
    with database() as db:
        old = exists(db, "knowledge_points", item_id)
        chapter = exists(db, "chapters", body.chapter_id)
        old_chapter = exists(db, "chapters", old["chapter_id"])
        if chapter["course_id"] != old_chapter["course_id"]:
            raise HTTPException(422, "本版不支持跨课程移动知识点")
        db.execute(
            "UPDATE knowledge_points SET chapter_id=?,title=?,content=?,lab_path=?,published=? WHERE id=?",
            (
                body.chapter_id,
                body.title,
                body.content,
                body.lab_path,
                body.published,
                item_id,
            ),
        )
        return exists(db, "knowledge_points", item_id)


class DocumentInput(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    chapter_id: int | None = None
    knowledge_ids: list[int] = Field(default_factory=list, max_length=100)
    published: bool = False
    summary: str = Field(default="", max_length=2000)
    source_title: str = Field(default="", max_length=500)
    source_url: str = Field(default="", max_length=1000)


@router.get("/documents")
def documents(
    q: str = "",
    chapter_id: int | None = None,
    published: bool | None = None,
    trash: bool = False,
    limit: int = 50,
    offset: int = 0,
    user: dict = Depends(teacher),
):
    return list_documents(
        user, limit, offset, "public", q, chapter_id, trash, published
    )


@router.put("/documents/{item_id}")
def edit_document(item_id: int, body: DocumentInput):
    with database() as db:
        document = exists(db, "documents", item_id)
        if document["category"] != "public" or document["deleted_at"]:
            raise HTTPException(404, "公共资料不存在")
        chapter = (
            exists(db, "chapters", body.chapter_id)
            if body.chapter_id is not None
            else None
        )
        if chapter and chapter["course_id"] != document["course_id"]:
            raise HTTPException(422, "资料与章节必须属于同一课程")
        for kid in set(body.knowledge_ids):
            knowledge = exists(db, "knowledge_points", kid)
            kchapter = exists(db, "chapters", knowledge["chapter_id"])
            if kchapter["course_id"] != document["course_id"]:
                raise HTTPException(422, "资料与知识点必须属于同一课程")
        db.execute(
            "UPDATE documents SET title=?,chapter_id=?,chapter=?,published=?,summary=?,source_title=?,source_url=?,published_at=CASE WHEN ?=1 AND published=0 THEN CURRENT_TIMESTAMP ELSE published_at END,updated_at=CURRENT_TIMESTAMP WHERE id=?",
            (
                body.title,
                body.chapter_id,
                chapter["title"] if chapter else "",
                body.published,
                body.summary,
                body.source_title,
                body.source_url,
                body.published,
                item_id,
            ),
        )
        db.execute(
            "DELETE FROM document_knowledge_points WHERE document_id=?", (item_id,)
        )
        for kid in set(body.knowledge_ids):
            db.execute(
                "INSERT INTO document_knowledge_points VALUES (?,?)", (item_id, kid)
            )
        result = exists(db, "documents", item_id)
        result["knowledge_ids"] = body.knowledge_ids
        return result


class QuestionInput(BaseModel):
    chapter_id: int
    prompt: str = Field(min_length=1, max_length=2000)
    options: list[str] = Field(min_length=2, max_length=8)
    answer: int = Field(ge=0)
    explanation: str = Field(default="", max_length=5000)
    published: bool = False


@router.get("/questions")
def questions():
    with database() as db:
        return [
            {**dict(r), "options": json.loads(r["options"])}
            for r in db.execute("SELECT * FROM questions ORDER BY chapter_id,id")
        ]


@router.post("/questions", status_code=201)
def add_question(body: QuestionInput):
    with database() as db:
        exists(db, "chapters", body.chapter_id)
        if body.answer >= len(body.options) or any(
            not o.strip() or len(o) > 1000 for o in body.options
        ):
            raise HTTPException(422, "选项或正确答案无效")
        cur = db.execute(
            "INSERT INTO questions(chapter_id,prompt,options,answer,explanation,published) VALUES (?,?,?,?,?,?)",
            (
                body.chapter_id,
                body.prompt,
                json.dumps(body.options, ensure_ascii=False),
                body.answer,
                body.explanation,
                body.published,
            ),
        )
        return {"id": cur.lastrowid, **body.model_dump()}


@router.put("/questions/{item_id}")
def edit_question(item_id: int, body: QuestionInput):
    with database() as db:
        exists(db, "questions", item_id)
        exists(db, "chapters", body.chapter_id)
        if body.answer >= len(body.options) or any(
            not o.strip() or len(o) > 1000 for o in body.options
        ):
            raise HTTPException(422, "选项或正确答案无效")
        db.execute(
            "UPDATE questions SET chapter_id=?,prompt=?,options=?,answer=?,explanation=?,published=? WHERE id=?",
            (
                body.chapter_id,
                body.prompt,
                json.dumps(body.options, ensure_ascii=False),
                body.answer,
                body.explanation,
                body.published,
                item_id,
            ),
        )
        return {"id": item_id, **body.model_dump()}
