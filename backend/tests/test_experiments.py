import sqlite3
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from app import main
from app.auth import create_user
from app.scheduling import ScheduleInput, calculate
from app.migrations import migrate
from app.persistence import restore_data


def inp(rows, quantum=2):
    return ScheduleInput(
        processes=[dict(pid=p, arrival=a, burst=b) for p, a, b in rows], quantum=quantum
    )


@pytest.mark.parametrize(
    "algorithm,order,waiting",
    [
        ("fcfs", ["A", "B", "C"], [0, 6, 9]),
        ("sjf", ["A", "C", "B"], [0, 7, 5]),
        ("rr", ["A", "B", "C", "A", "B", "A", "A"], [5, 4, 2]),
    ],
)
def test_scheduling_reference(algorithm, order, waiting):
    result = calculate(algorithm, inp([("A", 0, 7), ("B", 1, 4), ("C", 2, 1)]))
    assert [t["pid"] for t in result["timeline"]] == order
    assert [
        p["waiting"] for p in sorted(result["results"], key=lambda p: p["pid"])
    ] == waiting
    assert sum(t["end"] - t["start"] for t in result["timeline"] if not t["idle"]) == 12
    for p in result["results"]:
        assert p["waiting"] == p["completion"] - p["arrival"] - p["burst"]
        assert p["response"] == p["start"] - p["arrival"]


@pytest.mark.parametrize("algorithm", ["fcfs", "sjf", "rr"])
def test_idle_fractional_and_ties(algorithm):
    r = calculate(algorithm, inp([("A", 2, 0.3), ("B", 7, 0.3)], 0.1))
    assert [t["end"] for t in r["timeline"] if t["idle"]] == [2, 7]
    assert r["results"][1]["completion"] == 7.3
    r = calculate(algorithm, inp([("B", 0, 1), ("A", 0, 1)], 1))
    assert r["timeline"][0]["pid"] == "B"


def test_rr_boundary_and_bounded_work():
    r = calculate("rr", inp([("A", 0, 4), ("B", 2, 1)], 2))
    assert [t["pid"] for t in r["timeline"]] == ["A", "B", "A"]
    with pytest.raises(HTTPException) as exc:
        calculate("rr", inp([("A", 0, 1000000)], 0.000001))
    assert exc.value.status_code == 422
    with pytest.raises(ValueError):
        inp([("A", 0, 1), (" A ", 0, 1)])
    with pytest.raises(ValueError):
        inp([("A", float("nan"), 1)])


@pytest.fixture
def clients(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "data" / "assistant.db")
    with TestClient(main.app) as t, TestClient(main.app) as s, TestClient(
        main.app
    ) as other:
        for client, name, role in [
            (t, "teacher", "teacher"),
            (s, "student", "student"),
            (other, "other", "student"),
        ]:
            create_user(name, "experiment-test-password", role)
            response = client.post(
                "/api/auth/login",
                json=dict(username=name, password="experiment-test-password"),
            )
            client.headers["X-CSRF-Token"] = response.json()["csrf_token"]
        yield t, s, other


def draft(algorithm="rr"):
    return dict(
        title="演示实验",
        algorithm=algorithm,
        chapter_id=1,
        knowledge_ids=[1],
        objectives="观察调度过程",
        instructions="输入后运行",
        tasks="解释等待时间",
        reference="参考仅作学习提示",
        defaults=inp([("A", 0, 4), ("B", 1, 1)]).model_dump(),
    )


def test_publish_snapshot_permissions_and_runs(clients):
    t, s, other = clients
    body = draft()
    created = t.post("/api/teacher/experiments", json=body)
    assert created.status_code == 201, created.text
    d = created.json()
    ident = d["id"]
    url = f"/api/teacher/experiments/{ident}"
    assert s.get("/api/teacher/experiments").status_code == 403
    assert s.post("/api/teacher/experiments", json=body).status_code == 403
    assert s.get(url).status_code == 403
    assert s.get(f"/api/experiments/{ident}").status_code == 404
    assert (
        s.put(url, json={**body, "edit_version": d["edit_version"]}).status_code == 403
    )
    version = {"edit_version": d["edit_version"]}
    for action in ["preview", "publish", "withdraw"]:
        assert s.post(url + "/" + action, json=version).status_code == 403
    assert t.post(url + "/publish", json=version).status_code == 422
    assert t.post(url + "/preview", json=version).status_code == 200
    d = t.post(url + "/publish", json=version).json()
    published = s.get(f"/api/experiments/{ident}").json()
    assert s.get("/api/experiments?knowledge_id=1").json()[0]["id"] == ident
    changed = t.put(
        url, json={**body, "title": "未发布新标题", "edit_version": d["edit_version"]}
    ).json()
    assert s.get(f"/api/experiments/{ident}").json()["title"] == "演示实验"
    assert (
        t.put(url, json={**body, "edit_version": d["edit_version"]}).status_code == 409
    )
    assert (
        t.post(
            url + "/publish", json={"edit_version": changed["edit_version"]}
        ).status_code
        == 422
    )
    run = s.post(
        f"/api/experiments/{ident}/runs",
        json={**body["defaults"], "revision_id": published["revision_id"]},
    )
    assert run.status_code == 201, run.text
    rid = run.json()["id"]
    my = f"/api/my/experiment-runs/{rid}"
    assert other.get(my).status_code == 404
    assert t.get(my).status_code == 404
    assert (
        other.put(my + "/observation", json={"observation": "篡改"}).status_code == 404
    )
    assert s.put(my + "/observation", json={"observation": " "}).status_code == 422
    assert (
        s.put(
            my + "/observation", json={"observation": "观察到短进程可以更早响应"}
        ).status_code
        == 200
    )
    assert s.get(my).json()["completed_at"]
    assert (
        t.post(
            url + "/withdraw", json={"edit_version": changed["edit_version"]}
        ).status_code
        == 200
    )
    assert s.get(f"/api/experiments/{ident}").status_code == 404
    assert (
        s.post(
            f"/api/experiments/{ident}/runs",
            json={**body["defaults"], "revision_id": published["revision_id"]},
        ).status_code
        == 404
    )
    assert s.get(my).json()["experiment"]["title"] == "演示实验"
    assert not other.get("/api/my/experiment-runs").json()


