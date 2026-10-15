"""离线备份/校验/恢复；恢复只允许新目录。备份包含账号与私人资料，请安全存放。"""

import argparse
from pathlib import Path
from app.main import DB_PATH
from app.persistence import backup_data, validate_backup, restore_data

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("backup").add_argument("--output", type=Path, required=True)
    sub.add_parser("verify").add_argument("--backup", type=Path, required=True)
    restore = sub.add_parser("restore")
    restore.add_argument("--backup", type=Path, required=True)
    restore.add_argument("--into", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.action == "backup":
            print("备份及校验完成：", backup_data(DB_PATH, args.output))
        elif args.action == "verify":
            validate_backup(args.backup)
            print("备份哈希、数据库及文件引用校验通过")
        else:
            print("恢复到新目录完成：", restore_data(args.backup, args.into))
            print(
                "登录会话已作废。停止原服务，设置DATABASE_PATH为该路径，再启动；原数据未覆盖。"
            )
    except (ValueError, OSError) as exc:
        parser.error(str(exc))
