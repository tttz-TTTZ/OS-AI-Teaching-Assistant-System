"""V9：记录一次性课程内容包导入；不替换现有课程、修订和用户记录。"""

import sqlite3
from datetime import datetime, timezone


def migrate_chapter_content(path, backup=True):
    with sqlite3.connect(path) as db:
        if db.execute("SELECT 1 FROM schema_versions WHERE version=9").fetchone():
            return
    if backup:
        from .persistence import backup_data

        backup_data(
            path,
            path.parent
            / "backups"
            / ("before-v9-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")),
        )
    with sqlite3.connect(path) as db:
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("BEGIN IMMEDIATE")
        if db.execute("SELECT 1 FROM schema_versions WHERE version=9").fetchone():
            return
        db.execute(
            "CREATE TABLE chapter_content_imports(id INTEGER PRIMARY KEY,course_id INTEGER NOT NULL REFERENCES courses(id),chapter_id INTEGER NOT NULL REFERENCES chapters(id),package_id TEXT NOT NULL,package_hash TEXT NOT NULL,actor_id INTEGER NOT NULL REFERENCES users(id),result_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(course_id,package_id))"
        )
        db.execute("INSERT INTO schema_versions VALUES(9)")
