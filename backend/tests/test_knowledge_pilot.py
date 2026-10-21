import json
import sys
from pathlib import Path
from datetime import datetime, timezone
import pytest
from fastapi import HTTPException
from app import main, personal_learning as ai
from app.knowledge_pilot import stale_jobs
from test_personal_learning import clients, BASE

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from pilot_fixture import GOLD, decks, model_output


def setup(t, a):
    section = t.post(
        "/api/teacher/sections",
        json={"chapter_id": 1, "title": "基本服务和用户接口", "published": True},
    ).json()["id"]
    docs = []
    for i, data in enumerate(decks()):
        r = a.post("/api/materials/upload", files={"file": (f"小节补充{i}.pptx", data)})
        assert r.status_code == 201, r.text
        docs.append(r.json()["id"])
    return {
        "chapter_id": 1,
        "section_id": section,
        "topic": "基本服务和用户接口",
        "sources": [{"document_id": d, "start_page": 1} for d in docs],
        "analysis_mode": "section",
        "modes": ["map"],
        "analysis_confirmed": True,
        "request_key": "pilot-request-map-0001",
    }


def preview(a, config):
    r = a.post(BASE + "/sources/preview", json=config)
    assert r.status_code == 200, r.text
    config["fingerprint"] = r.json()["fingerprint"]
    return r.json()


def mock_model(monkeypatch, calls, fail_at=None, mutation=None):
    async def call(body, source, **kwargs):
        payload = kwargs["payload"]
        calls.append(payload)
        if fail_at and len(calls) == fail_at:
            raise HTTPException(504, "测试模型超时")
        result = model_output(payload)
        if mutation:
            mutation(payload["task"], result)
        return result

    monkeypatch.setattr(ai, "call_deepseek", call)


def test_multi_ppt_full_pipeline_cache_cards_and_isolation(clients, monkeypatch):
    t, a, b = clients
    config = setup(t, a)
    selected = preview(a, config)
    assert selected["pilot_plan"]["batches"] >= 2
    assert len(selected["pilot_plan"]["excluded"]) == 12
    calls = []
    mock_model(monkeypatch, calls)
    r = a.post(BASE + "/generate", json=config)
    assert r.status_code == 200, r.text
    job = r.json()
    state = job["body"]["pilot"]
    assert len(state["facts"]) == len(GOLD)
    assert state["metrics"]["processed_chunks"] == len(selected["chunks"])
    assert state["metrics"]["artifact_fact_coverage"] == 1
    assert any(len(f["evidence"]) == 2 for f in state["facts"])
    # Old overview sees only directory pages for this same fixture.
    old = a.post(
        BASE + "/sources/preview",
        json={**config, "analysis_mode": "quick", "source_overview": True},
    ).json()
    assert not any(
        statement in "".join(c["text"] for c in old["chunks"]) for _, statement in GOLD
    )
    assert all(
        statement in "".join(n["label"] for n in job["body"]["modules"][0]["nodes"])
        for _, statement in GOLD
    )
    assert b.get(BASE + f'/jobs/{job["id"]}').status_code == 404
    assert b.get(BASE + "/progress/" + config["request_key"]).status_code == 404
    assert (
        a.get(BASE + "/progress/" + config["request_key"]).json()["completed_batches"]
        == state["plan"]["batches"]
    )
    assert t.get(BASE + "/progress/" + config["request_key"]).status_code == 403
    assert a.post(BASE + "/generate", json=config).json()["id"] == job["id"]
    config.update(modes=["flashcards"], request_key="pilot-request-cards-0001")
    next_plan = preview(a, config)["pilot_plan"]
    assert next_plan["estimated_calls"] == 1
    count = len(calls)
    r = a.post(BASE + "/generate", json=config)
    assert r.status_code == 200, r.text
    cards = r.json()["body"]["modules"][0]["cards"]
    assert len(calls) == count + 1
    assert len(cards) == len(GOLD)
    assert all(card["back"] in [s for _, s in GOLD] for card in cards)
    assert len({c["front"] for c in cards}) == len(cards)
    # Private source permissions remain checked before cache reuse.
    assert b.post(BASE + "/sources/preview", json=config).status_code == 404


def test_failed_batch_resume_and_heartbeat(clients, monkeypatch):
    t, a, _ = clients
    config = setup(t, a)
    preview(a, config)
    calls = []
    mock_model(monkeypatch, calls, fail_at=2)
    r = a.post(BASE + "/generate", json=config)
    assert r.status_code == 504
    config["request_key"] = "pilot-resume-request-0001"
    plan = preview(a, config)["pilot_plan"]
    assert plan["cached_batches"] == 1
    resumed = []
    mock_model(monkeypatch, resumed)
    r = a.post(BASE + "/generate", json=config)
    assert r.status_code == 200, r.text
    assert (
        len([c for c in resumed if c["task"] == "pilot_extract"]) == plan["batches"] - 1
    )
    # A long-running task with a fresh heartbeat must not be marked interrupted.
    with main.database() as db:
        db.execute(
            "UPDATE personal_ai_jobs SET status='running',created_at='2000-01-01 00:00:00',body_json=? WHERE id=?",
            (
                json.dumps(
                    {"pilot": {"heartbeat": datetime.now(timezone.utc).isoformat()}}
                ),
                r.json()["id"],
            ),
        )
        stale_jobs(db, 2)
        assert (
            db.execute(
                "SELECT status FROM personal_ai_jobs WHERE id=?", (r.json()["id"],)
            ).fetchone()[0]
            == "running"
        )


