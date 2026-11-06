import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Depends
from .database import database, db_path

@asynccontextmanager
async def lifespan(app):
    from .migrations import migrate

    migrate(db_path())
    with database() as db:
        db.execute("PRAGMA journal_mode=WAL")
    yield


from .auth import require_user
from .access import (
    read_document,
    writable_document,
    list_documents,
)

app = FastAPI(
    title="操作系统课程智能助教 · 开发底座",
    version="0.3.0",
    lifespan=lifespan,
    dependencies=[Depends(require_user)],
)

from .upload_limit import UploadLimitMiddleware

app.add_middleware(UploadLimitMiddleware)


@app.get("/api/health")
def health():
    with database() as db:
        db.execute("SELECT 1").fetchone()
    personal_configured = bool(os.getenv("DEEPSEEK_API_KEY", "").strip())
    return {
        "status": "ok",
        "database": "ok",
        "personal_ai_configured": personal_configured,
        "platform_revision": "material-learning-v10",
    }


@app.get("/api/materials")
def materials(
    limit: int = 50,
    offset: int = 0,
    category: str | None = None,
    user: dict = Depends(require_user),
    q: str = "",
    trash: bool = False,
):
    if not 1 <= limit <= 100 or offset < 0:
        raise HTTPException(422, "limit 应为 1–100，offset 不小于 0")
    if category not in (None, "public", "personal"):
        raise HTTPException(422, "资料类别无效")
    return list_documents(user, limit, offset, category, q, trash)


@app.get("/api/materials/{material_id}")
def read_material(material_id: int, user: dict = Depends(require_user)):
    with database() as db:
        return read_document(db, material_id, user)


@app.delete("/api/materials/{material_id}", status_code=204)
def delete_material(material_id: int, user: dict = Depends(require_user)):
    # 回收站保留元数据与原文件，避免数据库成功删除而物理文件失败的不一致。
    from .persistence import storage_lock

    with storage_lock(db_path()), database() as db:
        material = read_document(db, material_id, user)
        writable_document(material, user)
        db.execute(
            "UPDATE documents SET deleted_at=CURRENT_TIMESTAMP,published=0 WHERE id=?",
            (material_id,),
        )


# 上传路由在带 ID 的资料路由之后注册，POST 路径不冲突。
from .files import router as files_router

app.include_router(files_router)

from .auth import router as auth_router

app.include_router(auth_router)

from .public_materials import router as public_materials_router

app.include_router(public_materials_router)


@app.middleware("http")
async def no_api_cache(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.get("/api/config")
def configuration():
    from .files import (
        PUBLIC_MAX_SIZE,
        MAX_SIZE,
        PUBLIC_PRESENTATION_MAX_SIZE,
        PERSONAL_PRESENTATION_MAX_SIZE,
    )

    return {
        "public_upload_limit_bytes": PUBLIC_MAX_SIZE,
        "personal_upload_limit_bytes": MAX_SIZE,
        "public_presentation_upload_limit_bytes": PUBLIC_PRESENTATION_MAX_SIZE,
        "personal_presentation_upload_limit_bytes": PERSONAL_PRESENTATION_MAX_SIZE,
        "storage": "persistent-filesystem",
        "auth": "tab-context-cookie",
    }


from .accounts import router as accounts_router

app.include_router(accounts_router)


from .study_tools import router as study_tools_router

app.include_router(study_tools_router)

from .personal_chat import router as personal_chat_router

app.include_router(personal_chat_router)
