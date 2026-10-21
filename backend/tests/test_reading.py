import json
from app.chapter_content import load_package, content_for
from app.reading import student_reading
from test_chapter_content import clients  # isolated authenticated HTTP fixture


def test_student_projection_hides_sources_without_mutating_teacher_data():
    p = load_package()
    for item in p["items"]:
        if not item["importable"]:
            continue
        original = content_for(p, item, 1, None).model_dump()
        snapshot = json.dumps(original, ensure_ascii=False)
        reading = student_reading(original)
        assert json.dumps(original, ensure_ascii=False) == snapshot
        assert original["source_note"] and not reading["source_note"]
        assert not reading["source_title"]
        assert not any(b["id"] == "animation-status" for b in reading["blocks"])
        texts = "\n".join(b["text"] for b in reading["blocks"])
        assert (
            "SRC-" not in texts
            and "依据报告" not in texts
            and "等待你审核" not in texts
        )
        ids = [b["id"] for b in reading["blocks"]]
        assert ids.index("summary") > ids.index("case")
        for i, b in enumerate(reading["blocks"]):
            if b["kind"] == "diagram":
                assert i < ids.index("case")
    item = next(i for i in p["items"] if i["code"] == "CH01-K014")
    reading = student_reading(content_for(p, item, 1, None).model_dump())
    assert any(
        e["direction"] == "unconfirmed"
        for b in reading["blocks"]
        if b["kind"] == "diagram"
        for e in b["diagram"]["edges"]
    )


def test_later_manual_text_is_not_replaced_by_reading_copy():
    p = load_package()
    item = p["items"][0]
    body = content_for(p, item, 1, None).model_dump()
    case = next(b for b in body["blocks"] if b["id"] == "case")
    case["text"] = "老师后来修改的说明，包括应保留的模型限制。"
    reading = student_reading(body)
    assert (
        next(b for b in reading["blocks"] if b["id"] == "case")["text"] == case["text"]
    )


def test_student_and_teacher_http_read_different_presentation_same_revision(clients):
    t, s = clients
    r = t.post("/api/teacher/chapter-content/chapter01/apply", json={"chapter_id": 1})
    assert r.status_code == 200, r.text
    ident = next(p["id"] for p in r.json()["points"] if p["code"] == "CH01-K009")
    teacher = t.get(f"/api/teacher/learning-content/{ident}").json()
    student = s.get(f"/api/learning-content/{ident}").json()
    assert teacher["revision_id"] == student["revision_id"]
    assert "SRC-02" in teacher["source_note"] and student["source_note"] == ""
    assert (
        "等待你审核"
        in next(b for b in teacher["blocks"] if b["id"] == "explanation")["text"]
    )
    assert (
        "等待你审核"
        not in next(b for b in student["blocks"] if b["id"] == "explanation")["text"]
    )
    summary = next(
        p
        for p in s.get("/api/learning-content?chapter_id=1").json()
        if p["id"] == ident
    )
    assert "blocks" not in summary and "diagram" in summary["block_kinds"]
