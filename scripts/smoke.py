"""对正在运行的前端开发代理进行集成验证。"""

import httpx

with httpx.Client(base_url="http://127.0.0.1:5173", timeout=60) as c:
    assert c.get("/").status_code == 200
    assert c.get("/api/health").json()["database"] == "ok"
    r = c.post(
        "/api/materials",
        json={
            "title": "集成验证临时资料",
            "content": "进程是资源分配单位",
            "chapter": "进程管理",
        },
    )
    r.raise_for_status()
    mid = r.json()["id"]
    try:
        assert c.get(f"/api/materials/{mid}").json()["title"] == "集成验证临时资料"
        c.put(
            f"/api/materials/{mid}",
            json={"title": "更新后的测试资料", "content": "进程是资源分配单位"},
        ).raise_for_status()
        chapters = c.get("/api/chapters").json()
        assert len(chapters) >= 7
        assert c.get("/api/knowledge?chapter_id=3").json()
        fcfs = c.post(
            "/api/labs/fcfs",
            json={
                "processes": [
                    {"pid": "P1", "arrival": 2, "burst": 2},
                    {"pid": "P2", "arrival": 7, "burst": 1},
                ]
            },
        )
        fcfs.raise_for_status()
        assert fcfs.json()["average_waiting"] == 0
        assert len([s for s in fcfs.json()["timeline"] if s["idle"]]) == 2
        upload = c.post(
            "/api/materials/upload",
            files={"file": ("smoke.txt", "测试资料".encode(), "text/plain")},
        )
        upload.raise_for_status()
        fid = upload.json()["id"]
        try:
            assert c.get(f"/api/materials/{fid}/file").text == "测试资料"
        finally:
            c.delete(f"/api/materials/{fid}").raise_for_status()
        assert (
            c.post(
                "/api/materials/upload", files={"file": ("bad.exe", b"x")}
            ).status_code
            == 415
        )
        q = c.get("/api/questions?chapter_id=1").json()[0]
        assert (
            c.post("/api/practice/submit", json={"answers": {str(q["id"]): 0}}).json()[
                "score"
            ]
            == 1
        )
        r = c.post(
            "/api/chat", json={"question": "依据资料解释进程", "material_id": mid}
        )
        health = c.get("/api/health").json()
        if health["llm_mode"] == "openai" and not health["ai_configured"]:
            assert r.status_code == 503 and "尚未配置 AI 服务" in r.json()["detail"]
            print("PASS: AI 未配置时明确返回 503；未验证真实模型")
        else:
            r.raise_for_status()
            result = r.json()
            assert result["answer"]
            assert any(
                row["id"] == result["id"] for row in c.get("/api/conversations").json()
            )
            print(f"PASS: 模型适配模式={result['mode']}")
        for path in ["/", "/materials", "/knowledge", "/lab", "/chat", "/practice"]:
            assert '<div id="root">' in c.get(path).text
        print(
            "PASS: 前端代理 → 后端 → SQLite；课程、文件、FCFS、练习、六条路由 HTTP 回退"
        )
    finally:
        c.delete(f"/api/materials/{mid}").raise_for_status()
    assert c.get(f"/api/materials/{mid}").status_code == 404
