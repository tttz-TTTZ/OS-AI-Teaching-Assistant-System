import json
import runpy
from pathlib import Path
import pytest
import httpx
from fastapi.testclient import TestClient
from app import main, ai_questions
from app.auth import create_user
from app.persistence import backup_data, restore_data

TEXT = "操作系统负责管理计算机硬件和软件资源，为用户和应用程序提供服务。进程调度需要根据算法选择就绪进程。"


@pytest.fixture
def clients(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "data" / "test.db")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-only-key")
    with TestClient(main.app) as t, TestClient(main.app) as s, TestClient(
        main.app
    ) as other:
        for c, name, role in [
            (t, "teacher", "teacher"),
            (s, "student", "student"),
            (other, "other", "teacher"),
        ]:
            create_user(name, "ai-test-password", role)
            login = c.post(
                "/api/auth/login",
                json={"username": name, "password": "ai-test-password"},
            )
            c.headers["X-CSRF-Token"] = login.json()["csrf_token"]
        yield t, s, other


def source(t):
    r = t.post("/api/materials/upload", files={"file": ("出题专用.txt", TEXT.encode())})
    assert r.status_code == 201, r.text
    sel = {"sources": [{"document_id": r.json()["id"], "start_page": 1, "end_page": 1}]}
    preview = t.post("/api/teacher/ai-questions/sources/preview", json=sel)
    assert preview.status_code == 200, preview.text
    return sel, preview.json()


def generate(t, sel, preview, key="test-request-00000001"):
    return t.post(
        "/api/teacher/ai-questions/generate",
        json={
            **sel,
            "chapter_id": 1,
            "knowledge_ids": [1],
            "kinds": ["single"],
            "count": 1,
            "fingerprint": preview["fingerprint"],
            "request_key": key,
        },
    )


def candidate(preview):
    return {
        "questions": [
            {
                "kind": "single",
                "prompt": "操作系统的主要职责是什么？",
                "options": ["资源管理与服务", "只负责文字排版"],
                "correct": 0,
                "explanation": "依据教师资料",
                "source_ref": preview["chunks"][0]["ref"],
                "source_quote": TEXT[:24],
            }
        ]
    }


def test_generation_review_import_and_privacy(clients, monkeypatch, tmp_path):
    t, s, other = clients
    sel, preview = source(t)
    calls = []

    async def fake(body, data):
        calls.append(data)
        return candidate(data)

    monkeypatch.setattr(ai_questions, "call_deepseek", fake)
    assert (
        s.post("/api/teacher/ai-questions/sources/preview", json=sel).status_code == 403
    )
    assert (
        other.post("/api/teacher/ai-questions/sources/preview", json=sel).status_code
        == 404
    )
    r = generate(t, sel, preview)
    assert r.status_code == 200, r.text
    job = r.json()
    draft = job["drafts"][0]
    ident = draft["id"]
    url = f"/api/teacher/ai-questions/drafts/{ident}"
    assert not draft["question"]["published"]
    assert not any(
        q["prompt"] == draft["question"]["prompt"]
        for q in s.get("/api/study/questions?chapter_id=1").json()
    )
    again = generate(t, sel, preview)
    assert again.json()["id"] == job["id"] and len(calls) == 1
    assert other.get(url).status_code == 404
    assert other.get(f'/api/teacher/ai-questions/jobs/{job["id"]}').status_code == 404
    assert s.get(url).status_code == 403
    q = draft["question"]
    q["prompt"] = "教师修订：操作系统的主要职责是什么？"
    body = {"question": q, "expected_version": 0, "reviewed": False}
    assert t.post(url + "/import", json=body).status_code == 422
    assert (
        t.put(url, json={"question": q, "expected_version": 0}).json()["version"] == 1
    )
    assert t.post(url + "/import", json={**body, "reviewed": True}).status_code == 409
    r = t.post(url + "/import", json={**body, "reviewed": True, "expected_version": 1})
    assert r.status_code == 200, r.text
    saved = r.json()
    assert not saved["published"]
    assert (
        t.post(
            url + "/import", json={**body, "reviewed": True, "expected_version": 1}
        ).status_code
        == 409
    )
    assert not any(
        x["id"] == saved["id"]
        for x in s.get("/api/study/questions?chapter_id=1").json()
    )
    pub = {k: v for k, v in saved.items() if k not in ("id", "version")}
    pub["published"] = True
    pub["expected_version"] = saved["version"]
    assert (
        t.put(f'/api/teacher/study/questions/{saved["id"]}', json=pub).status_code
        == 200
    )
    assert any(
        x["id"] == saved["id"]
        for x in s.get("/api/study/questions?chapter_id=1").json()
    )
    folder = backup_data(main.DB_PATH, tmp_path / "snapshot")
    restored = restore_data(folder, tmp_path / "restore")
    import sqlite3

    with sqlite3.connect(restored) as db:
        assert (
            db.execute(
                "select question_id from ai_question_drafts where id=?", (ident,)
            ).fetchone()[0]
            == saved["id"]
        )


def test_invalid_model_sources_and_failed_jobs(clients, monkeypatch):
    t, _, _ = clients
    sel, preview = source(t)

    async def fake(body, data):
        output = candidate(data)
        output["questions"][0]["source_quote"] = "这是不存在的伪造引用原文"
        return output

    monkeypatch.setattr(ai_questions, "call_deepseek", fake)
    r = generate(t, sel, preview)
    assert r.status_code == 502
    jobs = t.get("/api/teacher/ai-questions/jobs").json()
    assert jobs[0]["status"] == "failed"
    assert not t.get(f'/api/teacher/ai-questions/jobs/{jobs[0]["id"]}').json()["drafts"]
    changed = {**preview, "fingerprint": "0" * 64}
    assert generate(t, sel, changed, key="another-request-0001").status_code == 409
    monkeypatch.delenv("DEEPSEEK_API_KEY")
    assert not t.get("/api/teacher/ai-questions/status").json()["configured"]
    assert generate(t, sel, preview, key="another-request-0002").status_code == 503


def test_deepseek_json_and_key_stays_backend(clients, monkeypatch):
    t, _, _ = clients
    sel, preview = source(t)

    def handler(request):
        assert str(request.url) == "https://api.deepseek.com/chat/completions"
        assert request.headers["Authorization"] == "Bearer test-only-key"
        body = json.loads(request.content)
        assert body["response_format"] == {"type": "json_object"}
        assert TEXT in body["messages"][1]["content"]
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {
                            "content": json.dumps(
                                candidate(preview), ensure_ascii=False
                            )
                        },
                    }
                ]
            },
        )

    original = httpx.AsyncClient
    monkeypatch.setattr(
        ai_questions.httpx,
        "AsyncClient",
        lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs),
    )
    r = generate(t, sel, preview)
    assert r.status_code == 200, r.text
    assert "test-only-key" not in r.text


def test_pdf_pptx_excerpts(clients):
    t, _, _ = clients
    helper = runpy.run_path(
        str(Path(__file__).resolve().parents[2] / "scripts/presentation_fixture.py")
    )
    d = t.post(
        "/api/materials/upload",
        files={"file": ("课件.pptx", helper["pptx_bytes"](400))},
    ).json()["id"]
    r = t.post(
        "/api/teacher/ai-questions/sources/preview",
        json={"sources": [{"document_id": d, "start_page": 390, "end_page": 400}]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["chunks"][-1]["page"] == 400
    from pypdf import PdfWriter
    from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject
    from io import BytesIO

    writer = PdfWriter()
    page = writer.add_blank_page(width=300, height=300)
    stream = DecodedStreamObject()
    stream.set_data(
        b"BT /F1 12 Tf 20 200 Td (Operating systems manage resources and provide services.) Tj ET"
    )
    font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        }
    )
    page[NameObject("/Resources")] = DictionaryObject(
        {NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})}
    )
    page[NameObject("/Contents")] = stream
    buffer = BytesIO()
    writer.write(buffer)
    d = t.post(
        "/api/materials/upload", files={"file": ("text.pdf", buffer.getvalue())}
    ).json()["id"]
    r = t.post(
        "/api/teacher/ai-questions/sources/preview",
        json={"sources": [{"document_id": d, "start_page": 1, "end_page": 1}]},
    )
    assert r.status_code == 200, r.text
    assert "Operating systems" in r.json()["chunks"][0]["text"]


@pytest.mark.parametrize(
    "status,expected", [(401, 502), (402, 502), (429, 503), (500, 502)]
)
def test_provider_errors_are_sanitized_and_recorded(
    clients, monkeypatch, status, expected
):
    t, _, _ = clients
    sel, preview = source(t)
    original = httpx.AsyncClient
    monkeypatch.setattr(
        ai_questions.httpx,
        "AsyncClient",
        lambda **kwargs: original(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    status, json={"error": "do-not-leak-test-only-key"}
                )
            ),
            **kwargs,
        ),
    )
    r = generate(t, sel, preview)
    assert r.status_code == expected, r.text
    assert "test-only-key" not in r.text
    assert t.get("/api/teacher/ai-questions/jobs").json()[0]["status"] == "failed"


def test_no_auto_publish_and_source_change(clients, monkeypatch):
    t, _, _ = clients
    sel, preview = source(t)

    async def fake(body, data):
        return candidate(data)

    monkeypatch.setattr(ai_questions, "call_deepseek", fake)
    job = generate(t, sel, preview).json()
    draft = job["drafts"][0]
    q = {**draft["question"], "published": True}
    assert (
        t.post(
            f'/api/teacher/ai-questions/drafts/{draft["id"]}/import',
            json={"question": q, "expected_version": 0, "reviewed": True},
        ).status_code
        == 422
    )
    ident = sel["sources"][0]["document_id"]
    assert (
        t.post(
            f"/api/materials/{ident}/replace",
            files={"file": ("updated.txt", (TEXT + "教师补充了一项新内容。").encode())},
        ).status_code
        == 200
    )
    assert generate(t, sel, preview, key="source-changed-0001").status_code == 409


def test_stale_running_task_is_recoverable(clients, monkeypatch):
    t, _, _ = clients
    sel, preview = source(t)

    async def fake(body, data):
        return candidate(data)

    monkeypatch.setattr(ai_questions, "call_deepseek", fake)
    job = generate(t, sel, preview).json()
    with main.database() as db:
        db.execute(
            "UPDATE ai_question_jobs SET status='running',created_at=datetime('now','-10 minutes') WHERE id=?",
            (job["id"],),
        )
    listed = t.get("/api/teacher/ai-questions/jobs").json()
    assert listed[0]["status"] == "interrupted"
    assert "手动重新生成" in listed[0]["error"]
