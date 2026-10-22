"""Content package target resolution shared by explicit teacher import routes."""

from fastapi import HTTPException
from .digital import get


def prior(db, package, chapter):
    row = db.execute(
        "SELECT * FROM chapter_content_imports WHERE course_id=? AND package_id=?",
        (chapter["course_id"], package["package_id"]),
    ).fetchone()
    return dict(row) if row else None


def resolve_sections(db, package, body):
    codes = {s["code"] for s in package["sections"]}
    if set(body.section_map) - codes:
        raise HTTPException(422, "存在不属于本包的小节映射")
    result = []
    for section in package["sections"]:
        ident = body.section_map.get(section["code"])
        if ident is not None:
            row = get(db, "sections", ident)
            if row["chapter_id"] != body.chapter_id:
                raise HTTPException(422, "映射的小节必须属于所选目标章节")
            result.append(
                {
                    **section,
                    "id": ident,
                    "existing_title": row["title"],
                    "conflict": False,
                }
            )
            continue
        matches = db.execute(
            "SELECT * FROM sections WHERE chapter_id=? AND code=?",
            (body.chapter_id, section["code"]),
        ).fetchall()
        exact = len(matches) == 1 and matches[0]["title"] == section["title"]
        result.append(
            {
                **section,
                "id": matches[0]["id"] if exact else None,
                "conflict": bool(matches) and not exact,
                "existing_title": matches[0]["title"] if exact else "",
            }
        )
    return result
