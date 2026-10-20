"""实验教学内容与计算引擎分离，发布修订不可变，运行记录只给本人。"""

import json
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, ConfigDict, model_validator
from .auth import teacher, require_user
from .access import visible_chapter
from .digital import database, get, view_point
from .scheduling import Algorithm, ScheduleInput, TEMPLATES, calculate

router = APIRouter(prefix="/api")


class ExperimentInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=200)
    algorithm: Algorithm
    chapter_id: int
    knowledge_ids: list[int] = Field(default_factory=list, max_length=50)
    objectives: str = Field(default="", max_length=5000)
    instructions: str = Field(default="", max_length=10000)
    tasks: str = Field(default="", max_length=10000)
    reference: str = Field(default="", max_length=10000)
    defaults: ScheduleInput
    edit_version: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def clean(self):
        self.title = self.title.strip()
        if not self.title:
            raise ValueError("标题不能为空")
        self.knowledge_ids = list(dict.fromkeys(self.knowledge_ids))
        return self


class Version(BaseModel):
    edit_version: int = Field(ge=0)


class RunInput(ScheduleInput):
    revision_id: int = Field(gt=0)


class Observation(BaseModel):
    observation: str = Field(min_length=1, max_length=5000)

    @model_validator(mode="after")
    def clean(self):
        if not self.observation.strip():
            raise ValueError("请填写实验观察")
        return self


def revision(db, ident):
    row = get(db, "experiment_revisions", ident)
    return json.loads(row["body"])


def expose(db, row, user, draft=False):
    rid = row["draft_revision_id"] if draft else row["published_revision_id"]
    if not rid:
        raise HTTPException(404, "实验尚未发布或已撤回")
    body = revision(db, rid)
    if not draft:
        visible_chapter(db, body["chapter_id"], user)
    links = []
    for kid in body["knowledge_ids"]:
        try:
            point = view_point(db, get(db, "knowledge_points", kid), user)
            links.append(
                dict(id=kid, chapter_id=point["chapter_id"], title=point["title"])
            )
        except HTTPException:
            pass
    return {
        **body,
        "id": row["id"],
        "revision_id": rid,
        "edit_version": row["edit_version"],
        "published": bool(row["published_revision_id"]),
        "has_unpublished_changes": row["draft_revision_id"]
        != row["published_revision_id"],
        "related": links,
    }


def checked(db, ident, version):
    row = get(db, "experiments", ident)
    if row["edit_version"] != version:
        raise HTTPException(409, "实验已在其他页面更新，请保留修改后重新读取")
    return row


def validate_refs(db, body, user):
    visible_chapter(db, body.chapter_id, user)
    for kid in body.knowledge_ids:
        point = get(db, "knowledge_points", kid)
        visible_chapter(db, point["chapter_id"], user)
        if point["archived_at"]:
            raise HTTPException(422, "不能关联已归档知识点")
    calculate(body.algorithm, body.defaults)


def save(db, ident, body, user):
    validate_refs(db, body, user)
    rid = db.execute(
        "INSERT INTO experiment_revisions(experiment_id,body,author_id) VALUES(?,?,?)",
        (
            ident,
            json.dumps(body.model_dump(exclude={"edit_version"}), ensure_ascii=False),
            user["id"],
        ),
    ).lastrowid
    db.execute(
        "UPDATE experiments SET title=?,draft_revision_id=?,edit_version=edit_version+1 WHERE id=?",
        (body.title, rid, ident),
    )
    return expose(db, get(db, "experiments", ident), user, True)


@router.get("/experiment-templates")
def templates():
    return TEMPLATES


@router.get("/teacher/experiments")
def teacher_list(user=Depends(teacher)):
    with database() as db:
        return [
            expose(db, dict(r), user, True)
            for r in db.execute("SELECT * FROM experiments ORDER BY id DESC")
        ]


@router.post("/teacher/experiments", status_code=201)
def create(body: ExperimentInput, user=Depends(teacher)):
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        ident = db.execute(
            "INSERT INTO experiments(title) VALUES(?)", (body.title,)
        ).lastrowid
        return save(db, ident, body, user)


@router.get("/teacher/experiments/{ident}")
def teacher_detail(ident: int, user=Depends(teacher)):
    with database() as db:
        return expose(db, get(db, "experiments", ident), user, True)


@router.put("/teacher/experiments/{ident}")
def update(ident: int, body: ExperimentInput, user=Depends(teacher)):
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        checked(db, ident, body.edit_version)
        return save(db, ident, body, user)


@router.post("/teacher/experiments/{ident}/preview")
def preview(ident: int, body: Version, user=Depends(teacher)):
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        row = checked(db, ident, body.edit_version)
        data = revision(db, row["draft_revision_id"])
        result = calculate(data["algorithm"], ScheduleInput(**data["defaults"]))
        db.execute(
            "INSERT OR IGNORE INTO experiment_previews VALUES(?,?)",
            (user["id"], row["draft_revision_id"]),
        )
        return result


