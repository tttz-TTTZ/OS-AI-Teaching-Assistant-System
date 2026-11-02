"""Schema 10: material-based learning, without course directories or a formal question bank.

Existing supported installations are backed up and rebuilt atomically. Unknown tables
are a blocker rather than something to silently erase. No legacy content is seeded.
"""
import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = {'users': 'CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT NOT NULL UNIQUE,password_hash '
          "TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('teacher','student')),active INTEGER "
          'NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, is_admin INTEGER '
          'NOT NULL DEFAULT 0)',
 'sessions': 'CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL '
             'REFERENCES users(id),csrf_token TEXT NOT NULL,expires_at INTEGER NOT NULL)',
 'documents': 'CREATE TABLE "documents"(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT '
              'NULL,content TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT '
              'CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, category TEXT '
              "NOT NULL DEFAULT 'personal', original_name TEXT, stored_name TEXT, file_size "
              'INTEGER, file_type TEXT, '
              'owner_id INTEGER REFERENCES users(id), published INTEGER NOT NULL DEFAULT 0, sha256 '
              "TEXT, summary TEXT NOT NULL DEFAULT '', source_title TEXT NOT NULL DEFAULT '', "
              "source_url TEXT NOT NULL DEFAULT '', deleted_at TEXT, published_at TEXT)",
 'document_versions': 'CREATE TABLE document_versions(id INTEGER PRIMARY KEY,document_id INTEGER '
                      'NOT NULL REFERENCES documents(id),stored_name TEXT NOT NULL,original_name '
                      'TEXT NOT NULL,file_size INTEGER NOT NULL,file_type TEXT NOT NULL,sha256 '
                      'TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
 'conversations': 'CREATE TABLE conversations(id INTEGER PRIMARY KEY AUTOINCREMENT,material_id '
                  'INTEGER,question TEXT NOT NULL,answer TEXT NOT NULL,model TEXT NOT NULL,mode '
                  'TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, user_id '
                  'INTEGER REFERENCES users(id))',
 'account_audit': 'CREATE TABLE account_audit(id INTEGER PRIMARY KEY,actor_id INTEGER REFERENCES '
                  'users(id),target_id INTEGER REFERENCES users(id),action TEXT NOT '
                  'NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
 'document_ai_indexes': 'CREATE TABLE document_ai_indexes(document_id INTEGER PRIMARY KEY '
                        'REFERENCES documents(id),signature TEXT NOT NULL,body_json TEXT NOT NULL)',
 'personal_ai_jobs': 'CREATE TABLE personal_ai_jobs(id INTEGER PRIMARY KEY,user_id INTEGER NOT '
                     'NULL REFERENCES users(id),kind TEXT NOT NULL,parent_id INTEGER REFERENCES '
                     'personal_ai_jobs(id),request_key TEXT NOT NULL,request_hash TEXT NOT '
                     'NULL,config_json TEXT NOT NULL,sources_json TEXT NOT NULL,body_json TEXT NOT '
                     "NULL DEFAULT '{}',model TEXT NOT NULL,status TEXT NOT NULL,error TEXT NOT "
                     "NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',bookmarked INTEGER NOT NULL "
                     'DEFAULT 0,version INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL '
                     'DEFAULT CURRENT_TIMESTAMP,UNIQUE(user_id,request_key))',
 'personal_ai_attempts': 'CREATE TABLE personal_ai_attempts(id INTEGER PRIMARY KEY,user_id INTEGER '
                         'NOT NULL REFERENCES users(id),job_id INTEGER NOT NULL REFERENCES '
                         'personal_ai_jobs(id),request_key TEXT NOT NULL,payload TEXT NOT '
                         'NULL,created_at TEXT NOT NULL DEFAULT '
                         'CURRENT_TIMESTAMP,UNIQUE(user_id,request_key))'}
REMOVED = ['courses', 'chapters',
 'knowledge_points',
 'questions',
 'document_knowledge_points',
 'sections',
 'knowledge_revisions',
 'content_events',
 'knowledge_assets',
 'revision_assets',
 'knowledge_progress',
 'interaction_runs',
 'question_knowledge',
 'study_attempts',
 'learning_feedback',
 'experiments',
 'experiment_revisions',
 'experiment_previews',
 'experiment_runs',
 'ai_question_jobs',
 'ai_question_drafts',
 'ai_lesson_jobs',
 'chapter_content_imports']

