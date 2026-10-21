"""个人学习浏览器验收专用模型替身，仅允许隔离临时库。"""

import asyncio
import json
import os
from pathlib import Path
import sys

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
    from app import personal_learning as ai
    from app.main import DB_PATH, database

    if "os-v02-" not in str(DB_PATH):
        raise RuntimeError("仅允许隔离验收库")
    with database() as db:
        user = dict(
            db.execute(
                "SELECT * FROM users WHERE username=? AND role='student'",
                (sys.argv[1],),
            ).fetchone()
        )
    body = ai.Generation.model_validate(json.loads(sys.stdin.read()))

    async def fake(body, source, **kwargs):
        if kwargs.get("payload", {}).get("task", "").startswith("pilot_"):
            from pilot_fixture import model_output
            return model_output(kwargs["payload"])
        c = source["chunks"][0]
        cite = {"source_ref": c["ref"], "source_quote": c["text"][:30]}
        if body.kind == "practice":
            return {
                "title": "个人薄弱点自测",
                "questions": [
                    {
                        **cite,
                        "kind": "single",
                        "prompt": "资源管理是操作系统职责吗？",
                        "options": ["是", "不是"],
                        "correct": 0,
                        "explanation": "操作系统管理资源并提供服务，请继续对照课件。",
                    }
                ],
            }
        modules = []
        for mode in body.modes:
            m = {
                **cite,
                "mode": mode,
                "title": mode + "个人学习",
                "text": "依据课件理解进程、线程与资源管理。",
            }
            if mode == "map":
                m["nodes"] = [
                    {"id": "root", "parent": None, "label": "操作系统"},
                    {"id": "child", "parent": "root", "label": "资源管理"},
                ]
            if mode == "code":
                m.update(code="def demo():\n    return 1", language="python")
            if mode == "flashcards":
                m["cards"] = [
                    {
                        "front": "操作系统的基本职责？",
                        "back": "管理计算机资源，为用户和程序提供服务。",
                    },
                    {"front": "线程共享什么？", "back": "线程共享所属进程的资源。"},
                    {"front": "进程地址空间的特点？", "back": "进程具有独立地址空间。"},
                ]
            if mode == "animation":
                m["frames"] = [
                    {
                        "label": "请求资源",
                        "explanation": "进程提出资源需求",
                        "nodes": ["进程：请求", "系统：管理资源"],
                    },
                    {
                        "label": "获得资源",
                        "explanation": "系统按规则分配资源",
                        "nodes": ["进程：获得资源", "系统：更新状态"],
                    },
                ]
            modules.append(m)
        return {"title": "我的个人学习内容", "modules": modules}

    ai.call_deepseek = fake
    os.environ["DEEPSEEK_API_KEY"] = "test-only-no-network"
    print(json.dumps(asyncio.run(ai.generate(body, user)), ensure_ascii=False))
