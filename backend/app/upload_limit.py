"""认证后限制请求体，磁盘暂存代替将大教材整包保存在内存。"""

import tempfile
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Scope, Receive, Send
from fastapi import HTTPException


class UploadLimitMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        is_upload = (
            scope["type"] == "http"
            and scope["method"] == "POST"
            and (
                scope["path"]
                in ("/api/materials/upload", "/api/teacher/learning-assets")
                or (
                    scope["path"].startswith("/api/materials/")
                    and scope["path"].endswith("/replace")
                )
            )
        )
        if not is_upload:
            await self.app(scope, receive, send)
            return
        from .auth import require_user
        from .files import PUBLIC_MAX_SIZE, MAX_SIZE

        request = Request(scope)
        try:
            user = require_user(request, request.headers.get("x-csrf-token"))
        except HTTPException as exc:
            await JSONResponse({"detail": exc.detail}, status_code=exc.status_code)(
                scope, receive, send
            )
            return
        maximum = (
            PUBLIC_MAX_SIZE if user["role"] == "teacher" else MAX_SIZE
        ) + 1024 * 1024
        if scope["path"] == "/api/teacher/learning-assets":
            if user["role"] != "teacher":
                await JSONResponse({"detail": "仅教师可上传教学图片"}, status_code=403)(
                    scope, receive, send
                )
                return
            maximum = 11 * 1024 * 1024
        size = 0
        with tempfile.TemporaryFile() as body:
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return
                chunk = message.get("body", b"")
                size += len(chunk)
                if size > maximum:
                    await JSONResponse(
                        {"detail": "上传请求超过大小上限"}, status_code=413
                    )(scope, receive, send)
                    return
                body.write(chunk)
                if not message.get("more_body", False):
                    break
            body.seek(0)
            remaining = size
            finished = False

            async def replay():
                nonlocal remaining, finished
                if not finished:
                    chunk = body.read(min(65536, remaining))
                    remaining -= len(chunk)
                    finished = remaining == 0
                    return {
                        "type": "http.request",
                        "body": chunk,
                        "more_body": remaining > 0,
                    }
                return await receive()

            await self.app(scope, replay, send)
