import copy
import json
import sqlite3
import runpy
from pathlib import Path
from io import BytesIO
from zipfile import ZipFile
import pytest
from fastapi.testclient import TestClient
from app import main, personal_learning as ai
from app.auth import create_user
from app.migrations import migrate
from app.persistence import backup_data, restore_data

TEXT = "操作系统负责管理计算机硬件和软件资源，为用户和应用程序提供服务。进程与线程在资源分配和调度方面存在差异，进程具有独立地址空间，线程共享进程资源。"
BASE = "/api/student/personal"


@pytest.fixture
def clients(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "data" / "test.db")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-only")
    with TestClient(main.app) as t, TestClient(main.app) as a, TestClient(
        main.app
    ) as b:
        for client, name, role in [
            (t, "teacher", "teacher"),
            (a, "alice", "student"),
            (b, "bob", "student"),
        ]:
            create_user(name, "personal-test-password", role)
            login = client.post(
                "/api/auth/login",
                json={"username": name, "password": "personal-test-password"},
            )
            client.headers["X-CSRF-Token"] = login.json()["csrf_token"]
        yield t, a, b


def prepared(a, kind="learning", data=TEXT):
    d = a.post(
        "/api/materials/upload", files={"file": ("我的学习资料.txt", data.encode())}
    )
    assert d.status_code == 201, d.text
    config = {
        "chapter_id": 1,
        "topic": "进程与线程",
        "weakness": "分不清资源共享",
        "sources": [{"document_id": d.json()["id"]}],
        "kind": kind,
        "modes": ["explain", "deep", "map", "code", "animation", "summary"],
        "count": 5,
        "question_kinds": ["single", "multiple", "boolean", "short", "matching"],
        "request_key": "personal-request-000001",
    }
    p = a.post(BASE + "/sources/preview", json=config)
    assert p.status_code == 200, p.text
    return {**config, "fingerprint": p.json()["fingerprint"]}, p.json()


def generated(body, source):
    c = source["chunks"][0]
    cite = {"source_ref": c["ref"], "source_quote": c["text"][:30]}
    if body.kind == "practice":
        return {
            "title": "资源共享自测",
            "questions": [
                {
                    **cite,
                    "kind": "single",
                    "prompt": "线程共享什么？",
                    "options": ["进程资源", "全部独立"],
                    "correct": 0,
                    "explanation": "线程共享进程资源",
                },
                {
                    **cite,
                    "kind": "multiple",
                    "prompt": "操作系统的职责？",
                    "options": ["管理资源", "提供服务", "仅排版"],
                    "correct": [0, 1],
                    "explanation": "依据资料",
                },
                {
                    **cite,
                    "kind": "boolean",
                    "prompt": "线程共享进程资源。",
                    "correct": 0,
                    "explanation": "依据资料",
                },
                {
                    **cite,
                    "kind": "short",
                    "prompt": "解释独立地址空间",
                    "correct": "进程拥有独立地址空间",
                    "explanation": "请对照资料",
                },
                {
                    **cite,
                    "kind": "matching",
                    "prompt": "匹配对象",
                    "items": ["独立地址空间", "共享进程资源"],
                    "options": ["进程", "线程"],
                    "correct": [0, 1],
                    "explanation": "区别资源归属",
                },
            ],
        }
    modules = []
    for mode in body.modes:
        m = {**cite, "mode": mode, "title": mode, "text": "依据课件分析进程与线程。"}
        if mode == "map":
            m["nodes"] = [
                {"id": "root", "label": "进程与线程", "parent": None},
                {"id": "child", "label": "资源共享", "parent": "root"},
            ]
        if mode == "code":
            m.update(code="def example():\n    return 1", language="python")
        if mode == "animation":
            m["simulation"] = {"template": "memory"}
        modules.append(m)
    return {"title": "个人学习进程与线程", "modules": modules}


def fake_model(monkeypatch, calls):
    async def fake(body, source, **kw):
        calls.append(kw)
        return generated(body, source)

    monkeypatch.setattr(ai, "call_deepseek", fake)


