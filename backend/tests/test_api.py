import httpx
import pytest
from fastapi.testclient import TestClient
from app import main


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setenv("LLM_MODE", "mock")
    with TestClient(main.app) as c:
        from app.auth import create_user

        create_user("test_student", "only-for-unit-tests", "student")
        logged = c.post(
            "/api/auth/login",
            json={"username": "test_student", "password": "only-for-unit-tests"},
        )
        c.headers["X-CSRF-Token"] = logged.json()["csrf_token"]
        yield c


def test_crud_chat(client):
    assert client.get("/api/health").json()["database"] == "ok"
    r = client.post("/api/materials", json={"title": "进程", "content": "资源分配单位"})
    assert r.status_code == 201
    mid = r.json()["id"]
    assert client.get(f"/api/materials/{mid}").json()["title"] == "进程"
    assert (
        client.put(f"/api/materials/{mid}", json={"title": "线程"}).json()["title"]
        == "线程"
    )
    r = client.post("/api/chat", json={"question": "解释线程", "material_id": mid})
    assert r.status_code == 200 and r.json()["mode"] == "mock"
    assert client.get("/api/conversations").json()[0]["answer"] == r.json()["answer"]
    assert client.delete(f"/api/materials/{mid}").status_code == 204
    assert client.get(f"/api/materials/{mid}").status_code == 404
    assert (
        client.post(
            "/api/chat", json={"question": "问题", "material_id": mid}
        ).status_code
        == 404
    )
    assert client.post("/api/materials", json={"title": ""}).status_code == 422
    assert client.get("/api/materials?limit=0").status_code == 422


def test_provider_contract(client, monkeypatch):
    monkeypatch.setenv("LLM_MODE", "openai")
    monkeypatch.setenv("LLM_API_KEY", "test-only")
    original = httpx.AsyncClient

    def handle(r):
        assert str(r.url) == "https://api.openai.com/v1/chat/completions"
        assert r.headers["authorization"] == "Bearer test-only"
        return httpx.Response(
            200, json={"choices": [{"message": {"content": "测试回答"}}]}
        )

    monkeypatch.setattr(
        main.httpx,
        "AsyncClient",
        lambda **kw: original(transport=httpx.MockTransport(handle), **kw),
    )
    r = client.post("/api/chat", json={"question": "你好"})
    assert r.json()["answer"] == "测试回答" and r.json()["mode"] == "openai"


def test_provider_errors(client, monkeypatch):
    monkeypatch.setenv("LLM_MODE", "openai")
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    assert client.post("/api/chat", json={"question": "hi"}).status_code == 503
    monkeypatch.setenv("LLM_API_KEY", "test-only")
    original = httpx.AsyncClient
    monkeypatch.setattr(
        main.httpx,
        "AsyncClient",
        lambda **kw: original(
            transport=httpx.MockTransport(lambda r: httpx.Response(401)), **kw
        ),
    )
    assert client.post("/api/chat", json={"question": "hi"}).status_code == 502
    assert client.get("/api/conversations").json() == []


@pytest.mark.parametrize(
    "chat_key,deepseek_key,mode,chat_expected,personal_expected",
    [
        ("", "", "openai", False, False),
        ("", "test-deepseek-only", "openai", False, True),
        ("test-chat-only", "", "openai", True, False),
        ("test-chat", "test-deepseek", "openai", True, True),
        ("test-chat", "test-deepseek", "mock", False, True),
        ("   ", "   ", "openai", False, False),
    ],
)
def test_health_distinguishes_chat_and_personal_ai(
    client, monkeypatch, chat_key, deepseek_key, mode, chat_expected, personal_expected
):
    monkeypatch.setenv("LLM_MODE", mode)
    monkeypatch.setenv("LLM_API_KEY", chat_key)
    monkeypatch.setenv("DEEPSEEK_API_KEY", deepseek_key)
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["chat_ai_configured"] is chat_expected
    assert data["personal_ai_configured"] is personal_expected
    assert data["ai_configured"] is chat_expected
    assert data["platform_revision"] == "student-autonomous-v8"
    for secret in (chat_key.strip(), deepseek_key.strip()):
        if secret:
            assert secret not in response.text
