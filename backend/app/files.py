"""文件先完整写入暂存区并校验，再原子改名和提交元数据；文件版本留存。"""

import hashlib
import os
from pathlib import Path
import tempfile
import uuid
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from .auth import require_user
from .access import read_document, visible_chapter, writable_document
from .persistence import checked_file, storage_lock

router = APIRouter(prefix="/api/materials")
MAX_SIZE = 10 * 1024 * 1024
PUBLIC_MAX_SIZE = 150 * 1024 * 1024


def db_path():
    from .main import DB_PATH

    return DB_PATH


def database():
    from .main import database as context

    return context()


def storage() -> Path:
    folder = db_path().parent / "uploads"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


async def store_upload(
    file: UploadFile,
    user: dict,
    chapter: str = "",
    chapter_id: int | None = None,
    category: str = "personal",
    replace_id: int | None = None,
):
    stage = None
    target = None
    committed = False
    try:
        if category not in ("personal", "public"):
            raise HTTPException(422, "资料类别无效")
        if category == "public" and user["role"] != "teacher":
            raise HTTPException(403, "仅教师可上传公共资料")
        original = None
        if replace_id is not None:
            with database() as db:
                original = read_document(db, replace_id, user)
                writable_document(original, user)
            category = original["category"]
        suffix = Path(file.filename or "").suffix.lower()
        if suffix not in (".pdf", ".txt"):
            raise HTTPException(415, "仅支持 PDF 和 UTF-8 TXT 文件")
        maximum = (
            PUBLIC_MAX_SIZE if category == "public" and suffix == ".pdf" else MAX_SIZE
        )
        incoming = db_path().parent / ".incoming"
        incoming.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=incoming, delete=False) as out:
            stage = Path(out.name)
            size = 0
            sha = hashlib.sha256()
            while chunk := await file.read(65536):
                size += len(chunk)
                if size > maximum:
                    raise HTTPException(413, f"文件超出上限：{maximum//1024//1024} MiB")
                out.write(chunk)
                sha.update(chunk)
        if size == 0:
            raise HTTPException(422, "文件不能为空")
        content = ""
        if suffix == ".pdf":
            with stage.open("rb") as source:
                if source.read(5) != b"%PDF-":
                    raise HTTPException(415, "PDF 文件头无效")
        else:
            try:
                content = stage.read_text(encoding="utf-8-sig")
            except UnicodeError:
                raise HTTPException(415, "TXT 必须使用 UTF-8 编码") from None
            if "\x00" in content:
                raise HTTPException(415, "TXT 包含非法二进制内容")
            content = content[:50000]
        name = (file.filename or "资料").replace("\\", "/").split("/")[-1][:200]
        with storage_lock(db_path()), database() as db:
            selected = None
            if replace_id is not None:
                # 暂存期间可能发生删除/撤回；提交时重新检查。
                original = read_document(db, replace_id, user)
                writable_document(original, user)
            else:
                row = (
                    db.execute(
                        "SELECT id FROM chapters WHERE id=?", (chapter_id,)
                    ).fetchone()
                    if chapter_id is not None
                    else db.execute(
                        "SELECT id FROM chapters WHERE title=? AND archived_at IS NULL ORDER BY id LIMIT 1",
                        (chapter,),
                    ).fetchone()
                )
                if (chapter or chapter_id is not None) and not row:
                    raise HTTPException(422, "章节不存在")
                selected = visible_chapter(db, row[0], user) if row else None
            # 范围内查重，不暴露其他用户的上传事实。
            duplicate = db.execute(
                "SELECT id FROM documents WHERE sha256=? AND deleted_at IS NULL AND category=? AND (?='public' OR owner_id=?) AND (? IS NULL OR id<>?)",
                (
                    sha.hexdigest(),
                    category,
                    category,
                    user["id"],
                    replace_id,
                    replace_id,
                ),
            ).fetchone()
            if duplicate:
                raise HTTPException(
                    409, "可管理的资料中已有同内容文件，请使用已有资料或更新其设置"
                )
            target = storage() / (uuid.uuid4().hex + suffix)
            os.replace(stage, target)
            if original:
                if original["stored_name"]:
                    db.execute(
                        "INSERT INTO document_versions(document_id,stored_name,original_name,file_size,file_type,sha256) VALUES (?,?,?,?,?,?)",
                        (
                            replace_id,
                            original["stored_name"],
                            original["original_name"],
                            original["file_size"],
                            original["file_type"],
                            original["sha256"],
                        ),
                    )
                db.execute(
                    "UPDATE documents SET content=?,original_name=?,stored_name=?,file_size=?,file_type=?,sha256=?,published=0,updated_at=CURRENT_TIMESTAMP WHERE id=?",
                    (
                        content,
                        name,
                        target.name,
                        size,
                        suffix[1:],
                        sha.hexdigest(),
                        replace_id,
                    ),
                )
                document_id = replace_id
            else:
                cur = db.execute(
                    "INSERT INTO documents(title,content,chapter,category,original_name,stored_name,file_size,file_type,owner_id,chapter_id,course_id,sha256) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        name,
                        content,
                        selected["title"] if selected else "",
                        category,
                        name,
                        target.name,
                        size,
                        suffix[1:],
                        user["id"],
                        selected["id"] if selected else None,
                        selected["course_id"] if selected else 1,
                        sha.hexdigest(),
                    ),
                )
                document_id = cur.lastrowid
        committed = True
        with database() as db:
            return dict(
                db.execute(
                    "SELECT * FROM documents WHERE id=?", (document_id,)
                ).fetchone()
            )
    finally:
        if stage:
            stage.unlink(missing_ok=True)
        if target and not committed:
            target.unlink(missing_ok=True)
        await file.close()