def test_incomplete_unpublished_chapter_and_stale_revision(clients):
    t, s, _ = clients
    body = draft("sjf")
    d = t.post("/api/teacher/experiments", json={**body, "tasks": ""}).json()
    url = f'/api/teacher/experiments/{d["id"]}'
    version = {"edit_version": d["edit_version"]}
    t.post(url + "/preview", json=version)
    assert t.post(url + "/publish", json=version).status_code == 422
    d = t.put(url, json={**body, **version}).json()
    old = d["revision_id"]
    with main.database() as db:
        db.execute("UPDATE chapters SET published=0 WHERE id=1")
    t.post(url + "/preview", json={"edit_version": d["edit_version"]})
    assert (
        t.post(url + "/publish", json={"edit_version": d["edit_version"]}).status_code
        == 422
    )
    with main.database() as db:
        db.execute("UPDATE chapters SET published=1 WHERE id=1")
    d = t.post(url + "/publish", json={"edit_version": d["edit_version"]}).json()
    d = t.put(url, json={**body, "edit_version": d["edit_version"]}).json()
    t.post(url + "/preview", json={"edit_version": d["edit_version"]})
    t.post(url + "/publish", json={"edit_version": d["edit_version"]})
    assert (
        s.post(
            f'/api/experiments/{d["id"]}/runs',
            json={**body["defaults"], "revision_id": old},
        ).status_code
        == 409
    )


def test_v5_migration_preserves_and_backup_restores(clients, tmp_path):
    with main.database() as db:
        count = db.execute("select count(*) from knowledge_points").fetchone()[0]
        for table in [
            "experiment_runs",
            "experiment_previews",
            "experiment_revisions",
            "experiments",
        ]:
            db.execute("DROP TABLE " + table)
        db.execute("DELETE FROM schema_versions WHERE version=5")
    migrate(main.DB_PATH)
    migrate(main.DB_PATH)
    with main.database() as db:
        assert (
            db.execute("select count(*) from knowledge_points").fetchone()[0] == count
        )
        assert (
            db.execute(
                "select count(*) from schema_versions where version=5"
            ).fetchone()[0]
            == 1
        )
        assert db.execute("select count(*) from users").fetchone()[0] == 3
    backups = sorted((main.DB_PATH.parent / "backups").glob("before-v5-*"))
    restored = restore_data(backups[-1], tmp_path / "restored")
    with sqlite3.connect(restored) as db:
        assert (
            db.execute("select count(*) from knowledge_points").fetchone()[0] == count
        )


def test_experiment_backup_keeps_immutable_run_snapshot(clients, tmp_path):
    from app.persistence import backup_data

    t, s, _ = clients
    body = draft("fcfs")
    d = t.post("/api/teacher/experiments", json=body).json()
    url = f'/api/teacher/experiments/{d["id"]}'
    version = {"edit_version": d["edit_version"]}
    t.post(url + "/preview", json=version)
    published = t.post(url + "/publish", json=version).json()
    run = s.post(
        f'/api/experiments/{d["id"]}/runs',
        json={**body["defaults"], "revision_id": published["revision_id"]},
    ).json()
    s.put(
        f'/api/my/experiment-runs/{run["id"]}/observation',
        json={"observation": "要保留的观察"},
    )
    folder = backup_data(main.DB_PATH, tmp_path / "snapshot")
    restored = restore_data(folder, tmp_path / "recover")
    with sqlite3.connect(restored) as db:
        assert (
            db.execute(
                "SELECT observation FROM experiment_runs WHERE id=?", (run["id"],)
            ).fetchone()[0]
            == "要保留的观察"
        )
        assert db.execute(
            "SELECT body FROM experiment_revisions WHERE id=?",
            (published["revision_id"],),
        ).fetchone()
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
