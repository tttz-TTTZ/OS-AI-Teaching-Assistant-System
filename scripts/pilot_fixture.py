"""Authored demo PPTX and deterministic model boundary for pipeline regression, not real-model evaluation."""

from io import BytesIO
from zipfile import ZipFile
from xml.sax.saxutils import escape
from presentation_fixture import pptx_bytes

GOLD = [
    ("用户接口", "用户接口让使用者通过命令行或图形界面操作计算机系统。"),
    ("程序接口", "程序接口让应用程序以约定方式调用功能并获得所需服务。"),
    ("系统调用", "系统调用是应用程序向操作系统内核请求服务的受控入口。"),
    ("API与系统调用", "API不一定一一对应系统调用，具体关系取决于接口实现。"),
    ("库函数", "库函数可能在用户态完成，也可能通过系统调用请求内核服务。"),
    ("保护机制", "受控入口限制应用程序直接操作受保护资源以维持系统安全。"),
]


def decks():
    for indexes in ([0, 1, 2, 3], [2, 3, 4, 5]):
        pages = ["目录\n1.3 基本服务和用户接口\n1.3.1 基本服务\n1.3.2 系统调用"] * 6
        for i in indexes:
            pages.append(
                GOLD[i][1]
                + "\n"
                + (
                    "本页围绕接口机制提供课堂讲解的背景说明，学习时需要结合定义理解适用范围。"
                    * 36
                )
            )
        original = BytesIO(pptx_bytes(len(pages)))
        output = BytesIO()
        with ZipFile(original) as source, ZipFile(output, "w") as target:
            for item in source.infolist():
                if item.filename.startswith(
                    "ppt/slides/slide"
                ) and item.filename.endswith(".xml"):
                    i = int(item.filename.split("slide")[-1].split(".")[0]) - 1
                    paragraphs = "".join(
                        f"<a:p><a:r><a:t>{escape(line)}</a:t></a:r></a:p>"
                        for line in pages[i].splitlines()
                    )
                    target.writestr(
                        item.filename,
                        f'<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>{paragraphs}</p:spTree></p:cSld></p:sld>',
                    )
                else:
                    target.writestr(item.filename, source.read(item.filename))
        yield output.getvalue()


def model_output(payload):
    task = payload["task"]
    if task == "pilot_extract":
        blocks = []
        for c in payload["sources"]:
            facts = [
                {"title": title, "statement": statement, "quote": statement}
                for title, statement in GOLD
                if statement in c["text"]
            ]
            if not facts and "操作系统负责管理计算机硬件和软件资源" in c["text"]:
                sentences = [
                    s + "。" for s in c["text"].split("。") if len(s.strip()) >= 8
                ][:3]
                facts = [
                    {
                        "title": ["资源管理", "进程空间", "线程资源"][i],
                        "statement": s,
                        "quote": s,
                    }
                    for i, s in enumerate(sentences)
                ]
            blocks.append(
                {
                    "ref": c["ref"],
                    "kind": "content" if facts else "irrelevant",
                    "facts": facts,
                }
            )
        return {"blocks": blocks}
    if task == "pilot_merge":
        return {
            "concepts": [
                {"id": f"c{i}", "title": f["title"], "fact_ids": [f["id"]]}
                for i, f in enumerate(payload["facts"])
            ],
            "conflicts": [],
        }
    if task == "pilot_map":
        groups = [payload["concepts"][:3], payload["concepts"][3:]]
        return {
            "branches": [
                {
                    "label": ["服务与接口", "区别与保护"][i],
                    "concept_ids": [c["id"] for c in group],
                }
                for i, group in enumerate(groups)
                if group
            ]
        }
    if task == "pilot_flashcards":
        return {
            "cards": [
                {"front": "如何理解" + c["title"] + "？", "fact_ids": c["fact_ids"]}
                for c in payload["concepts"]
            ]
        }
    raise ValueError("Unsupported fixture task")


if __name__ == "__main__":
    import base64, json

    import sys

    data = list(decks())
    if "--four" in sys.argv:
        variants = []
        for i in range(4):
            output = BytesIO(data[i % len(data)])
            with ZipFile(output, "a") as book:
                book.comment = f"synthetic-course-file-{i}".encode()
            variants.append(output.getvalue())
        data = variants
    print(json.dumps([base64.b64encode(item).decode() for item in data]))