@router.post("/teacher/experiments/{ident}/publish")
def publish(ident: int, body: Version, user=Depends(teacher)):
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        row = checked(db, ident, body.edit_version)
        data = revision(db, row["draft_revision_id"])
        chapter = visible_chapter(db, data["chapter_id"], user)
        if not chapter["published"] or not chapter["course_published"]:
            raise HTTPException(422, "请先发布所属课程和章节")
        if not all(data[k].strip() for k in ["objectives", "instructions", "tasks"]):
            raise HTTPException(422, "请补齐学习目标、操作说明和观察任务")
        if not db.execute(
            "SELECT 1 FROM experiment_previews WHERE user_id=? AND revision_id=?",
            (user["id"], row["draft_revision_id"]),
        ).fetchone():
            raise HTTPException(422, "请先试运行当前草稿")
        db.execute(
            "UPDATE experiments SET published_revision_id=draft_revision_id,edit_version=edit_version+1 WHERE id=?",
            (ident,),
        )
        return expose(db, get(db, "experiments", ident), user, True)


@router.post("/teacher/experiments/{ident}/withdraw")
def withdraw(ident: int, body: Version, user=Depends(teacher)):
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        checked(db, ident, body.edit_version)
        db.execute(
            "UPDATE experiments SET published_revision_id=NULL,edit_version=edit_version+1 WHERE id=?",
            (ident,),
        )
        return expose(db, get(db, "experiments", ident), user, True)


@router.get("/experiments")
def experiments(
    knowledge_id: int | None = None,
    algorithm: Algorithm | None = None,
    user=Depends(require_user),
):
    with database() as db:
        if knowledge_id:
            view_point(db, get(db, "knowledge_points", knowledge_id), user)
        result = []
        for row in db.execute(
            "SELECT * FROM experiments WHERE published_revision_id IS NOT NULL ORDER BY id DESC"
        ):
            try:
                data = expose(db, dict(row), user)
                if (not knowledge_id or knowledge_id in data["knowledge_ids"]) and (
                    not algorithm or algorithm == data["algorithm"]
                ):
                    result.append(data)
            except HTTPException:
                pass
        return result


@router.get("/experiments/{ident}")
def detail(ident: int, user=Depends(require_user)):
    with database() as db:
        return expose(db, get(db, "experiments", ident), user)


@router.post("/experiments/{ident}/runs", status_code=201)
def run(ident: int, body: RunInput, user=Depends(require_user)):
    if user["role"] != "student":
        raise HTTPException(403, "教师请使用试运行，不写入学生记录")
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        data = expose(db, get(db, "experiments", ident), user)
        if body.revision_id != data["revision_id"]:
            raise HTTPException(409, "实验已更新，请返回列表重新进入；输入可先复制保留")
        result = calculate(data["algorithm"], body)
        ident_run = db.execute(
            "INSERT INTO experiment_runs(user_id,experiment_id,revision_id,engine_version,input_json,result_json) VALUES(?,?,?,?,?,?)",
            (
                user["id"],
                ident,
                data["revision_id"],
                result["engine_version"],
                json.dumps(body.model_dump()),
                json.dumps(result),
            ),
        ).lastrowid
        return {"id": ident_run, "result": result, "revision_id": data["revision_id"]}


@router.get("/my/experiment-runs")
def runs(
    experiment_id: int | None = None,
    limit: int = Query(default=20, ge=1, le=100),
    user=Depends(require_user),
):
    with database() as db:
        return [
            dict(r)
            for r in db.execute(
                "SELECT id,experiment_id,revision_id,completed_at,created_at,observation FROM experiment_runs WHERE user_id=? AND (? IS NULL OR experiment_id=?) ORDER BY id DESC LIMIT ?",
                (user["id"], experiment_id, experiment_id, limit),
            )
        ]


@router.get("/my/experiment-runs/{ident}")
def read_run(ident: int, user=Depends(require_user)):
    with database() as db:
        row = db.execute(
            "SELECT * FROM experiment_runs WHERE id=? AND user_id=?",
            (ident, user["id"]),
        ).fetchone()
        if not row:
            raise HTTPException(404, "运行记录不存在")
        data = dict(row)
        inp = json.loads(data.pop("input_json"))
        result = json.loads(data.pop("result_json"))
        return {
            **data,
            "input": inp,
            "result": result,
            "experiment": revision(db, row["revision_id"]),
        }


@router.put("/my/experiment-runs/{ident}/observation")
def observation(ident: int, body: Observation, user=Depends(require_user)):
    with database() as db:
        row = db.execute(
            "SELECT * FROM experiment_runs WHERE id=? AND user_id=?",
            (ident, user["id"]),
        ).fetchone()
        if not row:
            raise HTTPException(404, "运行记录不存在")
        db.execute(
            "UPDATE experiment_runs SET observation=?,completed_at=CURRENT_TIMESTAMP WHERE id=?",
            (body.observation.strip(), ident),
        )
        return {"message": "实验观察已保存；完成任务不代表已经掌握"}