def migrate(path: Path) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    exists = path.exists() and path.stat().st_size > 0
    with sqlite3.connect(path) as db:
        tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if 'schema_versions' in tables and db.execute('SELECT 1 FROM schema_versions WHERE version=10').fetchone():
            return
        unknown = tables - set(SCHEMA) - set(REMOVED) - {'schema_versions', 'sqlite_sequence'}
        if unknown:
            raise RuntimeError('迁移遇到未知表，请先核对：' + ', '.join(sorted(unknown)))
        if exists and not {'users', 'documents', 'personal_ai_jobs'} <= tables:
            raise RuntimeError('此清理仅支持 V8/V9 数据库；请先备份并升级原版本')
    if exists:
        from .persistence import backup_data
        backup_data(path, path.parent / 'backups' / ('before-v10-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%f')))
    with sqlite3.connect(path) as db:
        db.execute('PRAGMA foreign_keys=OFF')
        db.execute('BEGIN IMMEDIATE')
        try:
            if 'schema_versions' in tables and db.execute('SELECT 1 FROM schema_versions WHERE version=10').fetchone():
                return
            sequences = dict(db.execute('SELECT name,seq FROM sqlite_sequence')) if 'sqlite_sequence' in tables else {}
            for name, sql in SCHEMA.items():
                temporary = '_v10_' + name
                db.execute(re.sub(r'^CREATE TABLE (?:"[^" ]+"|\w+)', 'CREATE TABLE ' + temporary, sql))
                if name in tables:
                    old = {r[1] for r in db.execute(f'PRAGMA table_info("{name}")')}
                    columns = [r[1] for r in db.execute(f'PRAGMA table_info("{temporary}")') if r[1] in old]
                    names = ','.join('"' + n + '"' for n in columns)
                    db.execute(f'INSERT INTO "{temporary}" ({names}) SELECT {names} FROM "{name}"')
                    if db.execute(f'SELECT COUNT(*) FROM "{temporary}"').fetchone()[0] != db.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]:
                        raise RuntimeError('保留数据行数不一致：' + name)
            for name, in db.execute("SELECT name FROM sqlite_master WHERE type='view'").fetchall():
                if name not in ('materials', 'knowledge'):
                    raise RuntimeError('迁移遇到未知视图：' + name)
                db.execute(f'DROP VIEW "{name}"')
            for name in [*REMOVED, *SCHEMA]:
                db.execute(f'DROP TABLE IF EXISTS "{name}"')
            for name in SCHEMA:
                db.execute(f'ALTER TABLE "_v10_{name}" RENAME TO "{name}"')
            for name, seq in sequences.items():
                if name in SCHEMA:
                    db.execute('UPDATE sqlite_sequence SET seq=max(seq,?) WHERE name=?', (seq, name))
            db.execute('CREATE TABLE IF NOT EXISTS schema_versions(version INTEGER PRIMARY KEY)')
            db.execute('INSERT INTO schema_versions VALUES(10)')
            # Remove retired directory bindings from stored personal request configs.
            for ident, config, body in db.execute('SELECT id,config_json,body_json FROM personal_ai_jobs').fetchall():
                data = json.loads(config)
                for field in ('chapter_id','section_id','knowledge_ids'):
                    data.pop(field, None)
                db.execute('UPDATE personal_ai_jobs SET config_json=? WHERE id=?', (json.dumps(data, ensure_ascii=False), ident))
                content = json.loads(body)
                for question in content.get('questions', []):
                    question.pop('chapter_id', None)
                    question.pop('knowledge_ids', None)
                db.execute('UPDATE personal_ai_jobs SET body_json=? WHERE id=?', (json.dumps(content, ensure_ascii=False), ident))
            db.execute("CREATE UNIQUE INDEX personal_ai_one_running ON personal_ai_jobs(user_id) WHERE status='running'")
            db.execute('CREATE INDEX document_owner ON documents(owner_id,category)')
            db.execute('CREATE INDEX documents_visibility ON documents(category,deleted_at,published)')
            db.execute('CREATE INDEX conversations_owner ON conversations(user_id,id)')
            db.execute('CREATE INDEX sessions_expiry ON sessions(expires_at)')
            if db.execute('PRAGMA foreign_key_check').fetchall():
                raise RuntimeError('清理后外键校验失败，已回滚')
            if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                raise RuntimeError('清理后数据库完整性校验失败，已回滚')
            db.commit()
        except BaseException:
            db.rollback()
            raise
