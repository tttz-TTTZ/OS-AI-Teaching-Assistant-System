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
    parser.add_argument(
        "--admin",
        action="store_true",
        help="显式授权教师为账号管理员；仅本地管理员执行",
    )
    parser.add_argument(
        "--grant-existing",
        action="store_true",
        help="仅将已有教师提升为管理员，不改密码",
    )
    args = parser.parse_args()
    if args.admin and args.role != "teacher":
        parser.error("管理员必须是教师角色")
    if args.grant_existing:
        if not args.admin or args.role != "teacher":
            parser.error("需 --admin --role teacher")
        migrate(DB_PATH)
        with sqlite3.connect(DB_PATH) as db:
            cur = db.execute(
                "UPDATE users SET is_admin=1 WHERE username=? AND role='teacher'",
                (args.username,),
            )
            if cur.rowcount != 1:
                parser.error("没有找到该教师账号")
            db.execute(
                "DELETE FROM sessions WHERE user_id=(SELECT id FROM users WHERE username=?)",
                (args.username,),
            )
        print("已有教师已授权为管理员，请重新登录")
        raise SystemExit(0)
    first = getpass.getpass("密码（12–128 字）：")
    if first != getpass.getpass("再次输入密码："):
        parser.error("两次密码不一致")
    migrate(DB_PATH)
    try:
        new_id = create_user(args.username, first, args.role)
        if args.admin:
            with sqlite3.connect(DB_PATH) as db:
                db.execute("UPDATE users SET is_admin=1 WHERE id=?", (new_id,))
    except (ValueError, sqlite3.IntegrityError) as exc:
        parser.error("用户名已存在或参数无效；密码至少 12 字")
    print("账号创建成功；重复执行不会覆盖已有用户")
