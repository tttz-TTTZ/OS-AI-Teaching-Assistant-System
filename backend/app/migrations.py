"""非破坏性版本迁移；备份成功后才改现有数据库。"""

import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


def _migrate_v2(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    existed = path.exists() and path.stat().st_size > 0
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    try:
        has_versions = db.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_versions'"
        ).fetchone()
        if (
            has_versions
            and db.execute("SELECT 1 FROM schema_versions WHERE version=2").fetchone()
        ):
            return
        if existed:
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")
            folder = path.parent / "backups" / stamp
            folder.mkdir(parents=True)
            with sqlite3.connect(folder / path.name) as backup:
                db.backup(backup)
            if (path.parent / "uploads").exists():
                shutil.copytree(path.parent / "uploads", folder / "uploads")
        # 沿用 V0.1 初始化，为空环境及更旧的资料表补齐结构。
        db.executescript(
            """
        CREATE TABLE IF NOT EXISTS materials(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,content TEXT NOT NULL,chapter TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS conversations(id INTEGER PRIMARY KEY AUTOINCREMENT,material_id INTEGER,question TEXT NOT NULL,answer TEXT NOT NULL,model TEXT NOT NULL,mode TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        """
        )
        columns = {row["name"] for row in db.execute("PRAGMA table_info(materials)")}
        for name, definition in {
            "category": "TEXT NOT NULL DEFAULT 'personal'",
            "original_name": "TEXT",
            "stored_name": "TEXT",
            "file_size": "INTEGER",
            "file_type": "TEXT",
        }.items():
            if name not in columns:
                db.execute(f"ALTER TABLE materials ADD COLUMN {name} {definition}")
        from .course import initialize

        initialize(db)
        db.commit()
        db.execute("BEGIN IMMEDIATE")
        db.execute("ALTER TABLE materials RENAME TO documents")
        db.execute("ALTER TABLE knowledge RENAME TO knowledge_points")
        statements = [
            "CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('teacher','student')),active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
            "CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),csrf_token TEXT NOT NULL,expires_at INTEGER NOT NULL)",
            "CREATE INDEX sessions_expiry ON sessions(expires_at)",
            "CREATE TABLE courses(id INTEGER PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',published INTEGER NOT NULL DEFAULT 0,is_demo INTEGER NOT NULL DEFAULT 1)",
            "INSERT INTO courses VALUES(1,'操作系统（演示课程）','人工示例内容，请以实际教材为准。',1,1)",
            "ALTER TABLE chapters ADD COLUMN course_id INTEGER REFERENCES courses(id) DEFAULT 1",
            "ALTER TABLE chapters ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE chapters ADD COLUMN published INTEGER NOT NULL DEFAULT 1",
            "UPDATE chapters SET sort_order=id",
            "ALTER TABLE knowledge_points ADD COLUMN published INTEGER NOT NULL DEFAULT 1",
            "ALTER TABLE documents ADD COLUMN course_id INTEGER REFERENCES courses(id) DEFAULT 1",
            "ALTER TABLE documents ADD COLUMN chapter_id INTEGER REFERENCES chapters(id)",
            "ALTER TABLE documents ADD COLUMN owner_id INTEGER REFERENCES users(id)",
            "ALTER TABLE documents ADD COLUMN published INTEGER NOT NULL DEFAULT 0",
            "UPDATE documents SET published=1 WHERE category='public'",
            "UPDATE documents SET chapter_id=(SELECT id FROM chapters WHERE chapters.title=documents.chapter ORDER BY id LIMIT 1)",
            "ALTER TABLE questions ADD COLUMN published INTEGER NOT NULL DEFAULT 1",
            "ALTER TABLE conversations ADD COLUMN user_id INTEGER REFERENCES users(id)",
            "CREATE TABLE document_knowledge_points(document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,knowledge_point_id INTEGER NOT NULL REFERENCES knowledge_points(id) ON DELETE CASCADE,PRIMARY KEY(document_id,knowledge_point_id))",
            "CREATE INDEX document_owner ON documents(owner_id,category)",
            "CREATE INDEX knowledge_chapter ON knowledge_points(chapter_id)",
            "CREATE VIEW materials AS SELECT * FROM documents",
            "CREATE VIEW knowledge AS SELECT * FROM knowledge_points",
            "INSERT INTO schema_versions VALUES(2)",
        ]
        for statement in statements:
            db.execute(statement)
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()


def _migrate_v3(path: Path) -> None:
    # 原有V0.2迁移保持不变。后续按版本顺序追加，不能在version=2前提前返回。
    was_v2 = False
    if path.exists() and path.stat().st_size:
        with sqlite3.connect(path) as db:
            if db.execute(
                "SELECT 1 FROM sqlite_master WHERE name='schema_versions'"
            ).fetchone():
                was_v2 = bool(
                    db.execute(
                        "SELECT 1 FROM schema_versions WHERE version=2"
                    ).fetchone()
                )
                if db.execute(
                    "SELECT 1 FROM schema_versions WHERE version=3"
                ).fetchone():
                    return
    if was_v2:
        from .persistence import backup_data

        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")
        backup_data(path, path.parent / "backups" / ("before-v3-" + stamp))
    _migrate_v2(path)
    with sqlite3.connect(path) as db:
        db.execute("BEGIN IMMEDIATE")
        for statement in [
            "ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE documents ADD COLUMN sha256 TEXT",
            "ALTER TABLE documents ADD COLUMN summary TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE documents ADD COLUMN source_title TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE documents ADD COLUMN source_url TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE documents ADD COLUMN deleted_at TEXT",
            "ALTER TABLE documents ADD COLUMN published_at TEXT",
            "ALTER TABLE chapters ADD COLUMN textbook_number INTEGER",
            "ALTER TABLE chapters ADD COLUMN pdf_start INTEGER",
            "ALTER TABLE chapters ADD COLUMN pdf_end INTEGER",
            "ALTER TABLE chapters ADD COLUMN archived_at TEXT",
            "CREATE TABLE document_versions(id INTEGER PRIMARY KEY,document_id INTEGER NOT NULL REFERENCES documents(id),stored_name TEXT NOT NULL,original_name TEXT NOT NULL,file_size INTEGER NOT NULL,file_type TEXT NOT NULL,sha256 TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
            "CREATE TABLE account_audit(id INTEGER PRIMARY KEY,actor_id INTEGER REFERENCES users(id),target_id INTEGER REFERENCES users(id),action TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
            "CREATE INDEX documents_visibility ON documents(category,deleted_at,published,chapter_id)",
            "CREATE INDEX conversations_owner ON conversations(user_id,id)",
            "INSERT INTO schema_versions VALUES(3)",
        ]:
            db.execute(statement)


def migrate(path: Path) -> None:
    had_v3 = False
    had_v4 = False
    if path.exists():
        with sqlite3.connect(path) as db:
            if db.execute(
                "SELECT 1 FROM sqlite_master WHERE name='schema_versions'"
            ).fetchone():
                had_v3 = bool(
                    db.execute(
                        "SELECT 1 FROM schema_versions WHERE version=3"
                    ).fetchone()
                )
                had_v4 = bool(
                    db.execute(
                        "SELECT 1 FROM schema_versions WHERE version=4"
                    ).fetchone()
                )
    _migrate_v3(path)
    from .digital_migration import migrate_digital

    migrate_digital(path, backup=had_v3)
    from .experiment_migration import migrate_experiments

    migrate_experiments(path, backup=had_v4)