def test_all_modes_private_notes_simulation_and_no_course_mutation(
    clients, monkeypatch, tmp_path
):
    t, a, b = clients
    body, p = prepared(a)
    calls = []
    fake_model(monkeypatch, calls)
    before = t.get("/api/teacher/learning-content").json()
    r = a.post(BASE + "/generate", json=body)
    assert r.status_code == 200, r.text
    job = r.json()
    ident = job["id"]
    assert len(job["body"]["modules"]) == 6
    assert job["body"]["modules"][3]["code"] == "def example():\n    return 1"
    assert (
        a.post(BASE + "/generate", json=body).json()["id"] == ident and len(calls) == 1
    )
    assert t.get(BASE + f"/jobs/{ident}").status_code == 403
    assert b.get(BASE + f"/jobs/{ident}").status_code == 404
    assert b.post(BASE + "/sources/preview", json=body).status_code == 404
    assert not b.get(BASE + "/jobs").json()
    assert t.get("/api/teacher/learning-content").json() == before
    note = {"note": "我的个人笔记", "bookmarked": True, "expected_version": 0}
    assert a.put(BASE + f"/jobs/{ident}/note", json=note).status_code == 200
    assert a.get(BASE + f"/jobs/{ident}").json()["note"] == note["note"]
    assert a.put(BASE + f"/jobs/{ident}/note", json=note).status_code == 409
    replay = a.post(
        BASE + f"/jobs/{ident}/simulate",
        json={"module": 4, "config": {"template": "memory"}},
    )
    assert replay.status_code == 200 and len(replay.json()["frames"]) > 1
    assert (
        b.post(
            BASE + f"/jobs/{ident}/simulate",
            json={"module": 4, "config": {"template": "memory"}},
        ).status_code
        == 404
    )
    backup_data(main.DB_PATH, tmp_path / "backup")
    restored = restore_data(tmp_path / "backup", tmp_path / "restored")
    with sqlite3.connect(restored) as db:
        assert (
            db.execute(
                "SELECT note FROM personal_ai_jobs WHERE id=?", (ident,)
            ).fetchone()[0]
            == note["note"]
        )


def test_private_practice_grading_followup_and_formal_separation(clients, monkeypatch):
    t, a, b = clients
    body, p = prepared(a, "practice")
    calls = []
    fake_model(monkeypatch, calls)
    formal = t.get("/api/teacher/study/questions").json()
    job = a.post(BASE + "/generate", json=body).json()
    ident = job["id"]
    assert all(
        "correct" not in q and "explanation" not in q for q in job["body"]["questions"]
    )
    assert t.get("/api/teacher/study/questions").json() == formal
    assert b.get(BASE + f"/jobs/{ident}/attempts").status_code == 404
    submission = {
        "request_key": "personal-submit-000001",
        "answers": {"0": 1, "1": [0, 1], "2": 0, "3": "进程地址空间独立", "4": [0, 1]},
    }
    r = a.post(BASE + f"/jobs/{ident}/submit", json=submission)
    assert r.status_code == 200, r.text
    assert (
        r.json()["score"] == 3 and r.json()["total"] == 4 and r.json()["ungraded"] == 1
    )
    assert a.post(BASE + f"/jobs/{ident}/submit", json=submission).json() == r.json()
    assert len(a.get(BASE + f"/jobs/{ident}/attempts").json()) == 1
    altered = copy.deepcopy(submission)
    altered["answers"]["0"] = 0
    assert a.post(BASE + f"/jobs/{ident}/submit", json=altered).status_code == 409
    assert a.get("/api/study/attempts").json() == []
    follow = {
        **body,
        "kind": "learning",
        "parent_id": ident,
        "modes": ["explain"],
        "request_key": "personal-followup-0001",
    }
    r = a.post(BASE + "/generate", json=follow)
    assert r.status_code == 200, r.text
    assert calls[-1]["payload"]["previous_self_test"]["results"][0]["correct"] is False
    assert calls[-1]["payload"]["previous_learning"]
    forbidden = {**follow, "request_key": "personal-bob-followup"}
    assert b.post(BASE + "/generate", json=forbidden).status_code == 404


def test_ppt_retrieval_later_pages_cache_and_withdrawal(clients):
    t, a, b = clients
    fixture = runpy.run_path(
        str(Path(__file__).resolve().parents[2] / "scripts/presentation_fixture.py")
    )
    raw = fixture["pptx_bytes"](400)
    out = BytesIO()
    with ZipFile(BytesIO(raw)) as old, ZipFile(out, "w") as new:
        for part in old.namelist():
            content = old.read(part)
            if part == "ppt/slides/slide350.xml":
                content = content.replace("演示第350页".encode(), TEXT.encode())
            new.writestr(part, content)
    d = t.post(
        "/api/materials/upload",
        data={"category": "public"},
        files={"file": ("400页课件.pptx", out.getvalue())},
    ).json()
    settings = {"title": "正式公共课件", "chapter_id": 1, "published": True}
    assert t.put(f'/api/teacher/documents/{d["id"]}', json=settings).status_code == 200
    body = {
        "sources": [{"document_id": d["id"]}],
        "topic": "进程与线程",
        "weakness": "资源共享",
    }
    p = a.post(BASE + "/sources/preview", json=body)
    assert p.status_code == 200, p.text
    assert p.json()["indexed_chunks"] == 400 and p.json()["chunks"][0]["page"] == 350
    assert b.post(BASE + "/sources/preview", json=body).status_code == 200
    t.put(f'/api/teacher/documents/{d["id"]}', json={**settings, "published": False})
    assert a.post(BASE + "/sources/preview", json=body).status_code == 404
    with main.database() as db:
        assert db.execute("SELECT COUNT(*) FROM document_ai_indexes").fetchone()[0] == 1


