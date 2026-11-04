"""统一内容可见性；列表、详情、文件与 AI 上下文都必须调用。"""

from fastapi import HTTPException


def document_visible(db, document: dict, user: dict) -> bool:
    if document.get("deleted_at"):
        return False
    if document["category"] == "personal":
        return document["owner_id"] == user["id"]
    if document["category"] != "public":
        return False
    if user["role"] == "teacher":
        return True
    if not document["published"]:
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
    trash: bool = False,
    published: bool | None = None,
):
    from .database import database

    if not 1 <= limit <= 100 or offset < 0 or len(q) > 200:
        raise HTTPException(422, "分页或搜索条件无效")
    with database() as db:
        rows = [
            dict(r)
            for r in db.execute(
                """
            SELECT d.id,d.title,d.category,d.original_name,d.file_size,d.file_type,d.created_at,d.updated_at,d.owner_id,d.published,d.deleted_at,d.sha256,d.summary,d.source_title,d.source_url,d.published_at
            FROM documents d
            WHERE ((?=1 AND d.deleted_at IS NOT NULL) OR (?=0 AND d.deleted_at IS NULL))
            AND (? IS NULL OR d.category=?)
            AND (? IS NULL OR d.published=?) AND instr(lower(d.title),lower(?))>0
            AND ((d.category='personal' AND d.owner_id=?) OR (d.category='public' AND (? OR (?=0 AND d.published=1))))
            ORDER BY d.id DESC LIMIT ? OFFSET ?
        """,
                (
                    trash,
                    trash,
                    category,
                    category,
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
        return rows
