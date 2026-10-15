"""本地管理员命令，不创建硬编码默认凭据。"""

import argparse
import getpass
import sqlite3
from app.main import DB_PATH
from app.migrations import migrate
from app.auth import create_user

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="本地创建教师或学生账号；密码交互输入，不出现在命令行"
    )
    parser.add_argument("--username", required=True)
    parser.add_argument("--role", required=True, choices=["teacher", "student"])
    args = parser.parse_args()
    first = getpass.getpass("密码（12–128 字）：")
    if first != getpass.getpass("再次输入密码："):
        parser.error("两次密码不一致")
    migrate(DB_PATH)
    try:
        create_user(args.username, first, args.role)
    except (ValueError, sqlite3.IntegrityError) as exc:
        parser.error("用户名已存在或参数无效；密码至少 12 字")
    print("账号创建成功；重复执行不会覆盖已有用户")