@pytest.mark.parametrize(
    "failure", ["missing_mode", "fake_quote", "map_cycle", "blank_quote"]
)
def test_invalid_model_never_ready(clients, monkeypatch, failure):
    _, a, _ = clients
    body, p = prepared(a)

    async def invalid(b, s, **kw):
        output = generated(b, s)
        if failure == "missing_mode":
            output["modules"].pop()
        elif failure == "fake_quote":
            output["modules"][0]["source_quote"] = "资料不存在的伪造引用依据"
        elif failure == "blank_quote":
            output["modules"][0]["source_quote"] = " " * 10
        else:
            output["modules"][2]["nodes"][0]["parent"] = "child"
        return output

    monkeypatch.setattr(ai, "call_deepseek", invalid)
    r = a.post(BASE + "/generate", json=body)
    assert r.status_code == 502, r.text
    assert a.get(BASE + "/jobs").json()[0]["status"] == "failed"


def test_fingerprint_quota_and_missing_key(clients, monkeypatch):
    _, a, _ = clients
    body, p = prepared(a)
    fake_model(monkeypatch, [])
    assert (
        a.post(BASE + "/generate", json={**body, "weakness": "新的薄弱点"}).status_code
        == 409
    )
    monkeypatch.setenv("PERSONAL_AI_DAILY_LIMIT", "1")
    assert a.post(BASE + "/generate", json=body).status_code == 200
    assert (
        a.post(
            BASE + "/generate", json={**body, "request_key": "personal-another-0001"}
        ).status_code
        == 429
    )
    monkeypatch.setenv("DEEPSEEK_API_KEY", "")
    assert not a.get(BASE + "/status").json()["configured"]
    assert (
        a.post(
            BASE + "/generate", json={**body, "request_key": "personal-another-0002"}
        ).status_code
        == 503
    )


def test_v8_backup_repeat_and_old_data_preservation(clients):
    t, _, _ = clients
    old = t.get("/api/teacher/chapters").json()
    with sqlite3.connect(main.DB_PATH) as db:
        for table in (
            "personal_ai_attempts",
            "personal_ai_jobs",
            "document_ai_indexes",
        ):
            db.execute("DROP TABLE " + table)
        db.execute("DELETE FROM schema_versions WHERE version=8")
    migrate(main.DB_PATH)
    migrate(main.DB_PATH)
    assert len(list((main.DB_PATH.parent / "backups").glob("before-v8-*"))) == 1
    assert t.get("/api/teacher/chapters").json() == old


def test_no_matching_evidence_does_not_generate_blindly(clients):
    _, a, _ = clients
    body, _ = prepared(a)
    response = a.post(
        BASE + "/sources/preview", json={**body, "topic": "ZEBRAXYZ", "weakness": ""}
    )
    assert response.status_code == 422
    assert a.get(BASE + "/jobs").json() == []


def test_pptx_code_keeps_tabs_soft_breaks_and_indentation():
    from app.presentations import slide_text

    out = BytesIO()
    with ZipFile(out, "w") as archive:
        archive.writestr(
            "code.xml",
            '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:r><a:t>def demo():</a:t></a:r><a:br/><a:tab/><a:r><a:t xml:space="preserve">    return 1</a:t></a:r></a:p></p:sld>',
        )
    with ZipFile(BytesIO(out.getvalue())) as archive:
        result = slide_text(archive, "code.xml", 1)
    assert result["text"] == "def demo():\n\t    return 1"


def test_flashcards_generate_persist_and_reject_invalid_deck(clients, monkeypatch):
    _, a, b = clients
    body, _ = prepared(a)
    body["modes"] = ["flashcards"]

    async def fake(request, source, **kw):
        output = generated(request, source)
        output["modules"][0]["cards"] = [
            {"front": f"概念{i}", "back": "操作系统管理资源并提供服务。"}
            for i in range(3)
        ]
        return output

    monkeypatch.setattr(ai, "call_deepseek", fake)
    response = a.post(BASE + "/generate", json=body)
    assert response.status_code == 200, response.text
    ident = response.json()["id"]
    assert (
        len(a.get(BASE + f"/jobs/{ident}").json()["body"]["modules"][0]["cards"]) == 3
    )
    assert b.get(BASE + f"/jobs/{ident}").status_code == 404
    with pytest.raises(ValueError):
        ai.Flashcard(front=" ", back="答案")
    with pytest.raises(ValueError):
        ai.Module(
            mode="flashcards",
            title="无效闪卡",
            text="说明",
            source_ref="x",
            source_quote="操作系统管理资源并提供服务",
            cards=[],
        )


