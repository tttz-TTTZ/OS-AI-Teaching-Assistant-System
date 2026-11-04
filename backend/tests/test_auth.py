from app import database as db_config
import hashlib
import time
import pytest
from fastapi.testclient import TestClient
from app import main
from app.auth import create_user


@pytest.fixture
def clients(tmp_path, monkeypatch):
    monkeypatch.setattr(db_config, "DB_PATH", tmp_path / "auth.db")
    with TestClient(main.app) as admin, TestClient(main.app) as alice, TestClient(
        main.app
    ) as bob:
        for name, role in [
            ("teacher", "teacher"),
            ("alice", "student"),
            ("bob", "student"),
        ]:
            create_user(name, "test-password-12345", role)
        for c, name in [(admin, "teacher"), (alice, "alice"), (bob, "bob")]:
            r = c.post(
                "/api/auth/login",
                json={"username": name, "password": "test-password-12345"},
            )
            assert r.status_code == 200, r.text
            c.headers["X-CSRF-Token"] = r.json()["csrf_token"]
        yield admin, alice, bob


def test_sessions_and_csrf(clients):
    admin, alice, bob = clients
    assert admin.get("/api/auth/me").json()["role"] == "teacher"
    assert alice.get("/api/auth/me").json()["role"] == "student"
    with main.database() as db:
        user = db.execute("SELECT * FROM users WHERE username='alice'").fetchone()
        assert user["password_hash"].startswith("$argon2id$")
        assert db.execute("SELECT count(*) FROM sessions").fetchone()[0] == 3
    csrf = alice.headers.pop("X-CSRF-Token")
    assert alice.post("/api/materials/upload", files={"file": ("x.txt", b"test")}).status_code == 403
    alice.headers["X-CSRF-Token"] = csrf
    token = alice.cookies.get("os_session")
    assert alice.post("/api/auth/logout").status_code == 204
    assert alice.get("/api/auth/me").status_code == 401
    alice.cookies.set("os_session", token)
    assert alice.get("/api/materials").status_code == 401
    with main.database() as db:
        db.execute("UPDATE sessions SET expires_at=?", (int(time.time()) - 1,))
    assert bob.get("/api/auth/me").status_code == 401


def test_personal_access_all_paths(clients):
    admin, alice, bob = clients
    r = alice.post("/api/materials/upload", files={"file": ("mine.txt", b"private")})
    assert r.status_code == 201, r.text
    mid = r.json()["id"]
    assert alice.get(f"/api/materials/{mid}/file").text == "private"
    for other in [admin, bob]:
        assert all(d["id"] != mid for d in other.get("/api/materials").json())
        assert other.get(f"/api/materials/{mid}").status_code == 404
        assert other.get(f"/api/materials/{mid}/file").status_code == 404
        assert other.delete(f"/api/materials/{mid}").status_code == 404
        assert other.post(f"/api/materials/{mid}/replace", files={"file": ("x.txt", b"hack")}).status_code == 404


def test_wrong_login_and_origin(clients):
    _, alice, _ = clients
    assert (
        alice.post(
            "/api/auth/login", json={"username": "alice", "password": "wrong"}
        ).status_code
        == 401
    )
    assert (
        alice.post(
            "/api/auth/login", json={"username": "nobody", "password": "wrong"}
        ).status_code
        == 401
    )
    assert (
        alice.post(
            "/api/auth/login",
            json={"username": "alice", "password": "test-password-12345"},
            headers={"Origin": "https://evil.example"},
        ).status_code
        == 403
    )
















def test_registration_cannot_create_teacher_or_invalid_account(tmp_path, monkeypatch):
    monkeypatch.setattr(db_config, "DB_PATH", tmp_path / "invalid-registration.db")
    with TestClient(main.app) as client:
        body = {"username": "student", "password": "registration-test-password"}
        for extra in [{"role": "teacher"}, {"is_admin": True}, {"active": True}]:
            assert client.post("/api/auth/register", json={**body, **extra}).status_code == 422
        for invalid in [{"username": "   "}, {"password": "short"}, {"password": "x" * 129}]:
            assert client.post("/api/auth/register", json={**body, **invalid}).status_code == 422
        assert client.post("/api/auth/register", json=body,
                           headers={"Origin": "https://evil.example"}).status_code == 403
        with main.database() as db:
            assert db.execute("SELECT count(*) FROM users").fetchone()[0] == 0


def test_selected_login_portal_enforced_before_session_creation(clients):
    teacher, student, _ = clients
    for client, username, wrong_role in [(teacher, "teacher", "student"), (student, "alice", "teacher")]:
        with main.database() as db:
            before = db.execute("SELECT count(*) FROM sessions").fetchone()[0]
        response = client.post("/api/auth/login", json={
            "username": username, "password": "test-password-12345", "expected_role": wrong_role,
        })
        assert response.status_code == 403 and not response.cookies
        assert client.get("/api/auth/me").json()["username"] == username
        with main.database() as db:
            assert db.execute("SELECT count(*) FROM sessions").fetchone()[0] == before
