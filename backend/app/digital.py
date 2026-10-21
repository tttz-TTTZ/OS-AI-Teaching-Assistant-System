"""结构化教材、不可变修订、发布与本人进度。旧知识点按需升级，不改写原内容。"""

import json
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator, ConfigDict
from .auth import teacher, require_user
from .access import visible_chapter, document_visible

router = APIRouter(prefix="/api")


def database():
    from .main import database

    return database()


def get(db, table, ident):
    # 仅服务端常量表名可调用。
    row = db.execute(f"SELECT * FROM {table} WHERE id=?", (ident,)).fetchone()
    if not row:
        raise HTTPException(404, "内容不存在")
    return dict(row)


class Section(BaseModel):
    chapter_id: int
    code: str = Field(default="", max_length=80)
    title: str = Field(min_length=1, max_length=200)
    sort_order: int = Field(default=0, ge=0, le=100000)
    published: bool = False


@router.get("/sections")
def sections(chapter_id: int | None = None, user=Depends(require_user)):
    with database() as db:
        rows = db.execute(
            "SELECT s.* FROM sections s JOIN chapters c ON c.id=s.chapter_id WHERE (? IS NULL OR s.chapter_id=?) ORDER BY c.sort_order,s.sort_order,s.id",
            (chapter_id, chapter_id),
        ).fetchall()
        result = []
        for r in rows:
            try:
                visible_chapter(db, r["chapter_id"], user)
                if user["role"] == "teacher" or r["published"]:
                    result.append(dict(r))
            except HTTPException:
                pass
        return result


@router.post("/teacher/sections", status_code=201)
def add_section(body: Section, user=Depends(teacher)):
    with database() as db:
        visible_chapter(db, body.chapter_id, user)
        if not body.title.strip():
            raise HTTPException(422, "小节标题不能为空")
        ident = db.execute(
            "INSERT INTO sections(chapter_id,code,title,sort_order,published) VALUES (?,?,?,?,?)",
            (
                body.chapter_id,
                body.code,
                body.title.strip(),
                body.sort_order,
                body.published,
            ),
        ).lastrowid
        return get(db, "sections", ident)


@router.put("/teacher/sections/{ident}")
def update_section(ident: int, body: Section, user=Depends(teacher)):
    with database() as db:
        old = get(db, "sections", ident)
        if body.chapter_id != old["chapter_id"]:
            raise HTTPException(422, "小节不能跨章移动；请调整知识点归属")
        if not body.title.strip():
            raise HTTPException(422, "小节标题不能为空")
        db.execute(
            "UPDATE sections SET code=?,title=?,sort_order=?,published=? WHERE id=?",
            (body.code, body.title.strip(), body.sort_order, body.published, ident),
        )
        return get(db, "sections", ident)


class Config(BaseModel):
    model_config = ConfigDict(extra="forbid")
    template: Literal[
        "memory",
        "timeshare",
        "printer",
        "layers",
        "perspectives",
        "goals",
        "resources",
        "roles",
        "concurrency",
        "race",
        "async",
        "history",
    ]
    capacity: int = Field(default=1024, ge=1, le=65536)
    allocation_a: int = Field(default=256, ge=0, le=65536)
    allocation_b: int = Field(default=256, ge=0, le=65536)
    allocation_c: int = Field(default=256, ge=0, le=65536)
    quantum: int = Field(default=2, ge=1, le=20)
    tasks: int = Field(default=3, ge=1, le=10)
    duration: int = Field(default=4, ge=1, le=20)
    cores: int = Field(default=1, ge=1, le=2)
    arrival_gap: int = Field(default=0, ge=0, le=10)
    io_delay: int = Field(default=3, ge=1, le=20)
    switch_cost: int = Field(default=0, ge=0, le=5)
    initial: int = Field(default=0, ge=0, le=1000)
    locked: bool = False
    interleaved: bool = True
    scenario: int = Field(default=0, ge=0, le=4)


class DiagramNode(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,80}$")
    label: str = Field(min_length=1, max_length=200)
    x: int = Field(ge=0, le=3000)
    y: int = Field(ge=0, le=3000)


