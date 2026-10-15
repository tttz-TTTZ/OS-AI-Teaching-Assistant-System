"""统一内容可见性；列表、详情、文件与 AI 上下文都必须调用。"""

from fastapi import HTTPException


def visible_chapter(db, chapter_id: int, user: dict) -> dict:
    row = db.execute(
        "SELECT ch.*,c.published AS course_published FROM chapters ch JOIN courses c ON c.id=ch.course_id WHERE ch.id=?",
        (chapter_id,),
    ).fetchone()
    if not row or (
        user["role"] != "teacher" and not (row["published"] and row["course_published"])
    ):
        raise HTTPException(404, "章节不存在或未发布")
    return dict(row)


def document_visible(db, document: dict, user: dict) -> bool:
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
