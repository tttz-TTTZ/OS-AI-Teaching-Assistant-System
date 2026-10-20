"""V7增量保存教师AI备课候选，不改变既有章/节或知识点。"""

import sqlite3
from datetime import datetime, timezone


def migrate_ai_lessons(path, backup=True):
    with sqlite3.connect(path) as db:
        if db.execute("SELECT 1 FROM schema_versions WHERE version=7").fetchone():
            return
    if backup:
        from .persistence import backup_data

        backup_data(
            path,
            path.parent
            / "backups"
            / ("before-v7-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")),
        )
    with sqlite3.connect(path) as db:
        db.execute("BEGIN IMMEDIATE")
        if db.execute("SELECT 1 FROM schema_versions WHERE version=7").fetchone():
            return
        db.execute(
            "CREATE TABLE ai_lesson_jobs(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),request_key TEXT NOT NULL,request_hash TEXT NOT NULL,config_json TEXT NOT NULL,sources_json TEXT NOT NULL,model TEXT NOT NULL,status TEXT NOT NULL,error TEXT NOT NULL DEFAULT '',body_json TEXT NOT NULL DEFAULT '{}',version INTEGER NOT NULL DEFAULT 0,imported_json TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(user_id,request_key))"
        )
        db.execute(
            "CREATE UNIQUE INDEX ai_lesson_one_running ON ai_lesson_jobs(user_id) WHERE status='running'"
        )
        db.execute("INSERT INTO schema_versions VALUES(7)")
