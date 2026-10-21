import json
import httpx
import pytest
from test_personal_learning import clients, BASE, TEXT, prepared
from app import personal_chat as chat, ai_questions


def stub(monkeypatch, calls):
    async def model(body, source, **kw):
        calls.append(kw["payload"])
        citations = (
            [
                {
                    "source_ref": source["chunks"][0]["ref"],
                    "source_quote": source["chunks"][0]["text"][:30],
                }
            ]
            if source["chunks"]
            else []
        )
        return {
            "answer": "虚拟机是对计算机资源的抽象，可为操作系统提供隔离的运行环境。",
            "citations": citations,
        }

    monkeypatch.setattr(chat, "call_deepseek", model)


def test_direct_question_without_sources_followup_refresh_and_privacy(
    clients, monkeypatch
):
    t, a, b = clients
    calls = []
    stub(monkeypatch, calls)
    question = {
        "question": "为什么虚拟机能运行不同操作系统？",
        "request_key": "chat-question-request-01",
    }
    r = a.post(BASE + "/ask", json=question)
    assert r.status_code == 200, r.text
    first = r.json()
    assert first["body"]["basis"] == "general"
    assert first["body"]["answer"]
    assert "modules" not in first["body"]
    assert a.post(BASE + "/ask", json=question).json()["id"] == first["id"]
    assert len(calls) == 1
    q2 = {
        "question": "那它和真实计算机有什么区别？",
        "parent_id": first["id"],
        "request_key": "chat-followup-request-02",
    }
    r = a.post(BASE + "/ask", json=q2)
    assert r.status_code == 200
    assert calls[-1]["question"] == q2["question"]
    assert calls[-1]["conversation"][0]["content"] == question["question"]
    assert len(r.json()["body"]["conversation"]) == 4
    assert a.get(BASE + f'/jobs/{r.json()["id"]}').json()["body"]["answer"]
    assert b.get(BASE + f'/jobs/{first["id"]}').status_code == 404
    assert (
        b.post(
            BASE + "/ask", json={**q2, "request_key": "other-student-chat-02"}
        ).status_code
        == 404
    )
    assert t.post(BASE + "/ask", json=question).status_code == 403


def test_question_retrieval_uses_current_question_and_general_fallback(
    clients, monkeypatch
):
    _, a, b = clients
    config, _ = prepared(a)
    calls = []
    stub(monkeypatch, calls)
    r = a.post(
        BASE + "/ask",
        json={
            "question": "解释进程与线程的资源共享",
            "sources": config["sources"],
            "request_key": "chat-with-documents-01",
        },
    )
    assert r.status_code == 200, r.text
    assert calls[-1]["question"] == "解释进程与线程的资源共享"
    assert r.json()["body"]["basis"] == "selected_sources"
    assert r.json()["body"]["citations"]
    other = a.post(
        BASE + "/ask",
        json={
            "question": "zxqv 专业术语说明",
            "sources": config["sources"],
            "request_key": "chat-no-matching-doc-01",
        },
    )
    assert other.status_code == 200, other.text
    assert other.json()["body"]["basis"] == "general"
    assert other.json()["sources"]["warnings"]
    assert (
        b.post(
            BASE + "/ask",
            json={
                "question": "解释进程",
                "sources": config["sources"],
                "request_key": "chat-private-file-01",
            },
        ).status_code
        == 404
    )


def test_chat_through_http_provider_is_answer_contract_not_modules(
    clients, monkeypatch
):
    _, a, _ = clients
    original = httpx.AsyncClient

    def handle(request):
        content = json.loads(request.content)
        prompt = content["messages"][0]["content"]
        assert "不要生成课程大纲" in prompt
        assert json.loads(content["messages"][1]["content"])["question"] == "解释虚拟机"
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {
                            "content": json.dumps(
                                {
                                    "answer": "虚拟机通过抽象资源提供运行环境。",
                                    "citations": [],
                                }
                            )
                        },
                    }
                ]
            },
        )

    monkeypatch.setattr(
        ai_questions.httpx,
        "AsyncClient",
        lambda **kw: original(transport=httpx.MockTransport(handle), **kw),
    )
    r = a.post(
        BASE + "/ask",
        json={"question": "解释虚拟机", "request_key": "chat-http-provider-01"},
    )
    assert r.status_code == 200, r.text
    assert "虚拟机" in r.json()["body"]["answer"]


def test_followup_can_reference_existing_learning_artifact(clients, monkeypatch):
    from test_personal_learning import fake_model

    _, a, _ = clients
    config, _ = prepared(a)
    config["modes"] = ["explain"]
    fake_model(monkeypatch, [])
    parent = a.post(BASE + "/generate", json=config)
    assert parent.status_code == 200
    calls = []
    stub(monkeypatch, calls)
    response = a.post(
        BASE + "/ask",
        json={
            "question": "刚才提到的区别，换个例子解释",
            "parent_id": parent.json()["id"],
            "request_key": "chat-artifact-followup-01",
        },
    )
    assert response.status_code == 200, response.text
    assert "进程与线程" in calls[0]["learning_context"]
    assert response.json()["body"]["basis"] == "general"


def test_provider_failure_is_saved_as_failed_not_empty_success(clients, monkeypatch):
    from fastapi import HTTPException

    _, a, _ = clients

    async def fail(*args, **kwargs):
        raise HTTPException(502, "AI问答正文无效")

    monkeypatch.setattr(chat, "call_deepseek", fail)
    response = a.post(
        BASE + "/ask",
        json={"question": "解释虚拟机", "request_key": "chat-failed-record-01"},
    )
    assert response.status_code == 502
    job = a.get(BASE + "/jobs").json()[0]
    assert job["status"] == "failed"
    assert a.get(BASE + f'/jobs/{job["id"]}').json()["error"] == "AI问答正文无效"
