import os
import re
import json
from urllib.parse import urlparse
import httpx
from fastapi import HTTPException

def provider_settings():
    key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    base = (
        os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").strip().rstrip("/")
    )
    model = os.getenv("DEEPSEEK_MODEL", "deepseek-chat").strip()
    if not key:
        raise HTTPException(
            503,
            "尚未配置DeepSeek服务，请在后端.env设置DEEPSEEK_API_KEY并重启；不要在网页填写密钥",
        )
    parsed = urlparse(base)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise HTTPException(
            503, "DEEPSEEK_BASE_URL需为不带凭据、查询参数或片段的HTTPS服务地址"
        )
    if not model:
        raise HTTPException(503, "DEEPSEEK_MODEL不能为空，建议使用deepseek-chat")
    return key, base, model


async def call_deepseek(body, preview, *, system_prompt=None, payload=None):
    key, base, model = provider_settings()
    if system_prompt is None or payload is None:
        raise HTTPException(500, "AI调用必须提供明确任务与输入")
    user = payload
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(90, connect=10)) as client:
            response = await client.post(
                (
                    base
                    if base.endswith("/chat/completions")
                    else base + "/chat/completions"
                ),
                headers={"Authorization": f"Bearer {key}"},
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {
                            "role": "user",
                            "content": json.dumps(user, ensure_ascii=False),
                        },
                    ],
                    "response_format": {"type": "json_object"},
                    "max_tokens": 8000,
                    "temperature": 0.3,
                },
            )
            if response.status_code in (401, 403):
                raise HTTPException(502, "DeepSeek认证失败，请检查后端密钥或模型权限")
            if response.status_code == 402:
                raise HTTPException(502, "DeepSeek账户余额不足，请检查服务商账户")
            if response.status_code == 429:
                raise HTTPException(503, "DeepSeek请求繁忙或达到限额，请稍后手动重试")
            if response.status_code == 404:
                raise HTTPException(
                    502,
                    "DeepSeek接口地址或模型不存在（HTTP 404）。检查DEEPSEEK_BASE_URL，官方地址可填https://api.deepseek.com或https://api.deepseek.com/v1，并检查DEEPSEEK_MODEL。",
                )
            if response.status_code in (400, 422):
                raise HTTPException(
                    502,
                    f"DeepSeek拒绝请求参数（HTTP {response.status_code}）。请检查模型名称及服务是否支持JSON输出，建议官方deepseek-chat。",
                )
            if not response.is_success:
                raise HTTPException(
                    502,
                    f"DeepSeek服务返回HTTP {response.status_code}，本次未获得可用内容；请稍后手动重试。",
                )
            if len(response.content) > 1024**2:
                raise HTTPException(
                    502, "DeepSeek响应超过1MiB，请缩小资料范围或减少生成数量。"
                )
            try:
                data = response.json()
            except ValueError:
                raise HTTPException(
                    502, "DeepSeek服务未返回JSON响应，请检查服务地址、代理或网关配置。"
                ) from None
            try:
                choice = data["choices"][0]
                message = choice["message"]
            except (KeyError, IndexError, TypeError):
                raise HTTPException(
                    502,
                    "DeepSeek响应缺少choices/message，请确认配置的是OpenAI兼容的聊天API地址。",
                ) from None
            if not isinstance(choice, dict) or not isinstance(message, dict):
                raise HTTPException(502, "DeepSeek响应中的message结构无效。")
            if choice.get("finish_reason") == "length":
                raise HTTPException(
                    502,
                    "模型输出被截断，请缩小资料范围或减少生成数量；建议使用deepseek-chat。",
                )
            if choice.get("finish_reason") in ("content_filter", "error"):
                raise HTTPException(
                    502, "模型未正常完成内容生成，本次结果未保存为可用内容。"
                )
            text = message.get("content")
            if isinstance(text, list):
                # Some compatible providers return text blocks; reject non-text payloads.
                if all(
                    isinstance(block, dict)
                    and block.get("type") == "text"
                    and isinstance(block.get("text"), str)
                    for block in text
                ):
                    text = "".join(block["text"] for block in text)
            if not isinstance(text, str) or not text.strip():
                raise HTTPException(
                    502,
                    "DeepSeek没有返回最终正文（content为空或无效）。推理模型需完成最终回答，建议改用deepseek-chat；未把推理过程当学习内容。",
                )
            text = text.strip().lstrip("\ufeff")
            fenced = re.fullmatch(
                r"```(?:json)?\s*\n?([\s\S]*?)\n?```", text, flags=re.IGNORECASE
            )
            if fenced:
                text = fenced.group(1).strip()
            try:
                output = json.loads(text)
            except ValueError:
                raise HTTPException(
                    502,
                    "DeepSeek正文不是有效JSON，无法生成可交互内容；请缩小范围后手动重试。模型原文未直接执行或展示。",
                ) from None
            if not isinstance(output, dict):
                raise HTTPException(
                    502,
                    "DeepSeek正文需要JSON对象，而不是数组或纯文本，请检查模型的结构化输出能力。",
                )
            return output
    except httpx.TimeoutException:
        raise HTTPException(
            504, "DeepSeek生成超时，未自动重试；请先检查任务记录再决定是否重新生成"
        ) from None
    except httpx.RequestError:
        raise HTTPException(
            502,
            "后端无法连接DeepSeek（网络、代理或TLS连接失败）。请检查运行后端的电脑/服务器能否访问服务地址。",
        ) from None