@pytest.mark.parametrize(
    "failure", ["quote", "omit_block", "omit_concept", "duplicate_card", "conflict"]
)
def test_quality_gates_preserve_checkpoints(clients, monkeypatch, failure):
    t, a, _ = clients
    config = setup(t, a)
    if failure == "duplicate_card":
        config["modes"] = ["flashcards"]
    preview(a, config)

    def mutation(task, result):
        if failure == "quote" and task == "pilot_extract":
            result["blocks"][0]["facts"][0]["quote"] = "资料里不存在的虚构引用文字"
        if failure == "omit_block" and task == "pilot_extract":
            result["blocks"].pop()
        if failure == "omit_concept" and task == "pilot_merge":
            result["concepts"].pop()
        if failure == "duplicate_card" and task == "pilot_flashcards":
            result["cards"][1]["front"] = result["cards"][0]["front"]
        if failure == "conflict" and task == "pilot_merge":
            result["conflicts"] = ["定义存在不同适用条件，需核对"]

    mock_model(monkeypatch, [], mutation=mutation)
    r = a.post(BASE + "/generate", json=config)
    assert r.status_code in (422, 502), r.text
    jobs = a.get(BASE + "/jobs").json()
    failed = a.get(BASE + f'/jobs/{jobs[0]["id"]}').json()
    assert failed["status"] == "failed"
    assert "modules" not in failed["body"]


def test_confirmation_limits_and_versions(clients, monkeypatch):
    t, a, _ = clients
    config = setup(t, a)
    preview(a, config)
    assert (
        a.post(
            BASE + "/generate", json={**config, "analysis_confirmed": False}
        ).status_code
        == 422
    )
    assert (
        a.post(BASE + "/generate", json={**config, "modes": ["explain"]}).status_code
        == 422
    )
    assert (
        a.post(
            BASE + "/sources/preview", json={**config, "section_id": None}
        ).status_code
        == 200
    )
    calls = []
    mock_model(monkeypatch, calls)
    r = a.post(BASE + "/generate", json=config)
    assert r.status_code == 200
    with main.database() as db:
        db.execute(
            "UPDATE documents SET title='资料版本修改' WHERE id=?",
            (config["sources"][0]["document_id"],),
        )
    config["request_key"] = "pilot-new-version-request"
    new = preview(a, config)
    assert new["pilot_plan"]["cached_batches"] == 0


def test_directory_only_and_scope_limits_do_not_call_model(clients, monkeypatch):
    from pilot_fixture import pptx_bytes

    t, a, _ = clients
    config = setup(t, a)
    config["sources"][0]["end_page"] = 6
    config["sources"] = config["sources"][:1]
    calls = []
    mock_model(monkeypatch, calls)
    r = a.post(BASE + "/sources/preview", json=config)
    assert r.status_code == 422 and "正文不足" in r.json()["detail"]
    assert calls == []
    doc = a.post(
        "/api/materials/upload", files={"file": ("大范围课件.pptx", pptx_bytes(121))}
    ).json()["id"]
    config["sources"] = [{"document_id": doc}]
    r = a.post(BASE + "/sources/preview", json=config)
    assert r.status_code == 422 and "120页" in r.json()["detail"]
    assert calls == []


def test_pilot_call_budget_keeps_completed_analysis(clients, monkeypatch):
    t, a, _ = clients
    config = setup(t, a)
    preview(a, config)
    mock_model(monkeypatch, [])
    r = a.post(BASE + "/generate", json=config)
    assert r.status_code == 200
    with main.database() as db:
        body = r.json()["body"]
        body["pilot"]["calls_used"] = 60
        db.execute(
            "UPDATE personal_ai_jobs SET body_json=? WHERE id=?",
            (json.dumps(body), r.json()["id"]),
        )
    config.update(modes=["flashcards"], request_key="pilot-budget-stop-00001")
    preview(a, config)
    calls = []
    mock_model(monkeypatch, calls)
    response = a.post(BASE + "/generate", json=config)
    assert response.status_code == 429
    assert calls == []
    assert preview(a, config)["pilot_plan"]["estimated_calls"] == 1


def test_exact_dedup_preserves_operators_and_case():
    from app.knowledge_pilot import facts_from

    statements = [
        "条件x=0时允许当前请求继续执行。",
        "条件x!=0时允许当前请求继续执行。",
        "变量A表示当前请求数量。",
        "变量a表示当前请求数量。",
    ]
    state = {
        "batches": {
            "0": {
                "blocks": [
                    {
                        "ref": "r",
                        "facts": [
                            {"title": "条件", "statement": s, "quote": s}
                            for s in statements + statements[:1]
                        ],
                    }
                ]
            }
        }
    }
    facts = facts_from(state)
    assert len(facts) == 4
    assert len(facts[0]["evidence"]) == 2


def test_directory_concept_is_not_mistaken_for_navigation_metadata():
    from app.knowledge_pilot import metadata_label

    assert not metadata_label("目录结构")
    assert not metadata_label("文件目录结构")
    assert metadata_label("资料不足说明")
    assert metadata_label("位于1.2之后")
