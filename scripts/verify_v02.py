"""独立临时数据库、随机测试账号和临时服务；不改用户数据库，不用默认密码。
根目录运行 .venv/bin/python scripts/verify_v02.py（Windows 见 README）。
"""

import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import httpx

ROOT = Path(__file__).resolve().parents[1]


def wait_ready(url: str, process: subprocess.Popen) -> None:
    for _ in range(100):
        if process.poll() is not None:
            raise RuntimeError(
                "验收服务提前退出；请检查日志（端口 8010/5174 是否占用）"
            )
        try:
            if httpx.get(url, timeout=1).status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.2)
    raise RuntimeError("服务启动超时")


def run(chapter_only=False) -> None:
    # 先拒绝端口冲突，避免误连已经运行的个人开发实例。
    for port in (8010, 5174):
        with socket.socket() as probe:
            # 避免上一轮已退出的服务留下 TIME_WAIT 导致误报；仍拒绝活跃监听。
            if os.name != "nt":
                probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind(("127.0.0.1", port))
            except OSError as exc:
                raise RuntimeError(
                    f"验收端口 {port} 已占用，未执行任何验收写入"
                ) from exc
    with tempfile.TemporaryDirectory(prefix="os-v02-") as folder:
        temp = Path(folder)
        os.environ["DATABASE_PATH"] = str(temp / "test.db")
        sys.path.insert(0, str(ROOT / "backend"))
        from app.main import DB_PATH
        from app.migrations import migrate
        from app.auth import create_user

        migrate(DB_PATH)
        accounts = []
        for username, role in [
            ("teacher", "teacher"),
            ("alice", "student"),
            ("bob", "student"),
        ]:
            password = secrets.token_urlsafe(24)
            create_user(username, password, role)
            accounts.append({"username": username, "password": password, "role": role})
        account_file = temp / "accounts.json"
        account_file.write_text(json.dumps(accounts), encoding="utf-8")
        account_file.chmod(0o600)
        env = os.environ.copy()
        env.update(
            {
                "LLM_MODE": "openai",
                "LLM_API_KEY": "",
                "DEEPSEEK_API_KEY": "",
                "APP_ORIGINS": "http://127.0.0.1:5174",
                "API_PROXY_TARGET": "http://127.0.0.1:8010",
                "APP_TEST_BASE_URL": "http://127.0.0.1:5174",
                "TEST_ACCOUNTS_FILE": str(account_file),
                "TEST_PYTHON": sys.executable,
            }
        )
        if not env.get("BROWSER_EXECUTABLE") and Path("/usr/bin/chromium").exists():
            env["BROWSER_EXECUTABLE"] = "/usr/bin/chromium"
        processes = []
        try:
            with (temp / "services.log").open("w+") as log:
                backend = subprocess.Popen(
                    [
                        sys.executable,
                        "-m",
                        "uvicorn",
                        "app.main:app",
                        "--host",
                        "127.0.0.1",
                        "--port",
                        "8010",
                    ],
                    cwd=ROOT / "backend",
                    env=env,
                    stdout=log,
                    stderr=log,
                )
                processes.append(backend)
                wait_ready("http://127.0.0.1:8010/api/health", backend)
                frontend = subprocess.Popen(
                    [
                        "node",
                        str(ROOT / "frontend/node_modules/vite/bin/vite.js"),
                        "--host",
                        "127.0.0.1",
                        "--port",
                        "5174",
                        "--strictPort",
                    ],
                    cwd=ROOT / "frontend",
                    env=env,
                    stdout=log,
                    stderr=log,
                )
                processes.append(frontend)
                wait_ready("http://127.0.0.1:5174", frontend)
                subprocess.run(
                    [
                        sys.executable,
                        str(ROOT / "scripts/smoke.py"),
                        "--test-accounts-file",
                        str(account_file),
                        "--base-url",
                        "http://127.0.0.1:5174",
                    ],
                    env=env,
                    cwd=ROOT,
                    check=True,
                )
                if not chapter_only:
                    subprocess.run(
                        ["node", str(ROOT / "scripts/browser-check.cjs")],
                        env=env,
                        cwd=ROOT,
                        check=True,
                    )
                subprocess.run(
                    ["node", str(ROOT / "scripts/chapter-content-browser.cjs")],
                    env=env,
                    cwd=ROOT,
                    check=True,
                )
        finally:
            for process in reversed(processes):
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--chapter-content-only",
        action="store_true",
        help="仅运行第一章审核导入浏览器验收及HTTP冒烟",
    )
    run(parser.parse_args().chapter_content_only)
