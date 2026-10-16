"""教学图片：实际解码校验、限制大小，始终通过教材版本权限读取。"""

import hashlib
import io
import uuid
import warnings
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError
from .auth import teacher, require_user
from .digital import database, view_point, get
from .persistence import storage_lock, checked_file

router = APIRouter(prefix="/api")
MAX_IMAGE = 10 * 1024 * 1024


@router.post("/teacher/learning-assets", status_code=201)
async def upload_asset(file: UploadFile = File(...), user=Depends(teacher)):
    raw = await file.read(MAX_IMAGE + 1)
    await file.close()
    if not raw or len(raw) > MAX_IMAGE:
        raise HTTPException(413, "图片必须非空且不超过10MiB")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as image:
                if (
                    image.format not in ("PNG", "JPEG", "WEBP")
                    or image.width * image.height > 20_000_000
                ):
                    raise ValueError()
                mime = Image.MIME[image.format]
                ext = {"PNG": ".png", "JPEG": ".jpg", "WEBP": ".webp"}[image.format]
                image.verify()
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        SyntaxError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ):
        raise HTTPException(422, "只支持有效PNG/JPEG/WebP，最多2000万像素") from None
    from .main import DB_PATH

    root = DB_PATH.parent / "uploads"
    root.mkdir(parents=True, exist_ok=True)
    name = "asset-" + uuid.uuid4().hex + ext
    with storage_lock(DB_PATH):
        target = root / name
        try:
            target.write_bytes(raw)
            with database() as db:
                ident = db.execute(
                    "INSERT INTO knowledge_assets(stored_name,original_name,mime,file_size,sha256,uploader_id) VALUES (?,?,?,?,?,?)",
                    (
                        name,
                        (file.filename or "image")[:200],
                        mime,
                        len(raw),
                        hashlib.sha256(raw).hexdigest(),
                        user["id"],
                    ),
                ).lastrowid
        except BaseException:
            target.unlink(missing_ok=True)
            raise
    return {"id": ident, "original_name": file.filename}


@router.get("/learning-assets/{ident}")
def read_asset(ident: int, user=Depends(require_user)):
    with database() as db:
        asset = get(db, "knowledge_assets", ident)
        if user["role"] != "teacher":
            rows = db.execute(
                "SELECT k.* FROM knowledge_points k JOIN revision_assets r ON r.revision_id=k.published_revision_id WHERE r.asset_id=? AND k.published=1 AND k.archived_at IS NULL",
                (ident,),
            ).fetchall()
            allowed = False
            for row in rows:
                try:
                    view_point(db, dict(row), user)
                    allowed = True
                    break
                except HTTPException:
                    pass
            if not allowed:
                raise HTTPException(404, "图片不存在或未发布")
        from .main import DB_PATH

        try:
            target = checked_file(DB_PATH.parent / "uploads", asset["stored_name"])
        except ValueError:
            raise HTTPException(404, "图片文件缺失") from None
        return FileResponse(
            target,
            media_type=asset["mime"],
            headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
        )
