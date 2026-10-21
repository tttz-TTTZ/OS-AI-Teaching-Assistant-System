"""轻量检索增强：授权后索引课件文字，按学习主题检索；不绕过文件权限。"""

from collections import Counter
import hashlib
import json
import math
import re
from typing import Literal
from pydantic import BaseModel, Field, model_validator
from fastapi import HTTPException
from .digital import database
from .access import read_document
from .files import storage
from .persistence import checked_file


class PersonalSource(BaseModel):
    document_id: int = Field(gt=0)
    start_page: int = Field(default=1, ge=1, le=600)
    end_page: int | None = Field(default=None, ge=1, le=600)

    @model_validator(mode="after")
    def valid(self):
        if self.end_page is not None and self.end_page < self.start_page:
            raise ValueError("结束页不得早于起始页")
        return self


class Retrieval(BaseModel):
    sources: list[PersonalSource] = Field(min_length=1, max_length=5)
    topic: str = Field(min_length=1, max_length=1000)
    weakness: str = Field(default="", max_length=2000)
    source_overview: bool = False
    analysis_mode: Literal["quick", "section"] = "quick"
    chapter_id: int | None = None
    section_id: int | None = None


def index_document(document, user):
    path = (
        checked_file(storage(), document["stored_name"])
        if document["stored_name"]
        else None
    )
    signature = hashlib.sha256(
        json.dumps(
            [
                document["sha256"],
                document["stored_name"],
                document["title"],
                document["content"],
                "personal-index-v2-full-blocks",
            ],
            ensure_ascii=False,
        ).encode()
    ).hexdigest()
    with database() as db:
        cached = db.execute(
            "SELECT * FROM document_ai_indexes WHERE document_id=? AND signature=?",
            (document["id"], signature),
        ).fetchone()
    if cached:
        return json.loads(cached["body_json"])
    kind = document["file_type"] or "text"
    if kind in ("ppt", "pptx"):
        from .presentations import inspect_pptx
        from .legacy_ppt import inspect_ppt

        data = (inspect_ppt if kind == "ppt" else inspect_pptx)(path, 0, 600)
        if data["total"] > 600:
            raise HTTPException(422, "自主学习每份课件最多索引600页，请按课程部分拆分")
        pages = [(p["number"], p["text"]) for p in data["slides"]]
    elif kind == "pdf":
        if not path or path.stat().st_size > 50 * 1024**2:
            raise HTTPException(
                422, "自主学习解析文字PDF需≤50MiB，请使用章节资料或文字版课件"
            )
        from pypdf import PdfReader

        try:
            reader = PdfReader(path, strict=False)
            if reader.is_encrypted or len(reader.pages) > 600:
                raise HTTPException(422, "PDF需未加密且不超过600页")
            pages = [
                (i + 1, p.extract_text() or "") for i, p in enumerate(reader.pages)
            ]
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(422, "PDF无法读取文字；图片扫描件需OCR") from None
    elif kind in ("txt", "text"):
        try:
            text = path.read_text(encoding="utf-8-sig") if path else document["content"]
        except (OSError, UnicodeError):
            raise HTTPException(422, "资料文字读取失败，请检查UTF-8编码") from None
        # TXT按段落窗口检索，仍保留物理页1，不伪造页码。
        pages = [
            (1, text[i : i + 4000]) for i in range(0, min(len(text), 2_000_000), 3500)
        ]
    else:
        raise HTTPException(422, "资料类型暂不支持自主学习解析")
    chunks = [
        {
            "ref": f'd{document["id"]}-p{p}-c{i}',
            "document_id": document["id"],
            "title": document["title"],
            "page": p,
            "text": text[:4000].strip(),
        }
        for i, (p, text) in enumerate(pages)
        if text.strip()
    ]
    if not chunks:
        raise HTTPException(422, "课件没有可读文字；图片/扫描内容需先OCR或补充TXT")
    # Preserve full text separately for the small-section pilot; quick retrieval remains compatible.
    full_chunks = []
    for page_index, (page, text) in enumerate(pages):
        for offset in range(0, len(text), 3000):
            part = text[offset : offset + 3000].strip()
            if part:
                full_chunks.append(
                    {
                        "ref": f'd{document["id"]}-p{page}-b{page_index}-{offset}',
                        "document_id": document["id"],
                        "title": document["title"],
                        "page": page,
                        "text": part,
                    }
                )
    data = {
        "full_chunks": full_chunks,
        "chunks": chunks,
        "total_pages": max(p for p, _ in pages),
        "signature": signature,
        "truncated": any(len(t) > 4000 for _, t in pages),
    }
    with database() as db:
        # 即使替换与索引同时发生，下次也须匹配signature，旧索引不会被当成新资料。
        db.execute(
            "INSERT INTO document_ai_indexes VALUES(?,?,?) ON CONFLICT(document_id) DO UPDATE SET signature=excluded.signature,body_json=excluded.body_json",
            (document["id"], signature, json.dumps(data, ensure_ascii=False)),
        )
    return data


