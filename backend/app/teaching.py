"""Teacher public-material settings. No question bank or directory management."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from .auth import teacher
from .access import list_documents

router = APIRouter(prefix="/api/teacher", dependencies=[Depends(teacher)])

def database():
    from .main import database
    return database()

class DocumentInput(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    published: bool = False
    summary: str = Field(default="", max_length=2000)
    source_title: str = Field(default="", max_length=500)
    source_url: str = Field(default="", max_length=1000)

@router.get("/documents")
def documents(q: str = "", published: bool | None = None, trash: bool = False,
              limit: int = 50, offset: int = 0, user=Depends(teacher)):
    return list_documents(user, limit, offset, "public", q, trash, published)

@router.put("/documents/{item_id}")
def edit_document(item_id: int, body: DocumentInput):
    with database() as db:
        document = db.execute("SELECT * FROM documents WHERE id=?", (item_id,)).fetchone()
        if not document or document['category'] != 'public' or document['deleted_at']:
            raise HTTPException(404, "公共资料不存在")
        db.execute("UPDATE documents SET title=?,published=?,summary=?,source_title=?,source_url=?,published_at=CASE WHEN ?=1 AND published=0 THEN CURRENT_TIMESTAMP ELSE published_at END,updated_at=CURRENT_TIMESTAMP WHERE id=?",
                   (body.title,body.published,body.summary,body.source_title,body.source_url,body.published,item_id))
        return dict(db.execute("SELECT * FROM documents WHERE id=?", (item_id,)).fetchone())
