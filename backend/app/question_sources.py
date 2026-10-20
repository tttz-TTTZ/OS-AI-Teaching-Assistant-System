"""教师授权资料的有限文字摘录；不访问外部URL，不读取他人私有资料。"""

import hashlib
import json
from pydantic import BaseModel, Field, model_validator
from fastapi import HTTPException
from .access import read_document
from .digital import database
from .files import storage
from .persistence import checked_file

MAX_SOURCE_CHARS = 24000


class SourceSelection(BaseModel):
    document_id: int = Field(gt=0)
    start_page: int = Field(default=1, ge=1)
    end_page: int = Field(default=10, ge=1)

    @model_validator(mode="after")
    def valid(self):
        if self.end_page < self.start_page or self.end_page - self.start_page >= 20:
            raise ValueError("每份资料请选择1至20页")
        return self


class SourcesInput(BaseModel):
    sources: list[SourceSelection] = Field(min_length=1, max_length=5)


def excerpts(body: SourcesInput, user):
    chunks = []
    warnings = []
    remaining = MAX_SOURCE_CHARS
    for selected in body.sources:
        with database() as db:
            material = read_document(db, selected.document_id, user)
        target = None
        if material["stored_name"]:
            try:
                target = checked_file(storage(), material["stored_name"])
            except ValueError:
                raise HTTPException(404, "资料原件缺失") from None
        kind = material["file_type"] or "text"
        pages = []
        total = 1
        if kind in ("pptx", "ppt"):
            from .presentations import inspect_pptx
            from .legacy_ppt import inspect_ppt

            data = (inspect_ppt if kind == "ppt" else inspect_pptx)(
                target,
                selected.start_page - 1,
                selected.end_page - selected.start_page + 1,
            )
            total = data["total"]
            if selected.end_page > total:
                raise HTTPException(
                    422, f'“{material["title"]}”只有{total}页，请调整范围'
                )
            pages = [(p["number"], p["text"]) for p in data["slides"]]
            if kind == "ppt":
                warnings.append("旧PPT仅提取当前幻灯片中的文本，不含图片文字、动画语义和部分图表；请核对摘录")
            if any(p["truncated"] for p in data["slides"]):
                warnings.append("部分幻灯片文字已按阅读限制截取")
        elif kind == "pdf":
            if not target or target.stat().st_size > 50 * 1024**2:
                raise HTTPException(
                    422, "AI摘录仅解析50 MiB以内的文字PDF，请提供较小章节资料或TXT/PPTX"
                )
            from pypdf import PdfReader
            from pypdf.errors import PdfReadError

            try:
                with target.open("rb") as source:
                    reader = PdfReader(source, strict=False)
                    if reader.is_encrypted:
                        raise HTTPException(422, "PDF已加密，请先解除密码")
                    total = len(reader.pages)
                    if selected.end_page > total:
                        raise HTTPException(
                            422, f'“{material["title"]}”只有{total}页，请调整范围'
                        )
                    pages = [
                        (n + 1, reader.pages[n].extract_text() or "")
                        for n in range(selected.start_page - 1, selected.end_page)
                    ]
            except (PdfReadError, OSError, ValueError, KeyError, TypeError):
                raise HTTPException(
                    422, "PDF文字读取失败，请检查文件或上传TXT/PPTX；扫描图片需先做OCR"
                ) from None
        elif kind in ("txt", "text"):
            try:
                pages = [
                    (
                        1,
                        (
                            target.read_text(encoding="utf-8-sig")
                            if target
                            else material["content"]
                        ),
                    )
                ]
            except (OSError, UnicodeError):
                raise HTTPException(422, "TXT读取失败，请检查UTF-8编码") from None
        else:
            raise HTTPException(
                422, "旧PPT或该类型无法提供出题文字，请另存为PPTX、文字PDF或TXT"
            )
        for number, text in pages:
            if remaining <= 0:
                warnings.append(
                    "已达到24000字摘录上限，后续页面未发送；可缩小范围分批生成"
                )
                break
            original = text.strip()
            if not original:
                continue
            piece = original[: min(6000, remaining)]
            if not piece:
                continue
            if len(piece) < len(original):
                warnings.append("资料文字已截取：请核对预览；可缩小页码范围分批出题")
            remaining -= len(piece)
            chunks.append(
                dict(
                    ref=f'd{material["id"]}-p{number}',
                    document_id=material["id"],
                    title=material["title"],
                    page=number,
                    total_pages=total,
                    file_sha256=material.get("sha256"),
                    text=piece,
                )
            )
    if not chunks or sum(len(c["text"]) for c in chunks) < 30:
        raise HTTPException(
            422, "所选范围没有可用文字；扫描PDF/图片课件需先做OCR，或上传TXT文字"
        )
    packed = json.dumps(chunks, ensure_ascii=False, sort_keys=True)
    return dict(
        chunks=chunks,
        warnings=list(dict.fromkeys(warnings)),
        characters=sum(len(c["text"]) for c in chunks),
        fingerprint=hashlib.sha256(packed.encode()).hexdigest(),
    )