@router.post("/upload", status_code=201)
async def upload(
    file: UploadFile = File(...),
    chapter: str = Form("", max_length=100),
    chapter_id: int | None = Form(None),
    category: str = Form("personal"),
    user: dict = Depends(require_user),
):
    return await store_upload(file, user, chapter, chapter_id, category)


@router.post("/{material_id}/replace")
async def replace(
    material_id: int, file: UploadFile = File(...), user: dict = Depends(require_user)
):
    return await store_upload(file, user, replace_id=material_id)


@router.post("/{material_id}/restore")
def restore(material_id: int, user: dict = Depends(require_user)):
    with storage_lock(db_path()), database() as db:
        row = db.execute(
            "SELECT * FROM documents WHERE id=?", (material_id,)
        ).fetchone()
        if not row:
            raise HTTPException(404, "资料不存在")
        item = dict(row)
        writable_document(item, user)
        if not item["deleted_at"]:
            raise HTTPException(409, "资料不在回收站")
        if item["stored_name"]:
            try:
                checked_file(storage(), item["stored_name"])
            except ValueError:
                raise HTTPException(409, "原文件缺失，请从备份恢复") from None
        db.execute(
            "UPDATE documents SET deleted_at=NULL,published=0 WHERE id=?",
            (material_id,),
        )
        return dict(
            db.execute("SELECT * FROM documents WHERE id=?", (material_id,)).fetchone()
        )


@router.get("/{material_id}/versions")
def versions(material_id: int, user: dict = Depends(require_user)):
    with database() as db:
        writable_document(read_document(db, material_id, user), user)
        return [
            dict(r)
            for r in db.execute(
                "SELECT id,original_name,file_size,file_type,created_at FROM document_versions WHERE document_id=? ORDER BY id DESC",
                (material_id,),
            )
        ]


@router.get("/{material_id}/file")
def download(
    material_id: int, download: bool = False, user: dict = Depends(require_user)
):
    with database() as db:
        material = read_document(db, material_id, user)
    if not material["stored_name"]:
        raise HTTPException(404, "该资料没有附件")
    try:
        target = checked_file(storage(), material["stored_name"])
    except ValueError:
        raise HTTPException(404, "文件不存在") from None
    return FileResponse(
        target,
        media_type=(
            "application/pdf"
            if material["file_type"] == "pdf"
            else "text/plain; charset=utf-8"
        ),
        filename=material["original_name"],
        content_disposition_type="attachment" if download else "inline",
        headers={
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )
