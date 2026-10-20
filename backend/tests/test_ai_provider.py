"""Exercise the actual provider adapter; no live model calls or real keys."""

import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException
from app import ai_questions as ai


def invoke(monkeypatch, response, base="https://api.deepseek.com"):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-only-secret")
    monkeypatch.setenv("DEEPSEEK_BASE_URL", base)
    monkeypatch.setenv("DEEPSEEK_MODEL", "deepseek-chat")
    original = httpx.AsyncClient
    seen = []

    def handler(request):
        seen.append(request)
        if isinstance(response, Exception):
            raise response
        return response

    monkeypatch.setattr(
        ai.httpx,
        "AsyncClient",
        lambda **kw: original(transport=httpx.MockTransport(handler), **kw),
    )
    result = asyncio.run(
        ai.call_deepseek(
            SimpleNamespace(),
            {},
            system_prompt="Return JSON",
            payload={"task": "learning"},
        )
    )
    return result, seen


def completion(content, **extra):
    return httpx.Response(
        200,
        json={
            "choices": [
                {"finish_reason": "stop", "message": {"content": content}, **extra}
            ]
        },
    )


@pytest.mark.parametrize(
    "base",
    [
        "https://api.deepseek.com",
        "https://api.deepseek.com/v1",
        " https://api.deepseek.com/v1/chat/completions/ ",
    ],
)
@pytest.mark.parametrize("style", ["json", "fenced", "blocks"])
def test_provider_json_and_url_compatibility(monkeypatch, base, style):
    text = json.dumps({"title": "知识讲解", "modules": []}, ensure_ascii=False)
    content = {
        "json": text,
        "fenced": "```json\n" + text + "\n```",
        "blocks": [{"type": "text", "text": text}],
    }[style]
    result, seen = invoke(monkeypatch, completion(content), base)
    assert result["title"] == "知识讲解"
    assert str(seen[0].url).count("/chat/completions") == 1
    assert seen[0].headers["Authorization"] == "Bearer test-only-secret"


@pytest.mark.parametrize(
    "response,detail,status",
    [
        (httpx.Response(404, text="test-only-secret"), "404", 502),
        (httpx.Response(400, text="test-only-secret"), "参数", 502),
        (httpx.Response(503, text="test-only-secret"), "503", 502),
        (httpx.Response(200, text="<html>test-only-secret</html>"), "未返回JSON", 502),
        (
            httpx.Response(200, json={"error": "test-only-secret"}),
            "choices/message",
            502,
        ),
        (completion(None), "最终正文", 502),
        (completion("not valid JSON test-only-secret"), "不是有效JSON", 502),
        (completion("[]"), "JSON对象", 502),
        (completion("{}", finish_reason="length"), "截断", 502),
        (httpx.ConnectError("test-only-secret"), "连接", 502),
        (httpx.ReadTimeout("test-only-secret"), "超时", 504),
    ],
)
def test_provider_errors_identify_stage_without_leaking_response(
    monkeypatch, response, detail, status
):
    with pytest.raises(HTTPException) as error:
        invoke(monkeypatch, response)
    assert error.value.status_code == status
    assert detail in error.value.detail
    assert "test-only-secret" not in error.value.detail
