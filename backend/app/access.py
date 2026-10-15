"""统一内容可见性；列表、详情、文件与 AI 上下文都必须调用。"""

from fastapi import HTTPException


def visible_chapter(db, chapter_id: int, user: dict) -> dict:
    row = db.execute(
        "SELECT ch.*,c.published AS course_published FROM chapters ch JOIN courses c ON c.id=ch.course_id WHERE ch.id=?",
        (chapter_id,),
    ).fetchone()
    if (
        not row
        or row["archived_at"]
        or (
            user["role"] != "teacher"
            and not (row["published"] and row["course_published"])
        )
    ):
        raise HTTPException(404, "章节不存在或未发布")
    return dict(row)


def document_visible(db, document: dict, user: dict) -> bool:
    if document.get("deleted_at"):
        return False
    if document["category"] == "personal":
        return document["owner_id"] == user["id"]
    if document["category"] != "public":
        return False
    if user["role"] == "teacher":
        return True
    course = db.execute(
        "SELECT published FROM courses WHERE id=?", (document["course_id"],)
    ).fetchone()
    if not course or not course["published"] or not document["published"]:
        return False
    if document["chapter_id"] is not None:
        try:
            visible_chapter(db, document["chapter_id"], user)
        except HTTPException:
            return False
    return True


def read_document(db, document_id: int, user: dict) -> dict:
    row = db.execute("SELECT * FROM documents WHERE id=?", (document_id,)).fetchone()
    if not row or not document_visible(db, dict(row), user):
        raise HTTPException(404, "资料不存在或不可访问")
    return dict(row)


def writable_document(document: dict, user: dict) -> None:
    if document["category"] == "public":
        if user["role"] != "teacher":
            raise HTTPException(403, "仅教师可管理公共资料")
    elif document["owner_id"] != user["id"]:
        raise HTTPException(404, "资料不存在或不可访问")


def list_documents(
    user: dict,
    limit: int = 50,
    offset: int = 0,
    category: str | None = None,
    q: str = "",
    chapter_id: int | None = None,
    trash: bool = False,
    published: bool | None = None,
):
    from .main import database

    if not 1 <= limit <= 100 or offset < 0 or len(q) > 200:
        raise HTTPException(422, "分页或搜索条件无效")
    with database() as db:
        rows = [
            dict(r)
            for r in db.execute(
                """
            SELECT d.id,d.title,d.chapter,d.category,d.original_name,d.file_size,d.file_type,d.created_at,d.updated_at,d.owner_id,d.chapter_id,d.course_id,d.published,d.deleted_at,d.sha256,d.summary,d.source_title,d.source_url,d.published_at
            FROM documents d LEFT JOIN chapters ch ON ch.id=d.chapter_id JOIN courses c ON c.id=d.course_id
            WHERE ((?=1 AND d.deleted_at IS NOT NULL) OR (?=0 AND d.deleted_at IS NULL))
            AND (? IS NULL OR d.category=?) AND (? IS NULL OR d.chapter_id=?)
            AND (? IS NULL OR d.published=?) AND instr(lower(d.title),lower(?))>0
            AND ((d.category='personal' AND d.owner_id=?) OR (d.category='public' AND (? OR (?=0 AND d.published=1 AND c.published=1 AND (d.chapter_id IS NULL OR (ch.published=1 AND ch.archived_at IS NULL))))))
            ORDER BY d.id DESC LIMIT ? OFFSET ?
        """,
                (
                    trash,
                    trash,
                    category,
                    category,
                    chapter_id,
                    chapter_id,
                    published,
                    published,
                    q,
                    user["id"],
                    user["role"] == "teacher",
                    trash,
                    limit,
                    offset,
                ),
            )
        ]
        if rows:
            placeholders = ",".join("?" for _ in rows)
            links = {row["id"]: [] for row in rows}
            for row in db.execute(
                f"SELECT document_id,knowledge_point_id FROM document_knowledge_points WHERE document_id IN ({placeholders})",
                [r["id"] for r in rows],
            ):
                links[row[0]].append(row[1])
            for row in rows:
                row["knowledge_ids"] = links[row["id"]]
        return rows