def test_xmind_export_saved_tree_and_access_control(clients, monkeypatch):
    t, a, b = clients
    config, _ = prepared(a)
    calls = []
    fake_model(monkeypatch, calls)
    job = a.post(BASE + "/generate", json=config).json()
    path = BASE + f'/jobs/{job["id"]}/modules/2/mindmap.xmind'
    response = a.get(path)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["content-disposition"].endswith('.xmind"')
    with ZipFile(BytesIO(response.content)) as archive:
        assert set(archive.namelist()) == {
            "content.json",
            "metadata.json",
            "manifest.json",
        }
        sheet = json.loads(archive.read("content.json"))[0]
        root = sheet["rootTopic"]
        assert root["title"] == "进程与线程"
        assert root["children"]["attached"][0]["title"] == "资源共享"
        assert root["children"]["attached"][0]["id"] == "child"
    assert "XMind" in calls[0]["system_prompt"]
    assert b.get(path).status_code == 404
    assert t.get(path).status_code == 403
    assert a.get(path.replace("modules/2", "modules/0")).status_code == 422
    assert a.get(path.replace("modules/2", "modules/-1")).status_code == 404
    assert a.get(path.replace("modules/2", "modules/999")).status_code == 404
    assert TestClient(main.app).get(path).status_code == 401


@pytest.mark.parametrize("bad_parent", ["", "missing", "child"])
def test_map_rejects_disconnected_or_cyclic_nodes(bad_parent):
    module = generated(
        type("Task", (), {"kind": "learning", "modes": ["map"]})(),
        {"chunks": [{"ref": "r", "text": TEXT}]},
    )["modules"][0]
    module["nodes"][1]["parent"] = bad_parent
    with pytest.raises(ValueError):
        ai.Module.model_validate(module)


@pytest.mark.parametrize(
    "mode,style",
    [("explain", "json"), ("flashcards", "fenced"), ("practice", "blocks")],
)
def test_student_features_through_real_http_adapter(clients, monkeypatch, mode, style):
    import httpx
    from app import ai_questions

    t, a, b = clients
    config, _ = prepared(a, kind="practice" if mode == "practice" else "learning")
    config["modes"] = ["explain" if mode == "practice" else mode]
    config["topic"] = "第一份课件"
    config["source_overview"] = True
    preview = a.post(BASE + "/sources/preview", json=config)
    assert preview.status_code == 200, preview.text
    assert "资料概览" in "".join(preview.json()["warnings"])
    config["fingerprint"] = preview.json()["fingerprint"]
    original = httpx.AsyncClient

    def handler(request):
        payload = json.loads(request.content)
        user = json.loads(payload["messages"][1]["content"])
        assert user["source_overview"] is True
        output = generated(
            ai.Generation.model_validate(config), {"chunks": user["sources"]}
        )
        if mode == "flashcards":
            assert "front/back" in payload["messages"][0]["content"]
            output["modules"][0]["cards"] = [
                {"front": f"回忆问题{i}", "back": "操作系统管理资源并提供服务"}
                for i in range(3)
            ]
        text = json.dumps(output, ensure_ascii=False)
        content = (
            text
            if style == "json"
            else (
                "```json\n" + text + "\n```"
                if style == "fenced"
                else [{"type": "text", "text": text}]
            )
        )
        return httpx.Response(
            200,
            json={
                "choices": [{"finish_reason": "stop", "message": {"content": content}}]
            },
        )

    monkeypatch.setattr(
        ai_questions.httpx,
        "AsyncClient",
        lambda **kw: original(transport=httpx.MockTransport(handler), **kw),
    )
    response = a.post(BASE + "/generate", json=config)
    assert response.status_code == 200, response.text
    job = response.json()
    assert job["status"] == "ready"
    assert a.get(BASE + f'/jobs/{job["id"]}').json()["status"] == "ready"
    assert b.get(BASE + f'/jobs/{job["id"]}').status_code == 404
    if mode == "practice":
        assert "correct" not in job["body"]["questions"][0]
        result = a.post(
            BASE + f'/jobs/{job["id"]}/submit',
            json={
                "answers": {0: 0, 1: [0, 1], 2: 0, 3: "进程有独立地址空间", 4: [0, 1]},
                "request_key": "http-adapter-quiz-0001",
            },
        )
        assert result.status_code == 200, result.text
        assert result.json()["score"] == 4
    elif mode == "flashcards":
        assert len(job["body"]["modules"][0]["cards"]) == 3
    else:
        assert job["body"]["modules"][0]["text"]
