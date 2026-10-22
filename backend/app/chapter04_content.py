"""第四章展示适配；保留原PPT编号和已安装内容包的哈希。"""

from copy import deepcopy
import re


def section_code(code):
    return "4" + code[1:] if code.startswith("3.") else code


def focused_graph(diagram, subjects, title):
    d = deepcopy(diagram)
    labels = {n["id"]: n["label"] for n in d["nodes"]}
    d["edges"] = [e for e in d["edges"] if labels[e["source"]] in subjects]
    used = {e[key] for e in d["edges"] for key in ("source", "target")}
    d["nodes"] = [
        dict(n, x=(i % 3) * 350, y=(i // 3) * 175)
        for i, n in enumerate(n for n in d["nodes"] if n["id"] in used)
    ]
    d["title"] = title
    return d


def application_package(original):
    p = deepcopy(original)
    p["title"] = "第四章：存储管理"
    p["notice"] = (
        "第四章已预填13个单元；反置页表与多级页表分别学习。选择实际目标后可直接发布，保留后续修改。"
    )
    for s in p["sections"]:
        s["code"] = section_code(s["code"])
    for item in p["items"]:
        item["section"] = section_code(item["section"])
    unit = next(i for i in p["items"] if i["code"] == "CH03-U011")
    original_unit = next(i for i in original["items"] if i["code"] == "CH03-U011")
    record = next(r for r in p["records"] if r["id"] == "CH03-K017")
    diagram = next(b["diagram"] for b in original_unit["blocks"] if b.get("diagram"))
    ipt = focused_graph(
        diagram, {"普通页表", "反置页表", "哈希链"}, "反置页表的组织与查找"
    )
    ipt["code"] = "CH03-G005-IPT"
    ipt["note"] = ""
    unit["title"] = "多级页表的规模与查找"
    unit["record_ids"] = ["CH03-K018"]
    unit["refs"] = [
        r for r in next(x for x in p["records"] if x["id"] == "CH03-K018")["sources"]
    ]
    unit["blocks"] = [b for b in unit["blocks"] if b["id"] != "advanced"]
    for b in unit["blocks"]:
        if b.get("diagram") and b["diagram"]["code"] == "CH03-G005":
            b["diagram"] = focused_graph(
                b["diagram"],
                {"多级页表", "稀疏映射", "更多层级", "TLB"},
                "多级页表的空间与访存权衡",
            )
            b["title"] = b["diagram"]["title"]
    unit["summary"] = (
        "为什么将页表分层可以节省稀疏地址空间的页表开销，却可能增加未命中时的查表步骤？"
    )
    unit["blocks"][0]["text"] = unit["summary"]
    unit["related"] = sorted(set(unit["related"] + ["CH03-U013"]))
    intro = "反置页表按物理页框组织，为什么仍能根据虚拟地址找到主存？"
    item = dict(
        code="CH03-U013",
        title="反置页表与哈希查找",
        section="4.3.5",
        record_ids=["CH03-K017"],
        phase="独立进阶单元",
        summary=intro,
        objectives=record["learning_goal"],
        refs=record["sources"],
        lab=False,
        related=["CH03-U005", "CH03-U006", "CH03-U011"],
        sort_order=105,
    )
    item["blocks"] = [
        dict(id="intro", kind="intro", title="先想一个问题", text=intro),
        dict(
            id="concept",
            kind="concept",
            title="理解关键原理",
            text=record["core_explanation"],
        ),
        dict(
            id="explanation",
            kind="explanation",
            title="规则与限制",
            text=record["rules_and_limits"].removeprefix("T：")
            + "\n\n每个物理页框对应表项，不是每个页框建立一整张页表；具体MMU职责依架构而定。",
        ),
        dict(
            id="ipt-graph",
            kind="diagram",
            title=ipt["title"],
            text="沿关系名理解组织方式与查找方向。这是静态关系图，暂不提供IPT计算引擎。",
            diagram=ipt,
        ),
        dict(
            id="case",
            kind="case",
            title="沿哈希链查找",
            text="教学示例：同一桶内，框1记录(A,2)，框3记录(B,2)。查找进程B的页2、偏移8时，要跳过框1，继续比较完整键(B,2)。页大小4096B时，命中框3得到3×4096+8=12296。\n\n哈希相同不等于映射相同。无匹配时还需检查地址是否合法，不能为任意地址直接调页。共享别名和后备映射的完整实现仍未支持。",
        ),
        dict(
            id="mistake",
            kind="mistake",
            title="容易混淆的地方",
            text=record["misconception_and_correction"],
        ),
        dict(
            id="summary",
            kind="summary",
            title="用自己的话回顾",
            text=record["learning_goal"],
        ),
        dict(
            id="support",
            kind="text",
            title="练习与实验安排",
            text="重点练习哈希冲突、完整键比较和表项/整张表的区别。可进入教师正式练习或独立AI问答；本单元尚无已实现的算法实验或机制动画。",
        ),
    ]
    p["items"].append(item)
    p["items"].sort(key=lambda i: i["sort_order"])
    return p


def canonical_name(title):
    return re.sub(
        r"[\s、，,·：:—-]", "", re.sub(r"^(?:第[三四34]章|[34][.．、 ]+)\s*", "", title)
    )


def target_is_memory(chapter):
    return canonical_name(chapter["title"]) in {"存储管理", "内存管理"}
