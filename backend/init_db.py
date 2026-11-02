"""从 backend 目录执行：python init_db.py；按当前结构初始化或迁移；旧版首次升级会先备份再清理已删除模块。"""

import asyncio
from app.main import app, lifespan


async def initialize() -> None:
    async with lifespan(app):
        print("数据库初始化或迁移完成；迁移范围见 docs/DATABASE-CLEANUP.md")


if __name__ == "__main__":
    asyncio.run(initialize())
