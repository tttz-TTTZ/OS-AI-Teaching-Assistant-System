"""V6追加AI出题任务和候选题，现有题目不改动。"""

import sqlite3
from datetime import datetime, timezone
from pathlib import Path


def migrate_ai_questions(path: Path, backup=True):
    with sqlite3.connect(path) as db:
        if db.execute("SELECT 1 FROM schema_versions WHERE version=6").fetchone():
            return
    if backup:
        from .persistence import backup_data

        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")
        backup_data(path, path.parent / "backups" / ("before-v6-" + stamp))
    with sqlite3.connect(path) as db:
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("BEGIN IMMEDIATE")
        if db.execute("SELECT 1 FROM schema_versions WHERE version=6").fetchone():
            return
        for sql in [
            "CREATE TABLE ai_question_jobs(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),request_key TEXT NOT NULL,request_hash TEXT NOT NULL,config_json TEXT NOT NULL,sources_json TEXT NOT NULL,model TEXT NOT NULL,status TEXT NOT NULL,error TEXT NOT NULL DEFAULT '',warnings_json TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(user_id,request_key))",
            "CREATE UNIQUE INDEX ai_question_one_running ON ai_question_jobs(user_id) WHERE status='running'",
            "CREATE TABLE ai_question_drafts(id INTEGER PRIMARY KEY,job_id INTEGER NOT NULL REFERENCES ai_question_jobs(id),body_json TEXT NOT NULL,source_ref TEXT NOT NULL,source_quote TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',version INTEGER NOT NULL DEFAULT 0,question_id INTEGER REFERENCES questions(id))",
            "CREATE INDEX ai_question_owner ON ai_question_jobs(user_id,id)",
            "INSERT INTO schema_versions VALUES(6)",
        ]:
            db.execute(sql)
