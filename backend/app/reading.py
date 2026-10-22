"""学生阅读投影：不改数据库、来源或历史修订；教师保留完整原文。"""

import copy
import json
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=3)
def reading_copy(chapter="chapter01"):
    return json.loads(
        (
            Path(__file__).resolve().parents[1]
            / "content"
            / (chapter + "_reading.json")
        ).read_text(encoding="utf-8")
    )


def student_reading(body):
    data = copy.deepcopy(body)
    for field in ("source_title", "source_note", "printed_pages", "pdf_pages"):
        data[field] = ""
    if data.get("code", "").startswith("CH03-"):
        # The canonical text is already student-readable; keep model limits in blocks.
        notes = reading_copy("chapter03")
        for block in data["blocks"]:
            original = notes.get(data["code"] + "/" + block["id"])
            if (
                block.get("diagram")
                and original
                and block["diagram"]["note"] == original["expected_note"]
            ):
                block["diagram"]["note"] = ""
        return data
    if not data.get("code", "").startswith(("CH01-", "CH02-")):
        return data
    blocks = []
    for b in data["blocks"]:
        replacement = reading_copy(
            "chapter02" if data["code"].startswith("CH02-") else "chapter01"
        ).get(data["code"] + "/" + b["id"])
        # 教师之后改过正文时尊重其内容，不用旧展示副本把修改盖回去。
        if replacement and b.get("text") == replacement["expected"]:
            if replacement["hidden"]:
                continue
            b["text"] = replacement["text"]
        if b.get("title") == "例子与对照（教学补充）":
            b["title"] = "用例子理解"
        if b.get("diagram"):
            b["diagram"]["note"] = ""
        blocks.append(b)
    priority = {
        "intro": 0,
        "concept": 1,
        "explanation": 2,
        "diagram": 3,
        "interaction": 3,
        "case": 4,
        "mistake": 5,
        "summary": 6,
    }
    data["blocks"] = sorted(blocks, key=lambda b: priority.get(b["kind"], 7))
    if data["code"] == "CH01-A000" and data["title"] == "第一章普通内容速览与课件定位":
        data["title"] = "第一章基础概览"
    return data
