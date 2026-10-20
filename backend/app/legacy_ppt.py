"""有界读取MS-PPT记录；不运行Office/宏，不把历史保存记录拼成当前课件。"""

import struct
from fastapi import HTTPException

MAX_STREAM = 64 * 1024**2


def records(data, start=0, end=None):
    end = len(data) if end is None else end
    count = 0
    while start + 8 <= end:
        flags, kind, size = struct.unpack_from("<HHI", data, start)
        if not flags and not kind and not size and not any(data[start:end]):
            return
        stop = start + 8 + size
        if stop > end or count > 100000:
            raise ValueError("PPT记录边界或数量异常")
        yield start, flags, kind, start + 8, stop
        start = stop
        count += 1
    if start != end and any(data[start:end]):
        raise ValueError("PPT记录不完整")


def record_at(data, offset, expected):
    record = next(records(data, offset), None)
    if not record or record[2] != expected:
        raise ValueError("PPT当前版本索引无效")
    return record


def text_records(data, start, end, depth=0):
    if depth > 20:
        raise ValueError("PPT嵌套层数过多")
    result = []
    for _, flags, kind, begin, stop in records(data, start, end):
        if kind == 4000:
            result.append(data[begin:stop].decode("utf-16le", errors="replace"))
        elif kind == 4008:
            # TextBytesAtom是Unicode低字节，不使用系统本地编码猜测。
            result.append(data[begin:stop].decode("latin1"))
        elif flags & 15 == 15:
            result.extend(text_records(data, begin, stop, depth + 1))
    return result


def parse_document(data, current=None):
    mapping = {}
    if current is not None:
        visited = set()
        edit = current
        doc_id = None
        while edit:
            if edit in visited or len(visited) > 1000:
                raise ValueError("PPT历史索引循环")
            visited.add(edit)
            _, _, _, begin, stop = record_at(data, edit, 4085)
            if stop - begin < 28:
                raise ValueError("PPT编辑索引不完整")
            previous, directory, current_doc = struct.unpack_from(
                "<III", data, begin + 8
            )
            if doc_id is None:
                doc_id = current_doc
            _, _, _, begin, stop = record_at(data, directory, 6002)
            while begin < stop:
                if begin + 4 > stop:
                    raise ValueError("PPT持久索引不完整")
                value = struct.unpack_from("<I", data, begin)[0]
                first, count = value & 0xFFFFF, value >> 20
                begin += 4
                if not count or begin + 4 * count > stop:
                    raise ValueError("PPT持久索引范围无效")
                for index in range(count):
                    mapping.setdefault(
                        first + index, struct.unpack_from("<I", data, begin)[0]
                    )
                    begin += 4
            edit = previous
        if doc_id not in mapping:
            raise ValueError("PPT当前文档索引缺失")
        document = record_at(data, mapping[doc_id], 1000)
    else:
        documents = [r for r in records(data) if r[2] == 1000]
        if len(documents) != 1:
            raise ValueError("无法确认PPT当前保存版本")
        document = documents[0]
    slides = []
    for _, flags, kind, begin, stop in records(data, document[3], document[4]):
        if kind != 4080 or flags >> 4 != 0:
            continue
        current_slide = None
        for _, f, k, b, e in records(data, begin, stop):
            if k == 1011:
                if e - b < 20:
                    raise ValueError("PPT幻灯片索引不完整")
                current_slide = {
                    "persist": struct.unpack_from("<I", data, b)[0],
                    "parts": [],
                }
                slides.append(current_slide)
                if len(slides) > 2000:
                    raise ValueError("PPT超过2000页")
            elif current_slide is not None and k in (4000, 4008):
                current_slide["parts"].append(
                    data[b:e].decode(
                        "utf-16le" if k == 4000 else "latin1", errors="replace"
                    )
                )
        # 只解析当前幻灯片列表；母版/备注不混入授课内容。
    result = []
    for index, slide in enumerate(slides):
        if not slide["parts"] and slide["persist"] in mapping:
            record = record_at(data, mapping[slide["persist"]], 1006)
            slide["parts"] = text_records(data, record[3], record[4])
        text = "\n".join(
            part.replace("\r", "\n").replace("\x0b", "\n").strip()
            for part in slide["parts"]
            if part.strip()
        )
        result.append(
            {"number": index + 1, "text": text[:20000], "truncated": len(text) > 20000}
        )
    if not result:
        raise ValueError("没有可读取的当前幻灯片目录")
    return result


def inspect_ppt(path, offset=0, limit=None):
    import olefile

    try:
        with olefile.OleFileIO(path) as book:
            if book.exists("EncryptedSummary") or book.exists("EncryptionInfo"):
                raise ValueError("课件已加密")
            if book.get_size("PowerPoint Document") > MAX_STREAM:
                raise ValueError("PPT文档文字流超过64MiB，请分批提供文字资料")
            data = book.openstream("PowerPoint Document").read()
            current = None
            if book.exists("Current User"):
                if book.get_size("Current User") > 1024**2:
                    raise ValueError("PPT用户索引过大")
                raw = book.openstream("Current User").read()
                _, _, _, b, e = record_at(raw, 0, 4086)
                if e - b < 20:
                    raise ValueError("PPT用户索引不完整")
                token, current = struct.unpack_from("<II", raw, b + 4)
                if token != 0xE391C05F:
                    raise ValueError("PPT加密或用户索引不受支持")
            slides = parse_document(data, current)
            return {
                "total": len(slides),
                "offset": offset,
                "slides": (
                    slides[offset : offset + limit]
                    if limit is not None
                    else slides[offset:]
                ),
            }
    except (OSError, ValueError, TypeError, IndexError, KeyError, struct.error) as exc:
        raise HTTPException(
            422,
            "旧PPT文字读取失败："
            + str(exc)[:120]
            + "。可使用免费LibreOffice另存为PPTX，或上传/粘贴文字资料；图片文字需OCR",
        ) from None
