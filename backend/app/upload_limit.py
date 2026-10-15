"""在 multipart 解析前限制请求体，避免任意大小的上传落到临时磁盘。"""

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Scope, Receive, Send


class UploadLimitMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["path"] != "/api/materials/upload":
            await self.app(scope, receive, send)
            return
        # 10 MB 文件外给 multipart 字段留 1 MB；文件本身仍受独立 10 MB 限制。
        limit = 11 * 1024 * 1024
        chunks: list[bytes] = []
        size = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > limit:
                await JSONResponse(
                    {"detail": "上传请求过大，文件上限为 10 MB"}, status_code=413
                )(scope, receive, send)
                return
            chunks.append(chunk)
            if not message.get("more_body", False):
                break

        async def replay():
            if chunks:
                chunk = chunks.pop(0)
                return {
                    "type": "http.request",
                    "body": chunk,
                    "more_body": bool(chunks),
                }
            return await receive()

        await self.app(scope, replay, send)
