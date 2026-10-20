"""V5只新增实验表；保留旧FCFS接口、所有课程和记录。"""

import sqlite3
from pathlib import Path
from datetime import datetime, timezone


def migrate_experiments(path: Path, backup=True):
    with sqlite3.connect(path) as db:
        if db.execute("SELECT 1 FROM schema_versions WHERE version=5").fetchone():
            return
    from .persistence import backup_data

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")
    if backup:
        backup_data(path, path.parent / "backups" / ("before-v5-" + stamp))
    with sqlite3.connect(path) as db:
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("BEGIN IMMEDIATE")
        if db.execute("SELECT 1 FROM schema_versions WHERE version=5").fetchone():
            return
        for sql in [
            "CREATE TABLE experiments(id INTEGER PRIMARY KEY,title TEXT NOT NULL,draft_revision_id INTEGER,published_revision_id INTEGER,edit_version INTEGER NOT NULL DEFAULT 0)",
            "CREATE TABLE experiment_revisions(id INTEGER PRIMARY KEY,experiment_id INTEGER NOT NULL REFERENCES experiments(id),body TEXT NOT NULL,author_id INTEGER REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
            "CREATE TABLE experiment_previews(user_id INTEGER NOT NULL REFERENCES users(id),revision_id INTEGER NOT NULL REFERENCES experiment_revisions(id),PRIMARY KEY(user_id,revision_id))",
            "CREATE TABLE experiment_runs(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),experiment_id INTEGER NOT NULL REFERENCES experiments(id),revision_id INTEGER NOT NULL REFERENCES experiment_revisions(id),engine_version TEXT NOT NULL,input_json TEXT NOT NULL,result_json TEXT NOT NULL,observation TEXT NOT NULL DEFAULT '',completed_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
            "CREATE INDEX experiment_run_owner ON experiment_runs(user_id,id)",
            "CREATE INDEX experiment_revision_parent ON experiment_revisions(experiment_id,id)",
            "INSERT INTO schema_versions VALUES(5)",
        ]:
            db.execute(sql)
