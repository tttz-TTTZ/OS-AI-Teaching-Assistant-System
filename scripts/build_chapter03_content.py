"""Convert the reviewed analysis specs to existing Content/Diagram models; no DB I/O."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs/reports/chapter-03"
DEST = ROOT / "backend/content"


def read(name):
    return json.loads((SOURCE / (name + "-v1.1.json")).read_text(encoding="utf-8"))


def build():
    records = read("knowledge-records")
    by = {r["id"]: r for r in records}
    units = read("learning-units")
    owner = {r: u["id"] for u in units for r in u["record_ids"]}
    sections = [
        "3.1",
        "3.2",
        "3.2",
        "3.1",
        "3.3.1",
        "3.3.2",
        "3.3.3",
        "3.3.4",
        "3.3.4",
        "3.3.4",
        "3.3.6",
        "3.4",
    ]
    graph_at = {1: [1], 3: [2], 6: [3], 9: [4], 11: [5], 12: [6]}
    flow_at = {1: [1], 3: [2, 3], 6: [4], 7: [5], 10: [9], 11: [6], 12: [7, 8]}
    questions = [
        "知道物理地址，为什么仍可能没有访问权限？",
        "总空闲够用，为什么仍放不下一个连续请求？",
        "同一个28K请求，为什么不同策略选中不同位置？",
        "虚拟内存、覆盖与对换，分别由谁管理什么？",
        "页号为什么不能直接当成页框号？",
        "TLB未命中时，一定需要读磁盘吗？",
        "一次合法缺页，为什么可能先写回，再读入，最后重试？",
        "做同样多次赋值，为什么换个循环顺序会改变缺页次数？",
        "FIFO命中后要不要重排？多给一个页框一定更好吗？",
        "CLOCK的一次缺页，为什么可能需要检查多个槽位？",
        "按虚页、按页框、分层组织，分别解决什么问题？",
        "段表找到的是数据起址，还是另一张页表？",
    ]
    cases = [
        "重定位示例（题干复算）：逻辑100K对应物理120K，基址为20K，逻辑250K对应270K。\n\n教学示例：A、B共享只读代码页；允许执行并不等于允许写入，写入应走保护错误。",
        "固定分区8、16、32、32K，依分区号为请求15、30、10K选择16、32、32K。已分配分区的内零头为1+2+22=25K；未使用的8K分区不计入这一项。此值为题干推导。",
        "空闲区用（起址，长度）表示，单位均为K：(20,40)、(70,25)、(100,50)、(160,30)。请求28K：FF选20，BF选160，WF选100。教学补充：若NF游标从70K项开始，本次选100K；游标维护协议仍需确认。\n\n回收教学示例：已有空闲[0,10)和[20,30)，释放已分配区[10,20)后，前后均相邻，合并为[0,30)。表中相邻并不代表物理端点相接。\n\n教学示例：可用[0,100)，P1占[0,20)，P2占[40,70)，总空闲50但最大连续空闲30，请求40失败。在允许搬迁的模型中，将P2移到[20,50)，形成[50,100)，才可分配40。只有空闲表时不能猜测间隙归属或执行搬迁。",
        "教学示例：罕用的错误处理代码可暂不驻留；发生合法访问时按映射信息调入。它并不要求所有页面预先存入同一交换区，也不意味着辅存访问与内存一样快。",
        "页大小4096B，页表0→框8、1→框4、2→框1、3→框9。8196=2×4096+4，物理地址=1×4096+4=4100；15000的页号3、偏移2712，物理地址39576。\n\n教学示例：A页2与B页5可映射同一个数据框7。代码能否这样共享还取决于寻址与重定位，不能推出代码必须总用相同虚页号。",
        "串行TLB、单级驻留页表、无缺页：tM=200ns，tT=40ns，h=0.9，EAT=0.9×240+0.1×440=260ns。h=0为440ns，h=1为240ns。相对无TLB的400ns基线，延迟减少35%，不是吞吐率直接提高35%。\n\n教学示例：A页1→框4、B页1→框9；切到B后不能继续使用A的同页号映射。",
        "教学示例：页2合法但不驻留，且没有空闲框；选择器指定脏页1作为候选。先成功写回1，再读入2，更新映射与相关TLB，恢复并重试原指令。写回失败必须保留脏数据；原指令重试不算新的程序引用。这里没有指定自动置换算法。",
        "在行优先、每元素一字、每页128字、一行一页、页对齐、仅一个数据框、第一页预驻留且不计代码等访问的模型中，128×128数组有16384次引用：行遍历127次缺页，列遍历16383次。初始空框时分别加1。\n\n缩小教学示例：同条件4×4模型，行遍历3次、列遍历15次。这是条件化手算，尚无数组模拟器。",
        "同一引用串7,0,1,2,0,3,0,4,2,3,0,3,2,1,2,0,1,7,0,1，3个初始空框：OPT缺页9次、FIFO15次、LRU12次。\n\nBelady反例另用串1,2,3,4,1,2,5,1,2,3,4,5：FIFO从3框的9次变为4框的10次。两组输入不能混算；这些是手工核对的参考结果，不是平台运行输出；尚未接入页面置换计算引擎。",
        "自拟完整小例：3空框、R全0、hand=0，依次访问1,2,3,1,4。缺页4次，最终frames=[4,2,3]、R=[1,0,0]、hand=1。满框后访问4，依次清三个1位，再回到首槽替换。基础串行无锁页模型中，全1最多检查m+1次槽位。\n\n近似LRU与窗口LFU的采样时机、随机规则、同频规则尚未完整确认，不给唯一轨迹或运行入口。",
        "32位字节地址、4KiB页、4B表项：2^20项，共4MiB。题给9/11/12划分时，偏移12位；若额外假设4B项，下级2048项共8KiB，不能说它必占一张4KiB页。\n\n自拟16位4/4/8模型：VA=0x2345，目录索引2、叶索引3、偏移69；叶项映射框5，PA=5×256+69=1349。此例与32位课件题独立。",
        "零起字节偏移教学模型：base=10000、length=100，d=99得到10099，d=100越界。若允许增长，访问d=120至少需要长度121，增加21；增长上限、资源与搬迁条件未定，当前不提供增长模拟。\n\n段页式教学例：P=4096，段1含3个整页，页2→框7，偏移6，PA=28678；页3越界。若末页只有部分字节有效，必须另给segment_bytes，检查pP+d<L，不能仅看页表长度。",
    ]
    tables = {
        1: "|检查|回答的问题|\n|---|---|\n|范围|偏移是否位于0≤d<L？|\n|映射|该地址是否有合法映射？|\n|权限|当前读、写或执行是否获准？|",
        2: "|现象|内零头|外零头|\n|---|---|---|\n|位置|已分配单元内部|已分配区之间的空闲|\n|统计|分配容量减实际请求|空闲总量与最大连续区分别记录|\n|紧凑|不能直接消除内部浪费|在可移动条件下改善连续性|",
        3: "|策略|本次选择依据|\n|---|---|\n|FF|按地址从头查首个足够大区|\n|NF|从已明确的游标继续环形查找|\n|BF|足够大的最小区|\n|WF|足够大的最大区|\n\n相等也可分配；示例从低地址切分。BF/WF同尺寸取低起址是教学约定，不代表全局最优。",
        4: "|方式|管理者与粒度|\n|---|---|\n|覆盖|程序设计者安排不同时使用的部分|\n|对换|交换模型中调整进程等对象的驻留|\n|请求分页/段|OS按合法访问管理页/段驻留|",
        6: "|路径|串行单级无缺页模型耗时|\n|---|---|\n|TLB命中|tT+tM，仍含最终数据访问|\n|未命中且驻留|tT+2tM，一次查表一次数据|\n|EAT|h(tT+tM)+(1−h)(tT+2tM)|\n\n有效缓存项可携带权限；命中不强制额外读主存页表。",
        9: "|策略|选择依据|命中时|\n|---|---|---|\n|OPT|未来最远或不再访问|不改变未来序列|\n|FIFO|最早装入|不重排装入顺序|\n|LRU|最久未访问|更新最近访问历史|\n|CLOCK|引用位与手针扫描|置R=1，基础协议不移动手针|",
        12: "|模式|地址结构|表项作用|\n|---|---|---|\n|分页|页号、页内偏移|页表定位页框|\n|分段|段号、段内偏移|段表提供基址、长度和状态|\n|段页式|段号、页号、偏移|段表定位页表，再定位页框|",
    }

    def display(text):
        # Keep full S/T/V evidence in records/reports; learner text uses meaningful names.
        return (
            text.replace("缺页进入F005", "进入缺页处理")
            .replace("F005", "缺页处理")
            .replace("T教学规范", "本教学模型")
            .removeprefix("T：")
        )

    diagrams = {}
    for kind, specs in [
        ("relation", read("knowledge-graphs")),
        ("flow", read("flow-specs")),
    ]:
        for spec in specs:
            note = "教学示意，不是原图复刻或可执行动画。"
            if kind == "flow":
                note += f"开始：{spec['start_condition']}；结束：{spec['end_condition']}；{spec['errors_and_wait']}"
            else:
                note += "；".join(
                    f"{e['relation']}：{e['evidence']}" for e in spec["edges"]
                )
            diagrams[spec["id"]] = dict(
                code=spec["id"],
                title=spec["title"],
                type=kind,
                nodes=[
                    dict(
                        id=node["id"],
                        label=display(node["label"]),
                        x=(i % 3) * 350,
                        y=(i // 3) * 175,
                    )
                    for i, node in enumerate(spec["nodes"])
                ],
                edges=[
                    dict(
                        source=e["source"],
                        target=e["target"],
                        label=(
                            e["relation"]
                            + "；"
                            + e["condition"]
                            .replace("T使用", "使用")
                            .replace("纠正每框一整表措辞V013", "每个页框对应一个表项")
                            if kind == "relation"
                            else display(e["condition"])
                        ),
                        direction="directed",
                    )
                    for e in spec["edges"]
                ],
                note=note,
            )
    advanced = {"CH03-K016", "CH03-K017", "CH03-K020"}
    ordinary_at = {1: [1, 3], 2: [5], 4: [2, 4], 5: [6], 7: [7], 12: [8]}
    ordinary = read("ordinary-content")
    ordinary_reading = [
        "逻辑地址描述程序使用的位置，物理地址定位主存位置；转换取决于当前映射和存储模式。",
        "连续分区以连续区间分配空间；分页把空间划成固定大小的页与页框；分段按程序逻辑单位组织，段页式结合两者。",
        "存储管理协调地址转换、空间分配与回收、共享、保护和扩充；找到物理位置后仍要判断访问许可。",
        "寄存器、Cache、主存和辅存构成不同层次。Cache缓存数据以缩短访问延迟；TLB缓存地址转换，两者职责不同，具体容量和实现依架构。",
        "单用户连续模式为程序保留连续空间。固定分区预先确定分区数量与容量；可变分区按请求划分并维护空闲区。",
        "页表记录某地址空间的页到页框映射；位示图记录页框占用。位值0或1分别表示什么，必须由具体模型明确约定。",
        "驻留标志说明页是否在主存；修改标志提示替换前是否需要写回；保护信息约束操作；引用信息可用于置换策略。",
        "程序可按主程序、子程序和数据等逻辑单位分段。段的长度可不同，段寄存器数量和可见性取决于具体架构。",
    ]
    items = []
    for n, u in enumerate(units, 1):
        rs = [by[r] for r in u["record_ids"]]
        core = [r for r in rs if r["id"] not in advanced]

        def join(field, subset=None):
            return "\n\n".join(
                "### "
                + r["name"]
                + "\n\n"
                + r[field]
                .removeprefix("T/V：")
                .removeprefix("T：")
                .replace("T：", "教学条件：")
                for r in (core if subset is None else subset)
            )

        blocks = [
            dict(id="intro", kind="intro", title="先想一个问题", text=questions[n - 1]),
            dict(
                id="concept",
                kind="concept",
                title="理解关键原理",
                text=join("core_explanation"),
            ),
            dict(
                id="explanation",
                kind="explanation",
                title="规则、条件与对照",
                text=(tables.get(n, "") + "\n\n" + join("rules_and_limits")).strip(),
            ),
        ]
        for typ, numbers in [("G", graph_at.get(n, [])), ("F", flow_at.get(n, []))]:
            for num in numbers:
                d = diagrams[f"CH03-{typ}{num:03}"]
                spec = next(
                    s
                    for s in read("flow-specs" if typ == "F" else "knowledge-graphs")
                    if s["id"] == d["code"]
                )
                text = "选择节点，沿有名称和条件的连线阅读；可用键盘操作节点。这是流程与关系示意，暂不支持输入数据运行实验。"
                if typ == "F":
                    text += f"\n\n开始：{display(spec['start_condition'])}。结束：{display(spec['end_condition'])}。\n\n边界与等待：{display(spec['errors_and_wait'])}"
                blocks.append(
                    dict(
                        id=d["code"].lower(),
                        kind="diagram",
                        title=d["title"],
                        text=text,
                        diagram=d,
                    )
                )
        blocks += [
            dict(id="case", kind="case", title="用例子理解", text=cases[n - 1]),
            dict(
                id="mistake",
                kind="mistake",
                title="检查容易混淆的地方",
                text=join("misconception_and_correction"),
            ),
            dict(
                id="summary",
                kind="summary",
                title="用自己的话回顾",
                text="\n".join("- " + r["learning_goal"] for r in core),
            ),
        ]
        if n in ordinary_at:
            blocks.append(
                dict(
                    id="background",
                    kind="text",
                    title="需要时再看：基础速览",
                    text="\n\n".join(
                        "### "
                        + ordinary[k - 1]["name"]
                        + "\n\n"
                        + ordinary_reading[k - 1]
                        for k in ordinary_at[n]
                    ),
                )
            )
        extra = [r for r in rs if r["id"] in advanced]
        if extra:
            blocks.append(
                dict(
                    id="advanced",
                    kind="text",
                    title="可选进阶：理解边界",
                    text=join("core_explanation", extra)
                    + "\n\n"
                    + join("rules_and_limits", extra)
                    + "\n\n当前仅静态讲解，完整协议和对应实验仍待完善。",
                )
            )
        blocks.append(
            dict(
                id="support",
                kind="text",
                title="练习与实验安排",
                text="可在本页进入教师正式练习，或带着具体问题进入独立智能问答。个人AI测验不计入教师正式成绩。公共课件需教师在资料管理中实际关联。\n\n本单元没有已接入的存储管理计算引擎或机制动画。FCFS/SJF/RR属于CPU调度，不代替页面FIFO/CLOCK。图示可交互阅读，但不执行真实分配、缺页或置换。",
            )
        )
        refs = []
        for r in rs:
            for ref in r["sources"]:
                if ref not in refs:
                    refs.append(ref)
        related = sorted(
            {
                owner[rid]
                for r in rs
                for rid in r["related_ids"]
                if owner[rid] != u["id"]
            }
        )
        items.append(
            dict(
                code=u["id"],
                title=u["title"],
                section=sections[n - 1],
                record_ids=u["record_ids"],
                phase="第一批·预填草稿",
                summary=questions[n - 1],
                objectives="\n".join("- " + r["learning_goal"] for r in core),
                blocks=blocks,
                refs=refs,
                lab=False,
                related=related,
                sort_order=n * 10,
            )
        )
    package = dict(
        package_id="chapter03-ppt-v1.1",
        title="第三章：存储管理",
        notice="依据6份教师PPTX的V1.1报告，118物理页。仅显式导入草稿；教师修改审核后发布，不自动覆盖现有内容。",
        sources=[
            dict(
                id=s["id"],
                filename=s["name"],
                slides=s["slides"],
                hidden=s["hidden_physical_pages"],
                sha256=s["sha256"],
            )
            for s in read("source-manifest")
        ],
        sections=[
            dict(code=c, title=t)
            for c, t in [
                ("3.1", "存储管理基础"),
                ("3.2", "连续分区存储管理"),
                ("3.3.1", "页式存储管理基础"),
                ("3.3.2", "地址转换与TLB"),
                ("3.3.3", "页式虚拟存储管理"),
                ("3.3.4", "页面调度"),
                ("3.3.5", "反置页表"),
                ("3.3.6", "多级页表"),
                ("3.4", "段式存储管理"),
            ]
        ],
        records=records,
        items=items,
        summaries=ordinary,
        issues=read("unresolved-issues"),
        experiments=[],
        deferred=[
            "分区适配/释放/紧凑：未增加引擎",
            "页面OPT/FIFO/LRU/CLOCK/LFU：未增加引擎",
            "AN001—AN008机制动画：尚未实现",
            "近似LRU、段增长和模糊图示：保留待核实",
        ],
        practice=read("practice-associations"),
    )
    # Validate against actual application schema before emitting an importable bundle.
    import sys

    sys.path.insert(0, str(ROOT / "backend"))
    from app.digital import Content

    for item in items:
        Content(
            chapter_id=0,
            code=item["code"],
            title=item["title"],
            summary=item["summary"],
            objectives=item["objectives"],
            blocks=item["blocks"],
        )
    DEST.mkdir(exist_ok=True)
    (DEST / "chapter03.json").write_text(
        json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    reading = {
        item["code"] + "/" + block["id"]: {"expected_note": block["diagram"]["note"]}
        for item in items
        for block in item["blocks"]
        if block.get("diagram")
    }
    (DEST / "chapter03_reading.json").write_text(
        json.dumps(reading, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return package


if __name__ == "__main__":
    p = build()
    print(
        f"已构建{len(p['items'])}单元、{len(p['records'])}记录；未连接数据库、未创建实验或发布。"
    )
