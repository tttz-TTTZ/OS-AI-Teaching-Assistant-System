"""Exercise a real old schema, backup, retained records and failure rollback."""
import json
import sqlite3
from pathlib import Path
import pytest
from app.migrations import migrate, SCHEMA, REMOVED
from app.persistence import validate_backup


def legacy(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    schema = Path(__file__).with_name('fixtures').joinpath('v9_schema.sql').read_text()
    with sqlite3.connect(path) as db:
        db.executescript(schema)
        db.execute('INSERT INTO schema_versions VALUES(9)')
        db.execute("INSERT INTO users(id,username,password_hash,role) VALUES(7,'student','saved-hash','student')")
        db.execute("INSERT INTO courses VALUES(1,'课程','说明',1,0)")
        db.execute("INSERT INTO chapters(id,title,description) VALUES(3,'旧目录','旧目录内容')")
        db.execute("INSERT INTO knowledge_points(id,chapter_id,title,content) VALUES(4,3,'旧知识点','正文')")
        db.execute("INSERT INTO questions(id,chapter_id,prompt,options,answer,explanation) VALUES(5,3,'旧题','[]',0,'解析')")
        db.execute("INSERT INTO documents(id,title,content,chapter,chapter_id,owner_id,stored_name) VALUES(42,'保留资料','资料正文','旧目录',3,7,'source.txt')")
        db.execute("INSERT INTO personal_ai_jobs(id,user_id,chapter_id,kind,request_key,request_hash,config_json,sources_json,body_json,model,status,note) VALUES(6,7,3,'learning','saved-request-key','hash',?, '{}',?, 'mock','ready','保留笔记')", (json.dumps({'chapter_id':3,'section_id':1,'topic':'保留主题'}), json.dumps({'answer':'保留回答','questions':[{'prompt':'个人自测','chapter_id':3}]})))
        db.execute("INSERT INTO personal_ai_attempts(id,user_id,job_id,request_key,payload) VALUES(8,7,6,'saved-attempt-key','{}')")
    uploads=path.parent/'uploads'
    uploads.mkdir()
    (uploads/'source.txt').write_text('资料原件')


def test_upgrade_preserves_records_and_removes_schema(tmp_path):
    path=tmp_path/'live'/'assistant.db'
    legacy(path)
    migrate(path)
    with sqlite3.connect(path) as db:
        tables={r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert set(SCHEMA) <= tables
        assert not tables.intersection(REMOVED)
        assert not db.execute("SELECT 1 FROM sqlite_master WHERE type='view'").fetchone()
        for table in ['documents','personal_ai_jobs']:
            assert 'chapter_id' not in {r[1] for r in db.execute(f'PRAGMA table_info({table})')}
        assert db.execute('SELECT title,content,stored_name FROM documents WHERE id=42').fetchone()==('保留资料','资料正文','source.txt')
        assert db.execute('SELECT password_hash FROM users WHERE id=7').fetchone()[0]=='saved-hash'
        config,body,note=db.execute('SELECT config_json,body_json,note FROM personal_ai_jobs WHERE id=6').fetchone()
        assert json.loads(config)=={'topic':'保留主题'}
        assert json.loads(body)=={'answer':'保留回答','questions':[{'prompt':'个人自测'}]} and note=='保留笔记'
        assert db.execute('SELECT COUNT(*) FROM personal_ai_attempts').fetchone()[0]==1
        assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
        assert db.execute('PRAGMA quick_check').fetchone()[0]=='ok'
    snapshots=list((path.parent/'backups').iterdir())
    assert len(snapshots)==1
    validate_backup(snapshots[0])
    with sqlite3.connect(snapshots[0]/'assistant.db') as db:
        assert db.execute('SELECT COUNT(*) FROM knowledge_points').fetchone()[0]==1
    assert (snapshots[0]/'uploads/source.txt').read_text()=='资料原件'
    migrate(path)
    assert len(list((path.parent/'backups').iterdir()))==1


def test_failure_rolls_back_and_keeps_backup(tmp_path):
    path=tmp_path/'live'/'assistant.db'
    legacy(path)
    with sqlite3.connect(path) as db:
        db.execute("UPDATE personal_ai_jobs SET config_json='invalid-json'")
    with pytest.raises(json.JSONDecodeError):migrate(path)
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT COUNT(*) FROM knowledge_points').fetchone()[0]==1
        assert db.execute('SELECT chapter_id FROM personal_ai_jobs').fetchone()[0]==3
        assert not db.execute('SELECT 1 FROM schema_versions WHERE version=10').fetchone()
        assert not db.execute("SELECT 1 FROM sqlite_master WHERE name LIKE '_v10_%'").fetchone()


def test_backup_failure_blocks_cleanup(tmp_path,monkeypatch):
    from app import persistence
    path=tmp_path/'live'/'assistant.db'
    legacy(path)
    def fail(*args):raise OSError('backup unavailable')
    monkeypatch.setattr(persistence,'backup_data',fail)
    with pytest.raises(OSError):migrate(path)
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT COUNT(*) FROM questions').fetchone()[0]==1


def test_fresh_schema_and_unknown_tables(tmp_path):
    path=tmp_path/'fresh.db'
    migrate(path)
    with sqlite3.connect(path) as db:
        assert not {r[0] for r in db.execute('SELECT name FROM sqlite_master')}.intersection(REMOVED)
    other=tmp_path/'unknown.db'
    with sqlite3.connect(other) as db:
        db.execute('CREATE TABLE custom_data(value TEXT)')
        db.execute("INSERT INTO custom_data VALUES('keep')")
    with pytest.raises(RuntimeError,match='未知表'):migrate(other)
    with sqlite3.connect(other) as db:
        assert db.execute('SELECT value FROM custom_data').fetchone()[0]=='keep'


def test_removed_routes_are_not_registered():
    from app.main import app
    paths={route.path for route in app.routes}
    for path in ['/api/chapters','/api/sections','/api/knowledge','/api/courses',
                 '/api/teacher/chapters','/api/teacher/knowledge','/api/teacher/study/questions',
                 '/api/teacher/ai-questions/generate','/api/study/attempts','/api/experiments']:
        assert path not in paths
