"""从 backend 目录执行：python init_db.py；重复执行不会覆盖已有课程数据。"""

import asyncio
from app.main import app, lifespan


async def initialize() -> None:
    async with lifespan(app):
        print("数据库初始化完成（保留已有数据）")


if __name__ == "__main__":
    asyncio.run(initialize())