class DiagramEdge(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: str
    target: str
    label: str = Field(min_length=1, max_length=200)
    direction: Literal["directed", "undirected", "unconfirmed"] = "directed"


class Diagram(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(max_length=80)
    title: str = Field(max_length=200)
    type: Literal["relation", "flow"]
    nodes: list[DiagramNode] = Field(min_length=1, max_length=40)
    edges: list[DiagramEdge] = Field(max_length=80)
    note: str = Field(default="", max_length=3000)

    @model_validator(mode="after")
    def valid_links(self):
        ids = {n.id for n in self.nodes}
        if len(ids) != len(self.nodes) or any(
            e.source not in ids or e.target not in ids for e in self.edges
        ):
            raise ValueError("图示节点ID重复或连线目标不存在")
        return self


class Block(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,80}$")
    kind: Literal[
        "intro",
        "concept",
        "explanation",
        "case",
        "mistake",
        "summary",
        "text",
        "interaction",
        "image",
        "chart",
        "diagram",
    ] = "text"
    title: str = Field(default="", max_length=200)
    text: str = Field(default="", max_length=50000)
    config: Config | None = None
    asset_id: int | None = None
    alt: str = Field(default="", max_length=500)
    labels: list[str] = Field(default_factory=list, max_length=20)
    values: list[float] = Field(default_factory=list, max_length=20)
    unit: str = Field(default="", max_length=40)
    diagram: Diagram | None = None

    @model_validator(mode="after")
    def validate_block(self):
        import math

        if any(not math.isfinite(v) or v < 0 for v in self.values) or any(
            len(s) > 100 for s in self.labels
        ):
            raise ValueError("图表标签最多100字，数值必须非负有限")
        if self.kind == "diagram" and not self.diagram:
            raise ValueError("图示块缺少结构化图示")
        return self


class Content(BaseModel):
    model_config = ConfigDict(extra="forbid")
    chapter_id: int
    section_id: int | None = None
    code: str = Field(default="", max_length=80)
    title: str = Field(min_length=1, max_length=200)
    summary: str = Field(default="", max_length=2000)
    sort_order: int = Field(default=0, ge=0, le=100000)
    minutes: int | None = Field(default=None, ge=1, le=600)
    emphasis: str = Field(default="", max_length=80)
    objectives: str = Field(default="", max_length=5000)
    source_title: str = Field(default="", max_length=500)
    # 页码为自由文本，允许罗马数字、区间、“待核对”，不预设教材章节。
    printed_pages: str = Field(default="", max_length=200)
    pdf_pages: str = Field(default="", max_length=200)
    source_note: str = Field(default="", max_length=3000)
    blocks: list[Block] = Field(default_factory=list, max_length=60)
    related_ids: list[int] = Field(default_factory=list, max_length=30)
    lab: bool = False
    expected_version: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def unique_blocks(self):
        if not self.title.strip() or len({b.id for b in self.blocks}) != len(
            self.blocks
        ):
            raise ValueError("标题不能为空，内容块ID不可重复")
        return self


def body_of(db, point, revision=None):
    if point["digital_managed"] and (revision or point["draft_revision_id"]):
        return json.loads(
            get(db, "knowledge_revisions", revision or point["draft_revision_id"])[
                "body"
            ]
        )
    return Content(
        chapter_id=point["chapter_id"],
        title=point["title"],
        blocks=[
            Block(id="legacy", kind="explanation", title="正文", text=point["content"])
        ],
        lab=bool(point["lab_path"]),
    ).model_dump(exclude={"expected_version"})


def view_point(db, point, user, preview=False):
    if point["archived_at"]:
        raise HTTPException(404, "知识点已归档")
    visible_chapter(db, point["chapter_id"], user)
    if user["role"] != "teacher" and not point["published"]:
        raise HTTPException(404, "知识点未发布")
    revision = point["draft_revision_id"] if preview else point["published_revision_id"]
    if point["digital_managed"] and not revision:
        raise HTTPException(404, "知识点没有发布版本")
    body = body_of(db, point, revision)
    if user["role"] != "teacher":
        from .reading import student_reading

        body = student_reading(body)
    if body.get("section_id"):
        section = get(db, "sections", body["section_id"])
        if user["role"] != "teacher" and not section["published"]:
            raise HTTPException(404, "小节未发布")
    return {
        **body,
        "id": point["id"],
        "revision_id": revision or 0,
        "edit_version": point["edit_version"],
        "published": bool(point["published"]),
        "managed": bool(point["digital_managed"]),
    }


def validate_refs(db, body, point_id=None):
    chapter = get(db, "chapters", body.chapter_id)
    if chapter["archived_at"]:
        raise HTTPException(422, "不能挂在已归档章节")
    if (
        body.section_id
        and get(db, "sections", body.section_id)["chapter_id"] != body.chapter_id
    ):
        raise HTTPException(422, "小节与章节不匹配")
    for ident in set(body.related_ids):
        if (
            ident == point_id
            or get(db, "chapters", get(db, "knowledge_points", ident)["chapter_id"])[
                "course_id"
            ]
            != chapter["course_id"]
        ):
            raise HTTPException(422, "关联知识点必须是同课程的其他知识点")
    for block in body.blocks:
        if block.asset_id:
            get(db, "knowledge_assets", block.asset_id)


def save_revision(db, point, body, user):
    validate_refs(db, body, point["id"])
    if (
        get(db, "chapters", body.chapter_id)["course_id"]
        != get(db, "chapters", point["chapter_id"])["course_id"]
    ):
        raise HTTPException(422, "不支持跨课程移动")
    data = body.model_dump(exclude={"expected_version"})
    cur = db.execute(
        "UPDATE knowledge_points SET edit_version=edit_version+1,digital_managed=1 WHERE id=? AND edit_version=?",
        (point["id"], body.expected_version),
    )
    if cur.rowcount != 1:
        raise HTTPException(409, "其他教师已修改，请重新加载；当前表单未被清空")
    revision = db.execute(
        "INSERT INTO knowledge_revisions(point_id,body,author_id) VALUES (?,?,?)",
        (point["id"], json.dumps(data, ensure_ascii=False), user["id"]),
    ).lastrowid
    # 第一次接管旧已发布内容时，保留其旧版本，不让保存草稿替换线上。
    if not point["digital_managed"] and point["published"]:
        old = db.execute(
            "INSERT INTO knowledge_revisions(point_id,body,author_id) VALUES (?,?,?)",
            (
                point["id"],
                json.dumps(body_of(db, point), ensure_ascii=False),
                user["id"],
            ),
        ).lastrowid
        db.execute(
            "UPDATE knowledge_points SET published_revision_id=? WHERE id=?",
            (old, point["id"]),
        )
    db.execute(
        "UPDATE knowledge_points SET draft_revision_id=? WHERE id=?",
        (revision, point["id"]),
    )
    for asset in {b.asset_id for b in body.blocks if b.asset_id}:
        db.execute("INSERT INTO revision_assets VALUES (?,?)", (revision, asset))
    return {
        **data,
        "id": point["id"],
        "revision_id": revision,
        "edit_version": body.expected_version + 1,
        "published": bool(point["published"]),
        "managed": True,
    }


@router.get("/teacher/learning-content")
def teacher_list(user=Depends(teacher)):
    with database() as db:
        return [
            {
                **body_of(db, dict(p)),
                "id": p["id"],
                "edit_version": p["edit_version"],
                "revision_id": p["draft_revision_id"] or 0,
                "published": bool(p["published"]),
                "archived": bool(p["archived_at"]),
            }
            for p in db.execute("SELECT * FROM knowledge_points ORDER BY chapter_id,id")
        ]


@router.post("/teacher/learning-content", status_code=201)
def create_content(body: Content, user=Depends(teacher)):
    with database() as db:
        validate_refs(db, body)
        ident = db.execute(
            "INSERT INTO knowledge_points(chapter_id,title,content,published) VALUES (?,?,?,0)",
            (body.chapter_id, body.title, ""),
        ).lastrowid
        return save_revision(db, get(db, "knowledge_points", ident), body, user)


@router.put("/teacher/learning-content/{ident}")
def edit_content(ident: int, body: Content, user=Depends(teacher)):
    with database() as db:
        return save_revision(db, get(db, "knowledge_points", ident), body, user)


class Action(BaseModel):
    expected_version: int = Field(ge=0)
    revision_id: int | None = None


@router.post("/teacher/learning-content/{ident}/{action}")
def change_publication(
    ident: int,
    action: Literal["publish", "withdraw", "restore", "archive"],
    body: Action,
    user=Depends(teacher),
):
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        point = get(db, "knowledge_points", ident)
        if point["edit_version"] != body.expected_version:
            raise HTTPException(409, "内容已变化，请重新加载")
        if action == "restore":
            revision = get(db, "knowledge_revisions", body.revision_id)
            if revision["point_id"] != ident:
                raise HTTPException(404, "版本不存在")
            return save_revision(
                db,
                point,
                Content(
                    **json.loads(revision["body"]),
                    expected_version=body.expected_version,
                ),
                user,
            )
        if action == "publish":
            data = Content(**body_of(db, point), expected_version=body.expected_version)
            validate_refs(db, data, ident)
            required = ["intro", "concept", "explanation", "case", "mistake", "summary"]
            missing = [
                k
                for k in required
                if not any(b.kind == k and b.text.strip() for b in data.blocks)
            ]
            if missing or not data.objectives.strip():
                names = {
                    "intro": "问题导入",
                    "concept": "核心概念",
                    "explanation": "原理精讲",
                    "case": "典型案例",
                    "mistake": "易错点",
                    "summary": "总结",
                }
                missing_names = [names[k] for k in missing]
                if not data.objectives.strip():
                    missing_names.insert(0, "学习目标")
                raise HTTPException(422, "发布前请补齐：" + "、".join(missing_names))
            if not point["draft_revision_id"]:
                raise HTTPException(422, "请先保存新教材草稿")
            from .simulations import simulate

            for block in data.blocks:
                if block.kind == "interaction":
                    if not block.config:
                        raise HTTPException(422, "交互块尚未选择模板")
                    simulate(block.config)
                if block.kind == "image" and (
                    not block.asset_id or not block.alt.strip()
                ):
                    raise HTTPException(422, "图片尚未上传或缺少替代文字")
                if block.kind == "chart" and (
                    not block.labels or len(block.labels) != len(block.values)
                ):
                    raise HTTPException(422, "图表缺少数据或标签数量不匹配")
            chapter = get(db, "chapters", data.chapter_id)
            if (
                not chapter["published"]
                or not get(db, "courses", chapter["course_id"])["published"]
                or (
                    data.section_id
                    and not get(db, "sections", data.section_id)["published"]
                )
            ):
                raise HTTPException(422, "请先发布所属课程、章和小节")
            if data.chapter_id != point["chapter_id"]:
                linked = db.execute(
                    "SELECT question_id FROM question_knowledge WHERE point_id=?",
                    (ident,),
                ).fetchall()
                for row in linked:
                    other = db.execute(
                        "SELECT 1 FROM question_knowledge q JOIN knowledge_points k ON k.id=q.point_id WHERE q.question_id=? AND k.id<>? AND k.chapter_id<>?",
                        (row[0], ident, data.chapter_id),
                    ).fetchone()
                    if other:
                        raise HTTPException(
                            409, "该知识点有跨章共用题目，请先在题库调整关联再移动"
                        )
                    db.execute(
                        "UPDATE questions SET chapter_id=?,version=version+1 WHERE id=?",
                        (data.chapter_id, row[0]),
                    )
            text = "\n\n".join(b.text for b in data.blocks if b.kind != "image")
            db.execute(
                "UPDATE knowledge_points SET published=1,archived_at=NULL,published_revision_id=draft_revision_id,chapter_id=?,title=?,content=?,lab_path=? WHERE id=?",
                (
                    data.chapter_id,
                    data.title,
                    text,
                    "/student/experiments" if data.lab else None,
                    ident,
                ),
            )
        else:
            db.execute(
                "UPDATE knowledge_points SET published=0,archived_at=CASE WHEN ?='archive' THEN CURRENT_TIMESTAMP ELSE archived_at END WHERE id=?",
                (action, ident),
            )
        db.execute(
            "UPDATE knowledge_points SET edit_version=edit_version+1 WHERE id=?",
            (ident,),
        )
        db.execute(
            "INSERT INTO content_events(point_id,actor_id,action,revision_id) VALUES (?,?,?,?)",
            (ident, user["id"], action, point["draft_revision_id"]),
        )
        return {"ok": True, "edit_version": point["edit_version"] + 1}


@router.get("/teacher/learning-content/{ident}/history")
def history(ident: int, user=Depends(teacher)):
    with database() as db:
        point = get(db, "knowledge_points", ident)
        return [
            {
                **dict(r),
                "body": json.loads(r["body"]),
                "is_published": r["id"] == point["published_revision_id"],
            }
            for r in db.execute(
                "SELECT id,body,author_id,created_at FROM knowledge_revisions WHERE point_id=? ORDER BY id DESC LIMIT 100",
                (ident,),
            )
        ]


@router.get("/learning-content")
def list_content(chapter_id: int | None = None, user=Depends(require_user)):
    with database() as db:
        result = []
        for row in db.execute(
            "SELECT * FROM knowledge_points WHERE (? IS NULL OR chapter_id=?)",
            (chapter_id, chapter_id),
        ).fetchall():
            try:
                data = view_point(db, dict(row), user)
                result.append(
                    {
                        **{
                            k: v
                            for k, v in data.items()
                            if k not in ("blocks", "objectives", "source_note")
                        },
                        "block_kinds": list(
                            dict.fromkeys(b["kind"] for b in data["blocks"])
                        ),
                    }
                )
            except HTTPException:
                continue
        return sorted(result, key=lambda k: (k["sort_order"], k["id"]))


@router.get("/learning-content/{ident}")
def content_detail(ident: int, preview: bool = False, user=Depends(require_user)):
    if preview and user["role"] != "teacher":
        raise HTTPException(403, "仅教师可预览草稿")
    with database() as db:
        point = get(db, "knowledge_points", ident)
        data = view_point(db, point, user, preview)
        docs = db.execute(
            "SELECT d.* FROM documents d JOIN document_knowledge_points k ON k.document_id=d.id WHERE k.knowledge_point_id=?",
            (ident,),
        ).fetchall()
        data["materials"] = [
            dict(d) for d in docs if document_visible(db, dict(d), user)
        ]
        data["related"] = []
        for rid in data.pop("related_ids", []):
            try:
                related = view_point(db, get(db, "knowledge_points", rid), user)
                data["related"].append(
                    {
                        "id": rid,
                        "title": related["title"],
                        "chapter_id": related["chapter_id"],
                    }
                )
            except HTTPException:
                pass
        return data


class Progress(BaseModel):
    revision_id: int = Field(ge=0)
    expected_version: int = Field(default=0, ge=0)
    read_done: bool = False
    self_assessed: bool = False
    position: str = Field(default="", max_length=80)
    note: str = Field(default="", max_length=5000)
    bookmarked: bool = False


@router.get("/learning-content/{ident}/progress")
def get_progress(ident: int, user=Depends(require_user)):
    with database() as db:
        data = view_point(db, get(db, "knowledge_points", ident), user)
        row = db.execute(
            "SELECT * FROM knowledge_progress WHERE user_id=? AND point_id=? AND revision_id=?",
            (user["id"], ident, data["revision_id"]),
        ).fetchone()
        base = (
            dict(row)
            if row
            else {
                "revision_id": data["revision_id"],
                "read_done": False,
                "self_assessed": False,
                "position": "",
                "note": "",
                "bookmarked": False,
                "version": 0,
            }
        )
        base["has_previous_version"] = bool(
            db.execute(
                "SELECT 1 FROM knowledge_progress WHERE user_id=? AND point_id=? AND revision_id<>?",
                (user["id"], ident, data["revision_id"]),
            ).fetchone()
        )
        base["completed_blocks"] = [
            r[0]
            for r in db.execute(
                "SELECT DISTINCT block_id FROM interaction_runs WHERE user_id=? AND point_id=? AND revision_id=? AND completed=1",
                (user["id"], ident, data["revision_id"]),
            )
        ]
        base["practice_completed"] = bool(
            db.execute(
                "SELECT 1 FROM study_attempts WHERE user_id=? AND point_id=? AND revision_id=?",
                (user["id"], ident, data["revision_id"]),
            ).fetchone()
        )
        return base


@router.put("/learning-content/{ident}/progress")
def save_progress(ident: int, body: Progress, user=Depends(require_user)):
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        data = view_point(db, get(db, "knowledge_points", ident), user)
        if data["revision_id"] != body.revision_id:
            raise HTTPException(409, "教材已更新，请刷新后保存；旧记录保留")
        if body.position and body.position not in {b["id"] for b in data["blocks"]}:
            raise HTTPException(422, "正文位置不存在")
        old = db.execute(
            "SELECT version FROM knowledge_progress WHERE user_id=? AND point_id=? AND revision_id=?",
            (user["id"], ident, body.revision_id),
        ).fetchone()
        if (old[0] if old else 0) != body.expected_version:
            raise HTTPException(409, "学习记录已在其他页面更新，请重新加载")
        db.execute(
            "INSERT INTO knowledge_progress(user_id,point_id,revision_id,read_done,self_assessed,position,note,bookmarked,version) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,point_id,revision_id) DO UPDATE SET read_done=excluded.read_done,self_assessed=excluded.self_assessed,position=excluded.position,note=excluded.note,bookmarked=excluded.bookmarked,version=excluded.version,updated_at=CURRENT_TIMESTAMP",
            (
                user["id"],
                ident,
                body.revision_id,
                body.read_done,
                body.self_assessed,
                body.position,
                body.note,
                body.bookmarked,
                body.expected_version + 1,
            ),
        )
        return {"version": body.expected_version + 1}


@router.get("/my/learning-resume")
def learning_resume(user=Depends(require_user)):
    with database() as db:
        for row in db.execute(
            "SELECT point_id,position FROM knowledge_progress WHERE user_id=? ORDER BY updated_at DESC,rowid DESC LIMIT 50",
            (user["id"],),
        ).fetchall():
            try:
                data = view_point(
                    db, get(db, "knowledge_points", row["point_id"]), user
                )
                position = (
                    row["position"]
                    if any(b["id"] == row["position"] for b in data["blocks"])
                    else ""
                )
                return {
                    "point": data["id"],
                    "chapter": data["chapter_id"],
                    "title": data["title"],
                    "position": position,
                }
            except HTTPException:
                continue
        return None


@router.get("/teacher/learning-content/{ident}")
def teacher_content_detail(ident: int, user=Depends(teacher)):
    with database() as db:
        point = get(db, "knowledge_points", ident)
        return {
            **body_of(db, point),
            "id": ident,
            "edit_version": point["edit_version"],
            "revision_id": point["draft_revision_id"] or 0,
            "published": bool(point["published"]),
            "archived": bool(point["archived_at"]),
        }


class OutlineTitles(BaseModel):
    chapter_id: int
    section_id: int | None = None
    titles: list[str] = Field(min_length=1, max_length=30)

    @model_validator(mode="after")
    def valid_titles(self):
        self.titles = [title.strip() for title in self.titles]
        if any(not title or len(title) > 200 for title in self.titles):
            raise ValueError("每个标题需1–200字")
        return self


@router.post("/teacher/learning-outline", status_code=201)
def plan_titles(body: OutlineTitles, user=Depends(teacher)):
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        existing = db.execute(
            "SELECT * FROM knowledge_points WHERE chapter_id=?", (body.chapter_id,)
        ).fetchall()
        start = max([body_of(db, dict(p))["sort_order"] for p in existing] or [0]) + 10
        if start + len(body.titles) * 10 > 100000:
            raise HTTPException(422, "排序数值已满，请先调整已有知识点顺序")
        result = []
        for index, title in enumerate(body.titles):
            data = Content(
                chapter_id=body.chapter_id,
                section_id=body.section_id,
                title=title,
                sort_order=start + index * 10,
                blocks=[
                    Block(id=kind, kind=kind, title=label)
                    for kind, label in [
                        ("intro", "问题导入"),
                        ("concept", "核心概念"),
                        ("explanation", "原理精讲"),
                        ("case", "典型案例"),
                        ("mistake", "易错点"),
                        ("summary", "总结"),
                    ]
                ],
            )
            validate_refs(db, data)
            ident = db.execute(
                "INSERT INTO knowledge_points(chapter_id,title,content,published) VALUES (?,?,?,0)",
                (body.chapter_id, title, ""),
            ).lastrowid
            result.append(
                save_revision(db, get(db, "knowledge_points", ident), data, user)
            )
        return result
