"""Real lexical retrieval: exclude zero matches for questions; keep overview and fallback."""

import logging
import pytest
from test_personal_learning import clients, BASE
from test_personal_chat import stub

LOGGER = "uvicorn.error.learning"


def sources(a):
    texts = [
        "Ocean currents move water around the planet and influence its climate.",
        "Magnetictrack magnetictrack magnetictrack is a circular recording path on a disk.",
        "A magnetictrack is a circular recording path on a disk surface.",
        "A compiler translates source programs into another form of instructions.",
    ]
    refs = []
    for n, text in enumerate(texts):
        r = a.post(
            "/api/materials/upload", files={"file": (f"source{n}.txt", text.encode())}
        )
        assert r.status_code == 201
        refs.append({"document_id": r.json()["id"]})
    return refs


def test_real_scoring_excludes_zero_matches_and_preserves_ranking(clients, caplog):
    _, a, _ = clients
    selected = sources(a)
    caplog.set_level(logging.INFO, logger=LOGGER)
    r = a.post(
        BASE + "/sources/preview", json={"sources": selected, "topic": "magnetictrack"}
    )
    assert r.status_code == 200, r.text
    assert [c["document_id"] for c in r.json()["chunks"]] == [
        selected[1]["document_id"],
        selected[2]["document_id"],
    ]
    assert "过滤前分数" in caplog.text and "过滤后分数" in caplog.text
    assert "personal_sources.py" in caplog.text
    assert "Ocean currents" not in caplog.text
    assert "magnetictrack" not in caplog.text  # no question or source text in logs


def test_overview_keeps_zero_matches_and_round_robin(clients, caplog):
    _, a, _ = clients
    selected = sources(a)
    caplog.set_level(logging.INFO, logger=LOGGER)
    r = a.post(
        BASE + "/sources/preview",
        json={"sources": selected, "topic": "unmatchedword", "source_overview": True},
    )
    assert r.status_code == 200, r.text
    assert [c["document_id"] for c in r.json()["chunks"]] == [
        s["document_id"] for s in selected
    ]
    assert "不按正分过滤" in caplog.text
    assert "过滤后分数" not in caplog.text


def test_all_zero_preview_rejects_but_chat_explicitly_falls_back(
    clients, monkeypatch, caplog
):
    from app import personal_chat

    _, a, _ = clients
    selected = sources(a)
    caplog.set_level(logging.INFO, logger=LOGGER)
    config = {"sources": selected, "topic": "unmatchedword"}
    assert a.post(BASE + "/sources/preview", json=config).status_code == 422
    assert "所有候选片段均为0分" in caplog.text
    calls = []
    stub(monkeypatch, calls)
    r = a.post(
        BASE + "/ask",
        json={
            "sources": selected,
            "question": "unmatchedword",
            "request_key": "retrieval-fallback-test-01",
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["body"]["basis"] == "general" and not r.json()["sources"]["chunks"]
    assert "转为通用解释" in caplog.text and len(calls) == 1


@pytest.mark.parametrize(
    "use_sources,with_selection,reason",
    [
        (False, True, "未启用结合资料"),
        (True, False, "未选择资料"),
    ],
)
def test_chat_logs_why_retrieval_is_skipped(
    clients, monkeypatch, caplog, use_sources, with_selection, reason
):
    _, a, _ = clients
    selected = sources(a) if with_selection else []
    calls = []
    stub(monkeypatch, calls)
    caplog.set_level(logging.INFO, logger=LOGGER)
    r = a.post(
        BASE + "/ask",
        json={
            "sources": selected,
            "use_sources": use_sources,
            "question": "Explain a disk track",
            "request_key": "retrieval-skip-test-01",
        },
    )
    assert r.status_code == 200, r.text
    assert "跳过检索：" + reason in caplog.text
    assert "进入 retrieve" not in caplog.text
