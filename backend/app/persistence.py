"""数据库与受控文件的成套快照；恢复到新目录，绝不覆盖运行中的数据。"""

import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
from datetime import datetime, timezone
from filelock import FileLock


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def storage_lock(db_path: Path) -> FileLock:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return FileLock(str(db_path.parent / ".storage.lock"), timeout=60)


def checked_file(root: Path, name: str) -> Path:
    path = (root / name).resolve()
    if (
        path.parent != root.resolve()
        or not path.is_file()
        or (root / name).is_symlink()
    ):
        raise ValueError("受控文件缺失或路径不安全")
    return path


def validate_backup(folder: Path) -> dict:
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("format") != 1 or not manifest.get("database"):
        raise ValueError("不支持的备份格式")
    for name, meta in manifest["files"].items():
        path = (folder / name).resolve()
        if (
            not path.is_relative_to(folder.resolve())
            or not path.is_file()
            or path.is_symlink()
        ):
            raise ValueError("备份文件缺失或路径非法")
        if path.stat().st_size != meta["size"] or digest(path) != meta["sha256"]:
            raise ValueError(f"备份校验失败：{name}")
    database = (folder / manifest["database"]).resolve()
    if (
        manifest["database"] not in manifest["files"]
        or database.parent != folder.resolve()
    ):
        raise ValueError("数据库备份路径无效")
    with sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True) as db:
        if db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise ValueError("数据库完整性检查失败")
        tables = {
            r[0]
            for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        for table, column in [
            ("documents", "stored_name"),
            ("document_versions", "stored_name"),
        ]:
            if table in tables:
                for row in db.execute(
                    f"SELECT {column} FROM {table} WHERE {column} IS NOT NULL"
                ):
                    if "uploads/" + row[0] not in manifest["files"]:
                        raise ValueError("备份缺少数据库引用的文件")
    return manifest


def backup_data(db_path: Path, destination: Path) -> Path:
    destination = destination.resolve()
    if destination.exists() or destination.is_relative_to(
        (db_path.parent / "uploads").resolve()
    ):
        raise ValueError("备份必须使用新的独立目录，不能位于uploads中")
    with storage_lock(db_path):
        destination.mkdir(parents=True, exist_ok=False)
        try:
            if not db_path.is_file():
                raise ValueError("数据库不存在")
            with sqlite3.connect(db_path) as source, sqlite3.connect(
                destination / "assistant.db"
            ) as target:
                source.backup(target)
            files = {}
            uploads = db_path.parent / "uploads"
            (destination / "uploads").mkdir()
            if uploads.exists():
                for original in uploads.iterdir():
                    checked_file(uploads, original.name)
                    shutil.copyfile(original, destination / "uploads" / original.name)
            for path in [
                destination / "assistant.db",
                *(destination / "uploads").iterdir(),
            ]:
                files[path.relative_to(destination).as_posix()] = {
                    "size": path.stat().st_size,
                    "sha256": digest(path),
                }
            manifest = {
                "format": 1,
                "database": "assistant.db",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "files": files,
            }
            (destination / "manifest.json").write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            validate_backup(destination)
        except BaseException:
            shutil.rmtree(destination)
            raise
    return destination


def restore_data(source: Path, destination: Path) -> Path:
    manifest = validate_backup(source)
    if destination.exists():
        raise ValueError("恢复目标必须是不存在的新目录；禁止覆盖当前数据库")
    destination.mkdir(parents=True, exist_ok=False)
    try:
        for name in manifest["files"]:
            target = destination / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source / name, target)
        with sqlite3.connect(destination / manifest["database"]) as db:
            if db.execute(
                "SELECT 1 FROM sqlite_master WHERE name='sessions'"
            ).fetchone():
                db.execute("DELETE FROM sessions")
    except BaseException:
        shutil.rmtree(destination)
        raise
    return destination / manifest["database"]
