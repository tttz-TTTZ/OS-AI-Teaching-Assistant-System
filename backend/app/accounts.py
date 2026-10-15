"""教师可管理学生；被本地管理员明确授权的管理员可管理教师。"""

import sqlite3
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from .auth import teacher, password_hasher, database

router = APIRouter(prefix="/api/teacher/accounts", dependencies=[Depends(teacher)])


class NewAccount(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=12, max_length=128)
    role: Literal["student", "teacher"] = "student"


class AccountStatus(BaseModel):
    active: bool


class ResetPassword(BaseModel):
    password: str = Field(min_length=12, max_length=128)


def target_user(db, user: dict, user_id: int):
    row = db.execute(
        "SELECT id,username,role,active,is_admin,created_at FROM users WHERE id=?",
        (user_id,),
    ).fetchone()
    if not row or (row["role"] == "teacher" and not user["is_admin"]):
        raise HTTPException(404, "账号不存在或不在可管理范围")
    return dict(row)


@router.get("")
def accounts(
    q: str = "", limit: int = 50, offset: int = 0, user: dict = Depends(teacher)
):
    if not 1 <= limit <= 100 or offset < 0 or len(q) > 80:
        raise HTTPException(422, "分页或搜索条件无效")
    with database() as db:
        return [
            dict(r)
            for r in db.execute(
                "SELECT id,username,role,active,is_admin,created_at FROM users WHERE (? OR role='student') AND instr(username,?)>0 ORDER BY id LIMIT ? OFFSET ?",
                (user["is_admin"], q, limit, offset),
            )
        ]


@router.post("", status_code=201)
def create(body: NewAccount, user: dict = Depends(teacher)):
    if body.role == "teacher" and not user["is_admin"]:
        raise HTTPException(403, "只有被授权的管理员可以创建教师")
    username = body.username.strip()
    if not username:
        raise HTTPException(422, "用户名不能为空")
    hashed = password_hasher.hash(body.password)
    try:
        with database() as db:
            cur = db.execute(
                "INSERT INTO users(username,password_hash,role) VALUES (?,?,?)",
                (username, hashed, body.role),
            )
            db.execute(
                "INSERT INTO account_audit(actor_id,target_id,action) VALUES (?,?,'create')",
                (user["id"], cur.lastrowid),
            )
            return target_user(db, user, cur.lastrowid)
    except sqlite3.IntegrityError:
        raise HTTPException(409, "用户名已存在") from None


@router.put("/{user_id}/status")
def status(user_id: int, body: AccountStatus, user: dict = Depends(teacher)):
    with database() as db:
        row = target_user(db, user, user_id)
        if user_id == user["id"]:
            raise HTTPException(409, "不能停用自己")
        if (
            not body.active
            and row["is_admin"]
            and db.execute(
                "SELECT count(*) FROM users WHERE active=1 AND is_admin=1"
            ).fetchone()[0]
            <= 1
        ):
            raise HTTPException(409, "必须保留至少一名启用的管理员")
        db.execute("UPDATE users SET active=? WHERE id=?", (body.active, user_id))
        if not body.active:
            db.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
        db.execute(
            "INSERT INTO account_audit(actor_id,target_id,action) VALUES (?,?,?)",
            (user["id"], user_id, "enable" if body.active else "disable"),
        )
        return target_user(db, user, user_id)


@router.post("/{user_id}/password", status_code=204)
def reset(user_id: int, body: ResetPassword, user: dict = Depends(teacher)):
    hashed = password_hasher.hash(body.password)
    with database() as db:
        target_user(db, user, user_id)
        if user_id == user["id"]:
            raise HTTPException(409, "修改本人密码请使用个人账号页面")
        db.execute("UPDATE users SET password_hash=? WHERE id=?", (hashed, user_id))
        db.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
        db.execute(
            "INSERT INTO account_audit(actor_id,target_id,action) VALUES (?,?,'reset_password')",
            (user["id"], user_id),
        )
