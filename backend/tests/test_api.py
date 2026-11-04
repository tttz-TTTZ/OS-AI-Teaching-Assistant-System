from app import database as db_config
import pytest
from fastapi.testclient import TestClient
from app import main
from app.auth import create_user

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(db_config, "DB_PATH", tmp_path / "test.db")
    with TestClient(main.app) as client:
        create_user("test_student", "only-for-unit-tests", "student")
        logged = client.post("/api/auth/login", json={"username":"test_student", "password":"only-for-unit-tests"})
        client.headers["X-CSRF-Token"] = logged.json()["csrf_token"]
        yield client

def test_material_upload_read_and_recycle(client):
    assert client.get("/api/health").json()["database"] == "ok"
    response = client.post("/api/materials/upload", files={"file": ("线程.txt", "资源分配单位".encode())})
    assert response.status_code == 201, response.text
    ident = response.json()["id"]
    assert client.get(f"/api/materials/{ident}").json()["title"] == "线程.txt"
    assert client.get(f"/api/materials/{ident}/file").text == "资源分配单位"
    assert client.delete(f"/api/materials/{ident}").status_code == 204
    assert client.get(f"/api/materials/{ident}").status_code == 404
    assert client.get("/api/materials?limit=0").status_code == 422

@pytest.mark.parametrize("key,configured", [("",False),("test-deepseek",True),("   ",False)])
def test_health_uses_only_current_provider(client, monkeypatch, key, configured):
    monkeypatch.setenv("DEEPSEEK_API_KEY", key)
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status":"ok", "database":"ok", "personal_ai_configured":configured, "platform_revision":"material-learning-v10"}
    if key.strip():
        assert key not in response.text

@pytest.mark.parametrize("method,path", [
    ("post","/api/chat"), ("get","/api/conversations"),
    ("post","/api/student/personal/jobs/1/simulate"),
    ("post","/api/teacher/learning-assets"),
    ("post","/api/materials"), ("put","/api/materials/1"),
])
def test_retired_endpoints_are_unavailable(client,method,path):
    response = client.request(method,path,json={})
    assert response.status_code in (404,405)
