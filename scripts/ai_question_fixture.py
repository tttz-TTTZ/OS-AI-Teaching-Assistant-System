"""浏览器验收专用候选题夹具；只由临时数据库验收脚本调用，不是产品模拟模式。"""

import hashlib
import json
import os
from pathlib import Path
import sys

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
    from app.main import database, DB_PATH
    from app.question_sources import SourcesInput, excerpts
    from app.study import Question
    from app.ai_questions import job_result

    if "os-v02-" not in str(DB_PATH):
        raise RuntimeError("仅允许总验收脚本创建的临时数据库")
    config = json.loads(sys.stdin.read())
    with database() as db:
        user = dict(
            db.execute(
                "SELECT * FROM users WHERE username=? AND role=?",
                (sys.argv[1], "teacher"),
            ).fetchone()
        )
    preview = excerpts(SourcesInput.model_validate(config), user)
    if preview["fingerprint"] != config["fingerprint"]:
        raise RuntimeError("资料预览未匹配")
    chunk = preview["chunks"][0]
    q = Question(
        chapter_id=config["chapter_id"],
        knowledge_ids=config["knowledge_ids"],
        kind="single",
        prompt="AI验收候选：操作系统的主要职责是什么？",
        options=["管理资源并提供服务", "只负责文字排版"],
        correct=0,
        explanation="依据所选资料，仍需教师审核。",
        published=False,
    )
    with database() as db:
        ident = db.execute(
            "INSERT INTO ai_question_jobs(user_id,request_key,request_hash,config_json,sources_json,model,status) VALUES(?,?,?,?,?,?,'succeeded')",
            (
                user["id"],
                config["request_key"],
                hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest(),
                json.dumps(config, ensure_ascii=False),
                json.dumps(preview, ensure_ascii=False),
                "mock-browser-test",
            ),
        ).lastrowid
        db.execute(
            "INSERT INTO ai_question_drafts(job_id,body_json,source_ref,source_quote) VALUES(?,?,?,?)",
            (ident, q.model_dump_json(), chunk["ref"], chunk["text"][:35]),
        )
        print(json.dumps(job_result(db, ident, user), ensure_ascii=False))
