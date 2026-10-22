"""从已审阅的V1.1交接记录构建应用内容包；仅写JSON，不连接数据库。"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "docs/reports/chapter-02"
DEST = ROOT / "backend/content"


def build():
    records = json.loads((REPORT / "knowledge-records-v1.1.json").read_text())
    by = {c["id"]: c for c in records}
    graphs = json.loads((REPORT / "knowledge-graphs-v1.1.json").read_text())
    sources = json.loads((REPORT / "source-manifest-v1.1.json").read_text())
    report = (REPORT / "REPORT-V1.1.md").read_text()
    issues = []
    for line in report.splitlines():
        if line.startswith("| CH02-V"):
            cells = [c.strip() for c in line.strip("|").split("|")]
            issues.append(
                dict(
                    code=cells[0],
                    source=cells[1],
                    text=cells[2],
                    resolution=cells[3],
                    status="待核实",
                )
            )
    assert len(issues) == 21
    units = [
        (
            1,
            "2.1",
            "执行权限与受控入口",
            [1, 2],
            "普通程序为什么不能直接执行所有硬件操作？",
            ["G001"],
            [],
        ),
        (
            2,
            "2.3",
            "进入内核之后：返回自己还是切换进程",
            [3, 11],
            "进入内核，是否就意味着CPU换了一个进程？",
            [],
            ["F001", "F007"],
        ),
        (
            3,
            "2.2",
            "中断嵌套：沿返回栈逐层恢复",
            [4],
            "高优先级中断结束后，CPU应该先回到哪里？",
            [],
            [],
        ),
        (
            4,
            "2.3",
            "PCB、进程映像与可恢复的执行现场",
            [6, 9],
            "同一程序运行两次，系统凭什么认出并恢复各自的执行位置？",
            ["G002"],
            [],
        ),
        (
            5,
            "2.3",
            "进程三态与队列的一致变化",
            [7, 10],
            "等待I/O的进程为什么不能直接放进CPU？",
            [],
            ["F004"],
        ),
        (
            6,
            "2.3",
            "阻塞、挂起与三级调度的分工",
            [8, 15],
            "等待条件已经满足，进程为什么仍可能不能运行？",
            [],
            ["F009"],
        ),
        (
            7,
            "2.4",
            "线程的共享资源与私有执行状态",
            [12],
            "同一进程的两个线程共享什么，又必须各自保留什么？",
            ["G003"],
            [],
        ),
        (
            8,
            "2.4",
            "KLT、纯ULT与M:N：由谁调度",
            [13, 14],
            "一个线程阻塞时，其他线程还能否继续，取决于什么？",
            [],
            [],
        ),
        (
            9,
            "2.5",
            "从时间轴核算调度指标",
            [16],
            "很快获得一次CPU，与很快完成全部任务，是同一件事吗？",
            ["G004"],
            [],
        ),
        (
            10,
            "2.5",
            "FCFS与非抢占SJF：比较当前就绪集合",
            [17, 18],
            "如果短任务刚刚到达，SJF是否立即停止正在运行的长任务？",
            [],
            [],
        ),
        (
            11,
            "2.5",
            "RR：时间片边界与回到队尾",
            [21],
            "时间片刚结束，同时又到达一个新任务，谁先进入队列？",
            [],
            [],
        ),
        (
            12,
            "2.5",
            "可选进阶：SRTF与最高响应比",
            [19, 20],
            "比较剩余时间和比较响应比，会如何改变一次选择？",
            [],
            [],
        ),
    ]
    titles = {
        "G001": "控制权、权限与返回",
        "G002": "进程描述与现场恢复",
        "G003": "资源共享与线程承载",
        "G004": "调度决策与指标",
    }
    diagrams = {}
    for g in graphs:
        short = g["id"].split("-")[-1]
        diagrams[short] = dict(
            code=g["id"],
            title=titles[short],
            type="relation",
            nodes=[
                dict(**n, x=(i % 3) * 350, y=(i // 3) * 175)
                for i, n in enumerate(g["nodes"])
            ],
            edges=[
                dict(
                    source=e["source"],
                    target=e["target"],
                    label=e["relation"]
                    + ("；" + e["condition"] if e["condition"] else ""),
                    direction="directed",
                )
                for e in g["edges"]
            ],
            note=g["note"] + "；来源：" + g["source"] + "。教学关系图，不是原图复刻。",
        )

    def flow(code, title, labels, edges):
        diagrams[code] = dict(
            code="CH02-" + code,
            title=title,
            type="flow",
            nodes=[
                dict(id=f"{code}-n{i}", label=label, x=(i % 3) * 350, y=(i // 3) * 175)
                for i, label in enumerate(labels)
            ],
            edges=[
                dict(
                    source=f"{code}-n{a}",
                    target=f"{code}-n{b}",
                    label=t,
                    direction="directed",
                )
                for a, b, t in edges
            ],
            note="T：基于课件的架构中立流程设计；用于阅读分支，不是可执行内核动画。",
        )

    flow(
        "F001",
        "中断入口与处理结果",
        [
            "事件到达",
            "是否允许响应",
            "待处理集合",
            "保存入口状态并进入内核",
            "处理事件",
            "是否需要让出CPU",
            "恢复原进程",
            "选择其他就绪者或空闲",
            "恢复选中者",
        ],
        [
            (0, 1, "识别类型"),
            (1, 2, "可屏蔽且暂被屏蔽"),
            (2, 1, "解除屏蔽后再检查"),
            (1, 3, "允许响应"),
            (3, 4, "保存后服务"),
            (4, 5, "可恢复时按结果判断；不可恢复者终止后调度"),
            (5, 6, "当前可继续且不需抢占"),
            (5, 7, "阻塞、抢占或终止"),
            (7, 8, "有就绪者；否则保持空闲"),
        ],
    )
    flow(
        "F004",
        "三态与事件：等待不等于就绪",
        ["就绪", "运行", "等待", "已结束"],
        [
            (0, 1, "分派选中"),
            (1, 0, "时间片到或按策略抢占"),
            (1, 2, "请求的资源/事件尚未满足"),
            (2, 0, "等待条件满足"),
            (1, 3, "执行结束"),
        ],
    )
    flow(
        "F007",
        "模式切换与进程切换的两条路径",
        [
            "P1用户态执行",
            "保存入口现场，进入内核",
            "服务完成后的条件判断",
            "恢复P1，返回用户态",
            "保存P1上下文并更新队列",
            "选择P2或进入空闲",
            "恢复P2上下文并返回用户态",
        ],
        [
            (0, 1, "受控入口"),
            (1, 2, "处理请求"),
            (2, 3, "P1仍可运行且不需要让出CPU"),
            (2, 4, "P1阻塞、终止或被抢占"),
            (4, 5, "旧状态保存完毕"),
            (5, 6, "存在可调度的P2；否则空闲"),
        ],
    )
    flow(
        "F009",
        "三级调度：接纳、驻留与CPU选择",
        [
            "后备或新建",
            "接纳条件检查",
            "驻留/就绪集合",
            "挂起集合",
            "CPU执行",
            "等待事件",
            "完成退出",
        ],
        [
            (0, 1, "候选作业"),
            (1, 0, "接纳条件不足时保留后备"),
            (1, 2, "高级调度允许接纳"),
            (2, 3, "中级调度换出"),
            (3, 2, "中级激活且内存条件满足；未满足则继续挂起"),
            (2, 4, "低级调度选就绪者"),
            (4, 2, "片到/抢占"),
            (4, 5, "等待未满足事件"),
            (5, 2, "事件完成且已驻留；挂起者仍需激活"),
            (4, 6, "完成"),
        ],
    )
    tables = {
        1: "|比较维度|外中断|异常|系统调用|\n|---|---|---|---|\n|触发|设备/时钟事件|关联当前执行指令|程序主动请求服务|\n|与当前指令关系|异步|同步|主动执行受控入口|\n|是否必换进程|否|否|否|",
        2: "|观察量|只发生模式切换|同时切换进程|\n|---|---|---|\n|权限|用户态进入内核后返回|在内核处理并选择另一主体|\n|PID|仍可保持P1|从P1变为P2|\n|返回现场|P1保存的现场|被选P2的现场|",
        5: "|状态|还缺什么|能否被分派|\n|---|---|---|\n|就绪|CPU|可以成为候选|\n|运行|已占CPU|当前执行者|\n|等待|事件/资源条件|不能直接分派|",
        6: "|事件条件 / 是否驻留|驻留|挂起（交换模型）|\n|---|---|---|\n|满足运行条件|就绪|就绪挂起|\n|等待条件未满足|等待|等待挂起|\n\n高级调度决定接纳；中级调度调整驻留；低级调度从就绪者中选CPU执行者。它们不是每次必按顺序调用的三个函数。",
        7: "|内容|进程内线程之间|\n|---|---|\n|地址空间与许多资源|共享|\n|PC、执行现场、用户栈|各自保存|\n|内核栈与承载关系|依KLT/ULT具体模型，不能一概而论|\n|共享数据的一致性|仍需适当同步|",
        8: "|模型|调度可见性|一个阻塞调用的影响|\n|---|---|---|\n|KLT|内核调度执行实体|其他就绪KLT仍可能被分派|\n|纯many-to-one ULT|用户库切ULT，内核看承载者|承载者阻塞可影响其全部ULT|\n|M:N|用户绑定+内核分派两层|Active不等于对应KLT已在CPU运行|",
        9: "|指标|单CPU、单CPU段、无I/O/切换成本模型|\n|---|---|\n|周转|完成C−到达A|\n|等待|C−A−服务B|\n|首次CPU响应|首次开始S−A，不等于应用实际响应|\n|带权周转|(C−A)/B，无ms单位|\n|利用率|忙碌时长/统计窗口，平台窗口从0至最后完成|",
        10: "|策略|决策依据|新短任务到达|\n|---|---|---|\n|FCFS|已就绪者到达/入队先后|不抢占|\n|非抢占SJF|当前就绪者服务量最短|不抢占当前任务|\n|平局|同到达按输入序；SJF再按到达/输入序|未到达者不能参与|",
        11: "|事件|动作|\n|---|---|\n|任务未完成且片到|回队尾|\n|不足q提前完成|立即退出，不占满剩余片|\n|片段中/边界有新到达|先把新到达者入队，再回队当前未完成者|\n|没有就绪者|CPU空闲至下一到达|",
    }
    safe_cases = {
        12: "下面是静态教学推演，目前不提供SRTF或HRRF运行按钮。\n\nSRTF：P1(0,8)、P2(1,4)、P3(2,9)、P4(3,5)。轨迹：P1 0–1，P2 1–5，P4 5–10，P1 10–17，P3 17–26；平均周转13ms。\n\nHRRF：P1(0,20)、P2(5,15)、P3(10,5)、P4(15,10)。顺序1→3→2→4；平均周转26.25ms。两组输入不可混用。"
    }
    items = []
    reading = {}
    for n, sec, title, nums, intro, maps, flows in units:
        cs = [by[f"CH02-K{x:03}"] for x in nums]
        tracked = cs + (
            [by["CH02-K005"]]
            if n == 2
            else [by[f"CH02-K{x:03}"] for x in [22, 23, 24]] if n == 12 else []
        )
        code = f"CH02-U{n:03}"

        def joined(field):
            return "\n\n".join("### " + c["name"] + "\n\n" + c[field] for c in cs)

        refs = []
        for c in tracked:
            for sid, pages, quote in c["sources"]:
                ref = dict(source_id=sid, pages=pages, quote=quote)
                if ref not in refs:
                    refs.append(ref)
        blocks = [
            dict(id="intro", kind="intro", title="先想一个问题", text=intro),
            dict(
                id="concept", kind="concept", title="理解关键原理", text=joined("core")
            ),
            dict(
                id="explanation",
                kind="explanation",
                title="规则、条件与对照",
                text=(tables.get(n, "") + "\n\n" + joined("rules")).strip(),
            ),
            *[
                dict(
                    id=k.lower(),
                    kind="diagram",
                    title=diagrams[k]["title"],
                    text="先选一个节点，沿带有关系和条件的连线阅读。流程导读不是算法动画。",
                    diagram=diagrams[k],
                )
                for k in maps + flows
            ],
            dict(
                id="case",
                kind="case",
                title="用例子理解",
                text=safe_cases.get(n, joined("example")),
            ),
            dict(
                id="mistake",
                kind="mistake",
                title="检查容易混淆的地方",
                text=joined("error"),
            ),
            dict(
                id="summary",
                kind="summary",
                title="用自己的话回顾",
                text="\n".join("- " + c["goal"] for c in cs),
            ),
        ]
        if n == 2:
            blocks[2][
                "text"
            ] += "\n\n### 紧急工作与延后处理\n\n中断服务先完成必须及时确认、保存的工作，其他工作可以登记后在适当上下文执行。是否可以睡眠取决于具体机制，不是所有延后工作都能阻塞。历史Linux入口细节不在这里复刻。"
        if n == 12:
            blocks.insert(
                -1,
                dict(
                    id="extensions",
                    kind="text",
                    title="其他策略概览（可选）",
                    text="\n\n".join(
                        "### "
                        + by[f"CH02-K{x:03}"]["name"]
                        + "\n\n"
                        + by[f"CH02-K{x:03}"]["core"]
                        + "\n\n当前仅提供概念说明，尚无对应计算引擎。"
                        for x in [22, 23, 24]
                    ),
                ),
            )
        # Canonical teacher text is kept; student copy removes only editorial evidence comments.
        for block in blocks:
            if block["kind"] == "diagram":
                continue
            text = block["text"]
            text = (
                text.replace("T：", "教学示例：")
                .replace("课件例：", "示例：")
                .replace("课件：", "示例：")
            )
            text = text.replace(
                "课件第7页不切进程路径，对比第5页切进程路径；T用P1请求立即成功与需等待两种服务。",
                "对比两种场景：P1请求立即成功时返回P1；P1必须等待时保存现场并选择其他就绪进程。",
            )
            text = text.replace("课件KLT题：", "KLT示例：").replace(
                "ULT题暂不采用。", ""
            )
            text = text.replace("课件印6.5ms需核实。", "").replace(
                "隐藏页给", "可选长度预测公式："
            )
            text = text.replace(
                "第10页仅写W/B，第21页为1+W/B；两者排序等价但数值不同，统一完整比值须留纠错记录。",
                "W/B与1+W/B的排序等价，但数值口径不同；本节统一完整R=1+W/B。",
            )
            text = text.replace(
                "第16页称“四个作业”但仅三行", "示例按实际输入的三个任务计算"
            )
            if text != block["text"]:
                reading[code + "/" + block["id"]] = dict(
                    expected=block["text"], text=text, hidden=False
                )
        items.append(
            dict(
                code=code,
                title=title,
                section=sec,
                record_ids=[c["id"] for c in tracked],
                phase="可选进阶·静态内容" if n == 12 else "第一批·预填草稿",
                importable=True,
                summary=intro,
                objectives="\n".join("- " + c["goal"] for c in cs),
                blocks=blocks,
                refs=refs,
                lab=n in (10, 11),
                related=[],
            )
        )
    order = [4, 5, 1, 2, 3, 6, 7, 8, 9, 10, 11, 12]
    for i, n in enumerate(order):
        items[n - 1]["sort_order"] = (i + 1) * 10
        items[n - 1]["related"] = (
            [f"CH02-U{order[i+1]:03}"] if i + 1 < len(order) else []
        )
    experiments = []
    for alg, title, kids in [
        ("fcfs", "FCFS：同到达长短任务的顺序", [9, 10]),
        ("sjf", "非抢占SJF：只从当前就绪者选最短", [9, 10]),
        ("rr", "RR：到达、片到与完成的队列边界", [9, 11]),
    ]:
        defaults = {
            "processes": [
                {"pid": "P1", "arrival": 0, "burst": 28},
                {"pid": "P2", "arrival": 0, "burst": 9},
                {"pid": "P3", "arrival": 0, "burst": 3},
            ],
            "quantum": 2,
        }
        if alg == "rr":
            defaults["processes"] = [
                {"pid": "A", "arrival": 0, "burst": 3},
                {"pid": "B", "arrival": 1, "burst": 2},
            ]
        experiments.append(
            dict(
                code="CH02-ALG00" + str(["fcfs", "sjf", "rr"].index(alg) + 1),
                algorithm=alg,
                title=title,
                knowledge_codes=[f"CH02-U{x:03}" for x in kids],
                defaults=defaults,
                objectives="从输入预测时间轴，核对完成、周转、等待和首次CPU响应。",
                instructions="单CPU、单CPU段，无I/O和切换开销。同到达按输入序；SJF非抢占且只选已到达者；RR边界先入新到达者再回队当前任务。",
                tasks="先手算再运行，解释每次选择。另测初始空闲、相同到达；RR改q观察完成与回队。",
                reference={
                    "fcfs": "S：S2-11第14页。平均周转35ms。",
                    "sjf": "S：S2-11第16页，按三行任务。平均周转55/3ms。",
                    "rr": "T：A(0,3),B(1,2),q2。A0–2,B2–4,A4–5；平均周转4ms、等待1.5、首次CPU响应0.5。",
                }[alg],
            )
        )
    summaries = []
    for line in report.splitlines():
        if line.startswith("| CH02-N"):
            c = [s.strip() for s in line.strip("|").split("|")]
            summaries.append(dict(code=c[0], text=c[1], source=c[2], handling=c[3]))
    package = dict(
        package_id="chapter02-ppt-v1.1",
        title="第二章：处理器管理",
        notice="11份教师PPT/PPTX、169物理页；基于V1.1报告。仅创建可编辑草稿，不自动发布或覆盖现有内容；原PPT需在资料管理中另行绑定。",
        sources=[
            dict(
                id=s["source"],
                filename=s["filename"],
                slides=s["pages"],
                hidden=s["hidden"],
                sha256=s["sha256"],
            )
            for s in sources
        ],
        sections=[
            dict(code=c, title=t)
            for c, t in [
                ("2.1", "处理器状态"),
                ("2.2", "中断技术"),
                ("2.3", "进程及其实现"),
                ("2.4", "线程及其实现"),
                ("2.5", "处理器调度"),
            ]
        ],
        issues=issues,
        records=records,
        summaries=summaries,
        items=items,
        experiments=experiments,
        deferred=[
            "CH02-AN001–AN008：新机制动画未实现",
            "SRTF/HRRF/优先数/反馈队列/彩票：未新增引擎",
            "80/30ms及5/50ms原题：不导入正式题库",
        ],
    )
    DEST.mkdir(exist_ok=True)
    (DEST / "chapter02.json").write_text(
        json.dumps(package, ensure_ascii=False, indent=2) + "\n"
    )
    (DEST / "chapter02_reading.json").write_text(
        json.dumps(reading, ensure_ascii=False, indent=2) + "\n"
    )
    return package


if __name__ == "__main__":
    p = build()
    print(
        f"已构建{len(p['items'])}单元、{len(p['records'])}分析记录、{len(p['experiments'])}实验草稿；未连接数据库。"
    )
