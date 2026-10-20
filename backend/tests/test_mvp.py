import pytest
from fastapi.testclient import TestClient
from app import main
from app.algorithms import Process, fcfs


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "db.sqlite")
    monkeypatch.delenv("LLM_MODE", raising=False)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    with TestClient(main.app) as c:
        from app.auth import create_user

        create_user("test_student", "only-for-unit-tests", "student")
        logged = c.post(
            "/api/auth/login",
            json={"username": "test_student", "password": "only-for-unit-tests"},
        )
        c.headers["X-CSRF-Token"] = logged.json()["csrf_token"]
        yield c


@pytest.mark.parametrize(
    "rows,order,wait,turn,idle",
    [
        (
            [("P1", 0, 4), ("P2", 1, 3), ("P3", 2, 1)],
            ["P1", "P2", "P3"],
            8 / 3,
            16 / 3,
            [],
        ),
        ([("P1", 2, 2), ("P2", 7, 1)], ["P1", "P2"], 0, 1.5, [(0, 2), (4, 7)]),
        (
            [("P1", 0, 3), ("P2", 0, 2), ("P3", 0, 1)],
            ["P1", "P2", "P3"],
            8 / 3,
            14 / 3,
            [],
        ),
        ([("later", 4, 2), ("first", 0, 1)], ["first", "later"], 0, 1.5, [(1, 4)]),
    ],
)
def test_fcfs(rows, order, wait, turn, idle):
    result = fcfs([Process(pid=p, arrival=a, burst=b) for p, a, b in rows])
    assert [r["pid"] for r in result["results"]] == order
    assert result["average_waiting"] == pytest.approx(wait)
    assert result["average_turnaround"] == pytest.approx(turn)
    assert [(t["start"], t["end"]) for t in result["timeline"] if t["idle"]] == idle
    for p in result["results"]:
        assert p["completion"] == p["start"] + p["burst"]
        assert p["waiting"] == p["start"] - p["arrival"]
        assert p["turnaround"] == p["completion"] - p["arrival"]


@pytest.mark.parametrize(
    "processes",
    [
        [],
        [{"pid": "", "arrival": 0, "burst": 1}],
        [{"pid": "a", "arrival": -1, "burst": 1}],
        [{"pid": "a", "arrival": 0, "burst": 0}],
        [
            {"pid": "a", "arrival": 0, "burst": 1},
            {"pid": " a ", "arrival": 0, "burst": 1},
        ],
        [{"pid": "a", "arrival": None, "burst": 1}],
    ],
)
def test_invalid_processes(client, processes):
    assert (
        client.post("/api/labs/fcfs", json={"processes": processes}).status_code == 422
    )


def test_course_and_practice(client):
    chapters = client.get("/api/chapters").json()
    assert len(chapters) == 7
    item = client.get("/api/knowledge?chapter_id=3").json()[0]
    assert client.get(f"/api/knowledge/{item['id']}").json()["lab_path"] == "/lab"
    assert client.get("/api/knowledge/99999").status_code == 404
    q = client.get("/api/questions?chapter_id=1").json()[0]
    assert "answer" not in q
    grade = client.post(
        "/api/practice/submit", json={"answers": {str(q["id"]): 0}}
    ).json()
    assert grade["score"] == 1 and grade["results"][0]["explanation"]
    assert (
        client.post("/api/practice/submit", json={"answers": {"999": 0}}).status_code
        == 422
    )
    assert client.post("/api/chat", json={"question": "进程是什么"}).status_code == 503
    assert client.get("/api/health").json()["ai_configured"] is False


def test_file_lifecycle(client):
    r = client.post(
        "/api/materials/upload",
        files={"file": ("../../test.txt", "进程资料".encode(), "text/plain")},
        data={"chapter": "进程与线程"},
    )
    assert r.status_code == 201, r.text
    item = r.json()
    assert item["original_name"] == "test.txt" and item["category"] == "personal"
    mid = item["id"]
    assert client.get(f"/api/materials/{mid}/file").text == "进程资料"
    assert (
        "attachment"
        in client.get(f"/api/materials/{mid}/file?download=true").headers[
            "content-disposition"
        ]
    )
    assert client.delete(f"/api/materials/{mid}").status_code == 204
    assert list((main.DB_PATH.parent / "uploads").glob("*"))  # 回收站保留原文件
    assert client.get(f"/api/materials/{mid}/file").status_code == 404
    assert client.post(f"/api/materials/{mid}/restore").status_code == 200
    assert client.get(f"/api/materials/{mid}/file").text == "进程资料"
    public = next(
        i for i in client.get("/api/materials").json() if i["category"] == "public"
    )
    assert client.delete(f"/api/materials/{public['id']}").status_code == 403


@pytest.mark.parametrize(
    "name,content,status",
    [
        ("a.exe", b"x", 415),
        ("a.pdf", b"fake", 415),
        ("a.txt", b"\xff", 415),
        ("a.txt", b"\x00", 415),
        ("a.txt", b"", 422),
        ("a.txt", b"x" * (10 * 1024 * 1024 + 1), 413),
    ],
)
def test_bad_files(client, name, content, status):
    r = client.post("/api/materials/upload", files={"file": (name, content)})
    assert r.status_code == status, r.text
    assert not list((main.DB_PATH.parent / "uploads").glob("*"))


def test_restart_idempotent(client):
    count = len(client.get("/api/materials").json())
    with TestClient(main.app) as again:
        login = again.post(
            "/api/auth/login",
            json={"username": "test_student", "password": "only-for-unit-tests"},
        )
        again.headers["X-CSRF-Token"] = login.json()["csrf_token"]
        assert len(again.get("/api/materials").json()) == count
        assert len(again.get("/api/chapters").json()) == 7


def test_request_body_limit(client, monkeypatch):
    from app import files

    monkeypatch.setattr(files, "PERSONAL_PRESENTATION_MAX_SIZE", 1024 * 1024)
    assert (
        client.post(
            "/api/materials/upload",
            content=b"x" * (2 * 1024 * 1024 + 1),
            headers={"Content-Type": "multipart/form-data; boundary=x"},
        ).status_code
        == 413
    )


def test_pdf_and_categories(client):
    r = client.post(
        "/api/materials/upload",
        files={"file": ("test.pdf", b"%PDF-1.4\n%%EOF", "application/pdf")},
    )
    assert r.status_code == 201
    mid = r.json()["id"]
    assert (
        client.get(f"/api/materials/{mid}/file").headers["content-type"]
        == "application/pdf"
    )
    assert all(
        m["category"] == "personal"
        for m in client.get("/api/materials?category=personal").json()
    )
    assert client.get("/api/materials?category=unknown").status_code == 422


def test_old_database_upgrade(tmp_path, monkeypatch):
    import sqlite3

    path = tmp_path / "old.db"
    with sqlite3.connect(path) as db:
        db.execute(
            "CREATE TABLE materials(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,content TEXT NOT NULL,chapter TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
        )
        db.execute("INSERT INTO materials(title,content) VALUES ('旧资料','旧正文')")
    monkeypatch.setattr(main, "DB_PATH", path)
    with TestClient(main.app) as c:
        with main.database() as db:
            old = dict(db.execute("SELECT * FROM documents WHERE id=1").fetchone())
            assert (
                old["title"] == "旧资料"
                and old["content"] == "旧正文"
                and old["category"] == "personal"
            )
            assert old["owner_id"] is None
            assert db.execute("SELECT count(*) FROM chapters").fetchone()[0] == 7
        assert c.get("/api/materials/1").status_code == 401
    assert list((tmp_path / "backups").glob("*/old.db"))
