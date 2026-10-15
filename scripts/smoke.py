"""对实际服务进行 V0.2 联调。常规使用交互输入密码；自动验收用临时账号文件。"""

import argparse
import getpass
import json
import httpx

parser = argparse.ArgumentParser()
parser.add_argument("--base-url", default="http://127.0.0.1:5173")
parser.add_argument("--username")
parser.add_argument("--test-accounts-file")
args = parser.parse_args()
if args.test_accounts_file:
    with open(args.test_accounts_file, encoding="utf-8") as source:
        account = json.load(source)[1]
    username, password = account["username"], account["password"]
else:
    username = args.username or input("学生用户名：")
    password = getpass.getpass("密码（不会显示）：")

with httpx.Client(base_url=args.base_url, timeout=60) as c:
    assert c.get("/api/health").json()["database"] == "ok"
    assert c.get("/api/materials").status_code == 401
    r = c.post("/api/auth/login", json={"username": username, "password": password})
    r.raise_for_status()
    c.headers["X-CSRF-Token"] = r.json()["csrf_token"]
    assert c.get("/api/auth/me").json()["role"] == "student"
    assert c.get("/api/teacher/chapters").status_code == 403
    assert c.get("/api/chapters").json()
    assert c.get("/api/knowledge?chapter_id=3").json()
    r = c.post(
        "/api/materials/upload",
        files={"file": ("smoke.txt", "资料".encode(), "text/plain")},
    )
    r.raise_for_status()
    mid = r.json()["id"]
    try:
        assert c.get(f"/api/materials/{mid}/file").text == "资料"
        r = c.post(
            "/api/labs/fcfs",
            json={
                "processes": [
                    {"pid": "P1", "arrival": 2, "burst": 2},
                    {"pid": "P2", "arrival": 7, "burst": 1},
                ]
            },
        )
        r.raise_for_status()
        assert r.json()["average_waiting"] == 0
        assert len([t for t in r.json()["timeline"] if t["idle"]]) == 2
        r = c.get("/api/questions?chapter_id=1")
        r.raise_for_status()
        qid = r.json()[0]["id"]
        assert (
            c.post("/api/practice/submit", json={"answers": {str(qid): 0}}).status_code
            == 200
        )
        health = c.get("/api/health").json()
        if not health["ai_configured"] and health["llm_mode"] == "openai":
            assert c.post("/api/chat", json={"question": "解释进程"}).status_code == 503
    finally:
        c.delete(f"/api/materials/{mid}").raise_for_status()
    assert c.post("/api/auth/logout").status_code == 204
    assert c.get("/api/materials").status_code == 401
    print("PASS HTTP: 登录/退出、403、章节/知识点、文件、FCFS、练习与 AI 未配置状态")
