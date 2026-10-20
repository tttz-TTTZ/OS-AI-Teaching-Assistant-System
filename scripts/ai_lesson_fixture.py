"""仅限隔离浏览器验收的模拟模型候选和合成旧PPT，不用于产品出题。"""

import json
from pathlib import Path
import struct
import sys

TEXT = "操作系统负责管理计算机硬件和软件资源，为用户和应用程序提供服务。进程调度需要根据算法选择就绪进程。"


if __name__ == "__main__":
    if sys.argv[1] == "--ppt":
        from presentation_fixture import ppt_bytes

        def rec(kind, payload, flags=0):
            return struct.pack("<HHI", flags, kind, len(payload)) + payload

        content = b"".join(
            rec(1011, struct.pack("<IIIII", i + 2, 0, 1, i + 256, 0))
            + rec(4000, text.encode("utf-16le"))
            for i, text in enumerate(
                [
                    TEXT,
                    "操作系统的服务包括提供用户界面和程序接口。课程学习要理解资源管理和用户服务的关系。",
                    "第三页是拓展内容，本批不应读取。 ",
                ]
            )
        )
        doc = rec(1000, rec(4080, content, 15), 15)
        sys.stdout.buffer.write(ppt_bytes()[:-4096] + doc.ljust(4096, b"\0"))
        sys.exit(0)
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
    from app.main import database, DB_PATH
    from app.question_sources import SourcesInput, excerpts
    from app.ai_lessons import LessonPlan, check_plan, result, own_job

    if "os-v02-" not in str(DB_PATH):
        raise RuntimeError("仅允许隔离总验收临时数据库")
    config = json.loads(sys.stdin.read())
    with database() as db:
        user = dict(
            db.execute(
                "SELECT * FROM users WHERE username=? AND role='teacher'",
                (sys.argv[1],),
            ).fetchone()
        )
    preview = excerpts(SourcesInput.model_validate(config), user)
    if preview["fingerprint"] != config["fingerprint"]:
        raise RuntimeError("预览指纹不匹配")
    source = preview["chunks"][0]
    point = {
        "title": "AI备课验收知识点",
        "summary": "课程资源管理",
        "objectives": "能够解释操作系统职责",
        "blocks": [
            {"kind": kind, "title": label, "text": TEXT}
            for kind, label in [
                ("intro", "问题导入"),
                ("concept", "核心概念"),
                ("explanation", "原理精讲"),
                ("case", "典型案例"),
                ("mistake", "易错辨析"),
                ("summary", "学习总结与练习建议"),
            ]
        ],
        "source_ref": source["ref"],
        "source_quote": source["text"][:35],
        "teaching_note": "模拟候选；动画需教师选择真实模板",
    }
    plan = LessonPlan(
        chapter_id=config["chapter_id"],
        sections=[{"title": "AI备课验收小节", "points": [point]}],
    )
    with database() as db:
        check_plan(db, plan, preview, user)
        ident = db.execute(
            "INSERT INTO ai_lesson_jobs(user_id,request_key,request_hash,config_json,sources_json,model,status,body_json) VALUES(?,?,?,?,?,?,'ready',?)",
            (
                user["id"],
                config["request_key"],
                "browser-fixture",
                json.dumps(config),
                json.dumps(preview, ensure_ascii=False),
                "mock-browser-test",
                plan.model_dump_json(),
            ),
        ).lastrowid
        print(json.dumps(result(own_job(db, ident, user)), ensure_ascii=False))
