"""数字教材增量迁移；保留旧知识点/题目/资料及ID，升级前成套备份。"""

import sqlite3
from pathlib import Path
from datetime import datetime, timezone


def migrate_digital(path: Path, backup=True):
    with sqlite3.connect(path) as db:
        if db.execute("SELECT 1 FROM schema_versions WHERE version=4").fetchone():
            return
    from .persistence import backup_data

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")
    if backup:
        backup_data(path, path.parent / "backups" / ("before-v4-" + stamp))
    with sqlite3.connect(path) as db:
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("BEGIN IMMEDIATE")
        # 第二个启动进程可能已在锁等待期间迁移完毕。
        if db.execute("SELECT 1 FROM schema_versions WHERE version=4").fetchone():
            return
        for sql in [
            "CREATE TABLE sections(id INTEGER PRIMARY KEY,chapter_id INTEGER NOT NULL REFERENCES chapters(id),code TEXT NOT NULL DEFAULT '',title TEXT NOT NULL,sort_order INTEGER NOT NULL DEFAULT 0,published INTEGER NOT NULL DEFAULT 0)",
            "ALTER TABLE knowledge_points ADD COLUMN digital_managed INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE knowledge_points ADD COLUMN draft_revision_id INTEGER",
            "ALTER TABLE knowledge_points ADD COLUMN published_revision_id INTEGER",
            "ALTER TABLE knowledge_points ADD COLUMN edit_version INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE knowledge_points ADD COLUMN archived_at TEXT",
            "CREATE TABLE knowledge_revisions(id INTEGER PRIMARY KEY,point_id INTEGER NOT NULL REFERENCES knowledge_points(id),body TEXT NOT NULL,author_id INTEGER REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
            "CREATE INDEX knowledge_revisions_point ON knowledge_revisions(point_id,id)",
            "CREATE TABLE content_events(id INTEGER PRIMARY KEY,point_id INTEGER NOT NULL REFERENCES knowledge_points(id),actor_id INTEGER NOT NULL REFERENCES users(id),action TEXT NOT NULL,revision_id INTEGER,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
            "CREATE TABLE knowledge_assets(id INTEGER PRIMARY KEY,stored_name TEXT NOT NULL UNIQUE,original_name TEXT NOT NULL,mime TEXT NOT NULL,file_size INTEGER NOT NULL,sha256 TEXT NOT NULL,uploader_id INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
            "CREATE TABLE revision_assets(revision_id INTEGER NOT NULL REFERENCES knowledge_revisions(id),asset_id INTEGER NOT NULL REFERENCES knowledge_assets(id),PRIMARY KEY(revision_id,asset_id))",
            "CREATE TABLE knowledge_progress(user_id INTEGER NOT NULL REFERENCES users(id),point_id INTEGER NOT NULL REFERENCES knowledge_points(id),revision_id INTEGER NOT NULL DEFAULT 0,read_done INTEGER NOT NULL DEFAULT 0,self_assessed INTEGER NOT NULL DEFAULT 0,position TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',bookmarked INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(user_id,point_id,revision_id))",
            "CREATE TABLE interaction_runs(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),point_id INTEGER NOT NULL REFERENCES knowledge_points(id),revision_id INTEGER NOT NULL,block_id TEXT NOT NULL,engine_version INTEGER NOT NULL DEFAULT 1,trace TEXT NOT NULL,completed INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
            "ALTER TABLE questions ADD COLUMN kind TEXT NOT NULL DEFAULT 'single'",
            "ALTER TABLE questions ADD COLUMN answer_data TEXT",
            "ALTER TABLE questions ADD COLUMN items TEXT NOT NULL DEFAULT '[]'",
            "ALTER TABLE questions ADD COLUMN version INTEGER NOT NULL DEFAULT 1",
            "CREATE TABLE question_knowledge(question_id INTEGER NOT NULL REFERENCES questions(id),point_id INTEGER NOT NULL REFERENCES knowledge_points(id),PRIMARY KEY(question_id,point_id))",
            "CREATE TABLE study_attempts(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),point_id INTEGER REFERENCES knowledge_points(id),revision_id INTEGER NOT NULL DEFAULT 0,request_key TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(user_id,request_key))",
            "CREATE TABLE learning_feedback(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),point_id INTEGER NOT NULL REFERENCES knowledge_points(id),revision_id INTEGER NOT NULL,message TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
            "INSERT INTO schema_versions VALUES(4)",
        ]:
            db.execute(sql)
