"""限量流式上传；仅通过数据库 ID 访问服务生成的文件名。"""

import uuid
from pathlib import Path
from fastapi import APIRouter, File, Form, UploadFile, HTTPException
from fastapi.responses import FileResponse

router = APIRouter(prefix="/api/materials")
MAX_SIZE = 10 * 1024 * 1024


def storage() -> Path:
    from .main import DB_PATH

    folder = DB_PATH.parent / "uploads"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def db_context():
    from .main import database

    return database()


@router.post("/upload", status_code=201)
async def upload(file: UploadFile = File(...), chapter: str = Form("", max_length=100)):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in (".pdf", ".txt"):
        await file.close()
        raise HTTPException(415, "仅支持 PDF 和 UTF-8 TXT 文件")
    target = storage() / (uuid.uuid4().hex + suffix)
    size = 0
    try:
        with target.open("xb") as out:
            while chunk := await file.read(65536):
                size += len(chunk)
                if size > MAX_SIZE:
                    raise HTTPException(413, "文件不能超过 10 MB")
                out.write(chunk)
        if size == 0:
            raise HTTPException(422, "文件不能为空")
        content = ""
        if suffix == ".pdf":
            with target.open("rb") as source:
                if source.read(5) != b"%PDF-":
                    raise HTTPException(415, "PDF 文件头无效")
        else:
            try:
                content = target.read_text(encoding="utf-8-sig")
            except UnicodeError:
                raise HTTPException(415, "TXT 必须使用 UTF-8 编码") from None
            if "\x00" in content:
                raise HTTPException(415, "TXT 包含非法二进制内容")
            content = content[:50000]
        name = (file.filename or "资料").replace("\\", "/").split("/")[-1][:200]
        with db_context() as db:
            cur = db.execute(
                "INSERT INTO materials(title,content,chapter,category,original_name,stored_name,file_size,file_type) VALUES (?,?,?,?,?,?,?,?)",
                (
                    name,
                    content,
                    chapter,
                    "personal",
                    name,
                    target.name,
                    size,
                    suffix[1:],
                ),
            )
            from .main import get_material

            return get_material(db, cur.lastrowid)
    except BaseException:
        target.unlink(missing_ok=True)
        raise
    finally:
        await file.close()


@router.get("/{material_id}/file")
def download(material_id: int, download: bool = False):
    from .main import get_material

    with db_context() as db:
        material = get_material(db, material_id)
    if not material["stored_name"]:
        raise HTTPException(404, "该资料没有附件")
    root = storage().resolve()
    target = (root / material["stored_name"]).resolve()
    if target.parent != root or not target.is_file():
        raise HTTPException(404, "文件不存在")
    return FileResponse(
        target,
        media_type=(
            "application/pdf"
            if material["file_type"] == "pdf"
            else "text/plain; charset=utf-8"
        ),
        filename=material["original_name"],
        content_disposition_type="attachment" if download else "inline",
        headers={"X-Content-Type-Options": "nosniff"},
    )