def terms(text):
    result = []
    for token in re.findall(r"[a-zA-Z_][a-zA-Z_0-9]*|[\u4e00-\u9fff]+", text.lower()):
        result.extend(
            [token]
            if token.isascii() or len(token) < 2
            else [token[i : i + 2] for i in range(len(token) - 1)]
        )
    return Counter(result)


def retrieve(body: Retrieval, user):
    if body.analysis_mode == "section":
        from .knowledge_pilot import prepare

        return prepare(body, user)
    pool, warnings, signatures = [], [], []
    seen = set()
    for selected in body.sources:
        with database() as db:
            document = read_document(db, selected.document_id, user)
        try:
            index = index_document(document, user)
        except ValueError:
            raise HTTPException(404, "资料原件缺失") from None
        end = selected.end_page or index["total_pages"]
        if selected.start_page > index["total_pages"] or end > index["total_pages"]:
            raise HTTPException(
                422, f'“{document["title"]}”仅有{index["total_pages"]}页'
            )
        for chunk in index["chunks"]:
            if selected.start_page <= chunk["page"] <= end and chunk["ref"] not in seen:
                pool.append(chunk)
                seen.add(chunk["ref"])
        signatures.append(
            [document["id"], index["signature"], selected.start_page, end]
        )
        if index["truncated"]:
            warnings.append(
                "部分长页仅索引前4000字，请核对代码是否完整；必要时缩小或补充文字资料"
            )
    query = terms(body.topic + " " + body.weakness)
    if (not query and not body.source_overview) or not pool:
        raise HTTPException(422, "请输入具体学习主题，并选择有文字的资料范围")
    counts = [terms(c["text"]) for c in pool]
    frequency = {term: sum(term in c for c in counts) for term in query}
    scores = [
        sum(
            (1 + math.log(c[t])) * math.log(1 + len(pool) / (1 + frequency[t]))
            for t in query
            if t in c
        )
        for c in counts
    ]
    best = sorted(range(len(pool)), key=lambda i: (-scores[i], i))[:8]
    if body.source_overview:
        # Round-robin across documents: one large file cannot consume every excerpt.
        groups = [
            [i for i, c in enumerate(pool) if c["document_id"] == selected.document_id]
            for selected in body.sources
        ]
        best = []
        while any(groups) and len(best) < 8:
            for group in groups:
                if group and len(best) < 8:
                    best.append(group.pop(0))
        warnings.append(
            "资料概览：本次从已选页码范围依次选取最多8个文字片段，不代表已阅读全部课件；长资料请缩小页码范围分批学习。"
        )
    elif not any(scores):
        raise HTTPException(
            422,
            "所选资料没有检索到主题关键词，请改用课件中的术语、调整页码范围或补充资料；未调用AI盲目生成",
        )
    chunks, remaining = [], 24000
    for i in best:
        if remaining < 30:
            break
        c = dict(pool[i])
        c["text"] = c["text"][:remaining]
        chunks.append(c)
        remaining -= len(c["text"])
    if sum(len(c["text"]) for c in chunks) < 30:
        raise HTTPException(422, "相关资料文字不足，请补充学习资料")
    fingerprint = hashlib.sha256(
        json.dumps(
            [signatures, body.topic, body.weakness, body.source_overview, chunks],
            sort_keys=True,
            ensure_ascii=False,
        ).encode()
    ).hexdigest()
    return {
        "chunks": chunks,
        "characters": 24000 - remaining,
        "fingerprint": fingerprint,
        "indexed_chunks": len(pool),
        "method": "关键词检索（中英词项与中文双字词），非向量检索",
        "warnings": list(
            dict.fromkeys(
                warnings + ["仅使用可提取文字；图片、图表语义与动画未被视觉识别"]
            )
        ),
    }
