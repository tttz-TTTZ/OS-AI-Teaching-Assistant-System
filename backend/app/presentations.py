"""只读取课件结构和文字，不执行宏、外链或Office转换程序。"""

import posixpath
from pathlib import Path
from zipfile import ZipFile, BadZipFile
from xml.etree import ElementTree as ET
from fastapi import HTTPException

PPT_MIME = "application/vnd.ms-powerpoint"
PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
MAX_SLIDES = 2000
NS = {
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
}
RID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"


def xml_part(book, name):
    info = book.getinfo(name)
    if info.file_size > 8 * 1024 * 1024:
        raise ValueError("课件XML部件过大")
    data = book.read(name)
    if b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper():
        raise ValueError("不接受带DTD或实体声明的课件")
    return ET.fromstring(data)


def slide_names(book):
    infos = book.infolist()
    names = [p.filename for p in infos]
    if len(names) > 20000 or len(set(names)) != len(names):
        raise ValueError("课件部件过多或重复")
    if sum(p.file_size for p in infos) > 2 * 1024**3:
        raise ValueError("课件解压后总大小超过2 GiB")
    for name in names:
        if name.startswith("/") or "\\" in name or ".." in name.split("/"):
            raise ValueError("课件包含非法路径")
    if sum(p.file_size for p in infos if p.filename.endswith(".xml")) > 64 * 1024**2:
        raise ValueError("课件XML总大小超过64 MiB")
    types = xml_part(book, "[Content_Types].xml")
    main_type = next(
        (
            p.attrib.get("ContentType", "")
            for p in types
            if p.attrib.get("PartName") == "/ppt/presentation.xml"
        ),
        "",
    )
    if main_type != PPTX_MIME + ".main+xml":
        raise ValueError("不是标准PPTX；不支持宏或加密课件")
    rels = {
        p.attrib.get("Id"): p for p in xml_part(book, "ppt/_rels/presentation.xml.rels")
    }
    result = []
    for entry in xml_part(book, "ppt/presentation.xml").findall(
        "p:sldIdLst/p:sldId", NS
    ):
        rel = rels[entry.attrib[RID]]
        if rel.attrib.get("TargetMode") == "External" or not rel.attrib.get(
            "Type", ""
        ).endswith("/slide"):
            raise ValueError("幻灯片引用无效")
        target = rel.attrib["Target"]
        name = posixpath.normpath(
            target.lstrip("/") if target.startswith("/") else "ppt/" + target
        )
        if not name.startswith("ppt/slides/") or name not in names:
            raise ValueError("幻灯片部件缺失或路径无效")
        result.append(name)
    if not result or len(result) > MAX_SLIDES:
        raise ValueError("课件需有1至2000页幻灯片")
    return result


def slide_text(book, name, number):
    root = xml_part(book, name)

    def paragraph_text(paragraph):
        parts = []
        for node in paragraph.iter():
            if node.tag == "{" + NS["a"] + "}t":
                parts.append(node.text or "")
            elif node.tag == "{" + NS["a"] + "}br":
                parts.append("\n")
            elif node.tag == "{" + NS["a"] + "}tab":
                parts.append("\t")
        return "".join(parts).rstrip()

    paragraphs = [paragraph_text(p) for p in root.findall(".//a:p", NS)]
    text = "\n".join(p for p in paragraphs if p)
    return {
        "number": number,
        "title": next((p[:200] for p in paragraphs if p), f"第{number}页"),
        "text": text[:20000],
        "truncated": len(text) > 20000,
    }


def inspect_pptx(path: Path, offset=0, limit=None):
    try:
        with ZipFile(path) as book:
            names = slide_names(book)
            chosen = names[offset : offset + limit] if limit is not None else names
            return {
                "total": len(names),
                "offset": offset,
                "slides": [
                    slide_text(book, name, offset + i + 1)
                    for i, name in enumerate(chosen)
                ],
            }
    except (
        BadZipFile,
        KeyError,
        ValueError,
        ET.ParseError,
        RuntimeError,
        OSError,
        NotImplementedError,
    ) as exc:
        raise HTTPException(
            415, "PPTX结构损坏、加密或不受支持：" + str(exc)[:150]
        ) from None


def validate_ppt(path: Path):
    import olefile

    try:
        if not olefile.isOleFile(path):
            raise ValueError("不是有效的旧版PPT文件")
        with olefile.OleFileIO(path) as book:
            if not book.exists("PowerPoint Document"):
                raise ValueError("缺少PowerPoint文档流；加密文件请先解除密码")
    except (OSError, ValueError, TypeError, IndexError) as exc:
        raise HTTPException(415, "PPT结构无效：" + str(exc)[:150]) from None
