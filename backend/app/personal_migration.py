"""V8仅新增个人学习/练习与授权课件索引；历史课程内容不删除。"""

import sqlite3
from datetime import datetime, timezone


def migrate_personal(path, backup=True):
    with sqlite3.connect(path) as db:
        if db.execute("SELECT 1 FROM schema_versions WHERE version=8").fetchone():
            return
    if backup:
        from .persistence import backup_data

        backup_data(
            path,
            path.parent
            / "backups"
            / ("before-v8-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")),
        )
    with sqlite3.connect(path) as db:
        db.execute("BEGIN IMMEDIATE")
        if db.execute("SELECT 1 FROM schema_versions WHERE version=8").fetchone():
            return
        db.execute(
            "CREATE TABLE document_ai_indexes(document_id INTEGER PRIMARY KEY REFERENCES documents(id),signature TEXT NOT NULL,body_json TEXT NOT NULL)"
        )
        db.execute(
            "CREATE TABLE personal_ai_jobs(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),chapter_id INTEGER NOT NULL REFERENCES chapters(id),kind TEXT NOT NULL,parent_id INTEGER REFERENCES personal_ai_jobs(id),request_key TEXT NOT NULL,request_hash TEXT NOT NULL,config_json TEXT NOT NULL,sources_json TEXT NOT NULL,body_json TEXT NOT NULL DEFAULT '{}',model TEXT NOT NULL,status TEXT NOT NULL,error TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',bookmarked INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(user_id,request_key))"
        )
        db.execute(
            "CREATE UNIQUE INDEX personal_ai_one_running ON personal_ai_jobs(user_id) WHERE status='running'"
        )
        db.execute(
            "CREATE TABLE personal_ai_attempts(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),job_id INTEGER NOT NULL REFERENCES personal_ai_jobs(id),request_key TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(user_id,request_key))"
        )
        db.execute("INSERT INTO schema_versions VALUES(8)")
