"""Argon2 密码哈希 + 服务端可撤销会话；无生产默认密码。"""

import hashlib
import os
import secrets
import time
from typing import Literal
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, InvalidHashError
from fastapi import APIRouter, Depends, HTTPException, Request, Response, Header
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/auth")
password_hasher = PasswordHasher()
DUMMY_HASH = password_hasher.hash(secrets.token_urlsafe(32))
COOKIE = "os_session"


def database():
    from .main import database as context

    return context()


def create_user(
    username: str, password: str, role: Literal["teacher", "student"]
) -> int:
    username = username.strip()
    if (
        not username
        or len(username) > 80
        or not 12 <= len(password) <= 128
        or role not in ("teacher", "student")
    ):
        raise ValueError("用户名 1–80 字，密码 12–128 字，角色 teacher/student")
    hashed = password_hasher.hash(password)
    with database() as db:
        cur = db.execute(
            "INSERT INTO users(username,password_hash,role) VALUES (?,?,?)",
            (username, hashed, role),
        )
        return cur.lastrowid


def check_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    allowed = set(
        os.getenv(
            "APP_ORIGINS",
            "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:8000,http://localhost:8000",
        ).split(",")
    )
    if origin and origin not in allowed:
        raise HTTPException(403, "不允许的请求来源")


def require_user(
    request: Request,
    csrf_header: str | None = Header(default=None, alias="X-CSRF-Token"),
) -> dict | None:
    if request.url.path in ("/api/health", "/api/auth/login"):
        return None
    token = request.cookies.get(COOKIE, "")
    if not token:
        raise HTTPException(401, "请先登录")
    digest = hashlib.sha256(token.encode()).hexdigest()
    with database() as db:
        row = db.execute(
            "SELECT u.id,u.username,u.role,s.csrf_token FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1",
            (digest, int(time.time())),
        ).fetchone()
    if not row:
        raise HTTPException(401, "登录已过期，请重新登录")
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        check_origin(request)
        if not secrets.compare_digest(csrf_header or "", row["csrf_token"]):
            raise HTTPException(403, "请求校验失效，请刷新页面重试")
    return dict(row)


def teacher(user: dict = Depends(require_user)) -> dict:
    if not user or user["role"] != "teacher":
        raise HTTPException(403, "仅教师可执行此操作")
    return user


class Login(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=128)


@router.post("/login")
def login(body: Login, request: Request, response: Response):
    check_origin(request)
    with database() as db:
        row = db.execute(
            "SELECT * FROM users WHERE username=?", (body.username.strip(),)
        ).fetchone()
        try:
            valid = password_hasher.verify(
                row["password_hash"] if row else DUMMY_HASH, body.password
            )
        except (VerificationError, InvalidHashError):
            valid = False
        if not row or not valid or not row["active"]:
            raise HTTPException(401, "用户名或密码错误")
        if password_hasher.check_needs_rehash(row["password_hash"]):
            db.execute(
                "UPDATE users SET password_hash=? WHERE id=?",
                (password_hasher.hash(body.password), row["id"]),
            )
        # 登录时撤销当前浏览器旧会话，避免切换用户后旧令牌仍有效。
        old = request.cookies.get(COOKIE)
        if old:
            db.execute(
                "DELETE FROM sessions WHERE token_hash=?",
                (hashlib.sha256(old.encode()).hexdigest(),),
            )
        db.execute("DELETE FROM sessions WHERE expires_at<=?", (int(time.time()),))
        token = secrets.token_urlsafe(32)
        csrf = secrets.token_urlsafe(32)
        db.execute(
            "INSERT INTO sessions VALUES (?,?,?,?)",
            (
                hashlib.sha256(token.encode()).hexdigest(),
                row["id"],
                csrf,
                int(time.time()) + 8 * 3600,
            ),
        )
    response.set_cookie(
        COOKIE,
        token,
        max_age=8 * 3600,
        httponly=True,
        samesite="strict",
        secure=os.getenv("COOKIE_SECURE", "false").lower() == "true",
        path="/api",
    )
    response.headers["Cache-Control"] = "no-store"
    return {
        "id": row["id"],
        "username": row["username"],
        "role": row["role"],
        "csrf_token": csrf,
    }


@router.get("/me")
def me(response: Response, user: dict = Depends(require_user)):
    response.headers["Cache-Control"] = "no-store"
    return user


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, user: dict = Depends(require_user)):
    digest = hashlib.sha256(request.cookies[COOKIE].encode()).hexdigest()
    with database() as db:
        db.execute("DELETE FROM sessions WHERE token_hash=?", (digest,))
    response.delete_cookie(COOKIE, path="/api")
