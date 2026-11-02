"""Pure compatibility renderer for saved personal learning animations."""
from fastapi import HTTPException
from .simulation_config import Config

def simulate(config: Config):
    c = config
    frames = []

    def add(label, explanation, nodes, time=None):
        frames.append(
            {
                "step": len(frames),
                "time": len(frames) if time is None else time,
                "label": label,
                "explanation": explanation,
                "nodes": nodes,
            }
        )

    if c.template == "memory":
        allocations = [
            ("A", c.allocation_a),
            ("B", c.allocation_b),
            ("C", c.allocation_c),
        ]
        if sum(v for _, v in allocations) > c.capacity:
            raise HTTPException(422, "分配总量超过内存容量，请减少进程分配")
        nodes = []
        add(
            "空闲内存",
            "连续分区教学简化，不代表现代虚拟内存完整实现。",
            [{"name": "空闲", "value": c.capacity, "state": "空闲"}],
        )
        used = 0
        for name, value in allocations:
            used += value
            nodes = nodes + [{"name": name, "value": value, "state": "已分配"}]
            add(
                "分配给" + name,
                f"已分配 {used} MB，剩余 {c.capacity-used} MB；进程间仍需访问保护。",
                nodes + [{"name": "空闲", "value": c.capacity - used, "state": "空闲"}],
            )
    elif c.template in ("timeshare", "concurrency"):
        n = c.tasks
        remaining = [c.duration] * n
        executed = [0] * n
        ready = []
        arrivals = set()
        blocked = {}
        io_used = set()
        cores = 1 if c.template == "timeshare" else c.cores
        running = [None] * cores
        quantum = [0] * cores
        cooling = [0] * cores
        previous = [None] * cores
        for tick in range(2000):
            for j in range(n):
                if j not in arrivals and j * c.arrival_gap <= tick:
                    ready.append(j)
                    arrivals.add(j)
            for j in list(blocked):
                if blocked[j] <= tick:
                    ready.append(j)
                    del blocked[j]
            states = []
            deferred = []  # 时间片用尽的任务下一个tick才重新调度，避免同刻占两个核。
            for core in range(cores):
                if running[core] is None and ready:
                    job = ready.pop(0)
                    running[core] = job
                    quantum[core] = c.quantum
                    if previous[core] is not None and previous[core] != job:
                        cooling[core] = c.switch_cost
                job = running[core]
                if job is None:
                    states.append(
                        {"name": f"CPU {core+1}", "state": "空闲", "value": 0}
                    )
                    continue
                if cooling[core]:
                    cooling[core] -= 1
                    states.append(
                        {
                            "name": f"CPU {core+1}",
                            "state": f"切换至 P{job+1}",
                            "value": 0,
                        }
                    )
                    continue
                remaining[job] -= 1
                executed[job] += 1
                quantum[core] -= 1
                states.append(
                    {
                        "name": f"CPU {core+1}",
                        "state": f"运行 P{job+1}",
                        "value": executed[job],
                    }
                )
                previous[core] = job
                if not remaining[job]:
                    running[core] = None
                elif c.template == "concurrency" and job == 0 and job not in io_used:
                    io_used.add(job)
                    blocked[job] = tick + 1 + c.io_delay
                    running[core] = None
                elif quantum[core] == 0:
                    deferred.append(job)
                    running[core] = None
            ready.extend(deferred)
            states += [
                {
                    "name": f"P{j+1}",
                    "state": (
                        "完成"
                        if remaining[j] == 0
                        else (
                            "等待I/O"
                            if j in blocked
                            else (
                                "运行"
                                if j in running
                                else "就绪" if j in arrivals else "未到达"
                            )
                        )
                    ),
                    "value": executed[j],
                }
                for j in range(n)
            ]
            add(
                f"时间 {tick} → {tick+1}",
                f'就绪队列：{", ".join("P"+str(j+1) for j in ready) or "空"}。完成的CPU工作量 {sum(executed)} / {n*c.duration}。倍速只改变播放速度。',
                states,
                tick,
            )
            if sum(remaining) == 0:
                break
        else:
            raise HTTPException(422, "模拟事件过多")
    elif c.template == "race":
        value = c.initial
        local = {"A": 0, "B": 0}
        order = [
            ("A", "read"),
            ("A", "add"),
            ("A", "write"),
            ("B", "read"),
            ("B", "add"),
            ("B", "write"),
        ]
        if c.interleaved and not c.locked:
            order = [
                ("A", "read"),
                ("B", "read"),
                ("A", "add"),
                ("B", "add"),
                ("A", "write"),
                ("B", "write"),
            ]
        add(
            "共享变量初值",
            f"两个进程各加1，正确结果应为{c.initial+2}。",
            [{"name": "共享计数器", "value": value, "state": "初始"}],
        )
        for process, event in order:
            if event == "read":
                local[process] = value
            elif event == "add":
                local[process] += 1
            else:
                value = local[process]
            add(
                process + " " + {"read": "读取", "add": "计算", "write": "写回"}[event],
                (
                    "互斥保护，另一进程等待临界区。"
                    if c.locked
                    else "无锁不一定错误；可切换交错顺序比较。"
                ),
                [
                    {"name": "共享计数器", "value": value, "state": "共享"},
                    {"name": "A局部值", "value": local["A"], "state": "局部"},
                    {"name": "B局部值", "value": local["B"], "state": "局部"},
                ],
            )
        add(
            "最终结果",
            f"最终 {value}；"
            + ("发生丢失更新。" if value != c.initial + 2 else "本次顺序结果正确。"),
            [
                {
                    "name": "结果",
                    "value": value,
                    "state": "正确" if value == c.initial + 2 else "丢失更新",
                }
            ],
        )
    elif c.template == "printer":
        queue = []
        for j in range(c.tasks):
            queue.append(f"文档{j+1}")
            add(
                "提交逻辑打印任务",
                "多个提交者可先提交，物理打印机仍只有1台。",
                [
                    {"name": "等待队列", "state": " → ".join(queue)},
                    {"name": "物理打印机", "state": "空闲"},
                ],
            )
        done = 0
        while queue:
            task = queue.pop(0)
            add(
                "开始打印 " + task,
                "本示例按提交顺序处理；不是所有设备都使用相同调度策略。",
                [
                    {"name": "等待队列", "state": " → ".join(queue) or "空"},
                    {"name": "物理打印机", "state": task},
                    {"name": "已完成", "value": done, "state": "任务"},
                ],
            )
            done += 1
            add(
                "完成 " + task,
                "逻辑请求依赖真实设备，虚拟不等于不占资源。",
                [
                    {"name": "物理打印机", "state": "空闲"},
                    {"name": "已完成", "value": done, "state": "任务"},
                ],
            )
    elif c.template == "async":
        add(
            "发起读取请求",
            "只有提交请求后，设备才能完成请求。",
            [{"name": "进程A", "state": "运行"}, {"name": "I/O", "state": "未提交"}],
            0,
        )
        add(
            "提交I/O并等待",
            "进程A等待，CPU可执行其他就绪进程。",
            [{"name": "进程A", "state": "等待"}, {"name": "I/O", "state": "处理中"}],
            1,
        )
        for t in range(c.io_delay):
            add(
                "其他进程获得CPU",
                "异步不等于无序，依然遵守请求与完成的因果关系。",
                [
                    {"name": "进程A", "state": "等待"},
                    {"name": "进程B", "state": "运行"},
                    {"name": "I/O", "state": "处理中"},
                ],
                2 + t,
            )
        add(
            "I/O完成通知",
            "等待进程回到就绪状态，不意味着立即抢占CPU。",
            [{"name": "进程A", "state": "就绪"}, {"name": "I/O", "state": "完成"}],
            2 + c.io_delay,
        )
        add(
            "进程A继续",
            "调度器选择A后才能继续；修改延迟比较时间线。",
            [{"name": "进程A", "state": "运行"}],
            3 + c.io_delay,
        )
    else:
        scenarios = {
            "layers": [
                ("硬件", "CPU、内存、存储与输入输出设备。"),
                ("操作系统", "协调资源并提供服务，桌面不是全部。"),
                ("支撑软件", "编译器、运行库等；Shell不等于内核。"),
                ("应用软件", "通过接口请求服务，不必强制经过所有软件层。"),
                ("请求进入OS", "打开文件需要路径解析、权限检查和设备读写。"),
                ("结果返回应用", "应用取得数据；广义与狭义OS边界需按教材说明。"),
            ],
            "perspectives": [
                ("使用者", "复制文件时关注路径与结果，不需要扇区位置。"),
                ("开发者", "通过文件接口访问；API不一定每次触发系统调用。"),
                ("程序执行", "启动→装入内存→获得CPU→请求输出→退出。"),
                ("资源管理", "统一协调CPU、内存、设备等资源。"),
            ],
            "goals": [
                ("方便用户使用", "降低使用计算机的难度。"),
                ("扩充机器功能", "提供文件、进程、虚拟地址等抽象。"),
                ("管理系统资源", "统一分配、协调与保护。"),
                ("提高系统效率", "关注吞吐量和利用率，不等于每个程序都更快。"),
                ("构筑开放环境", "标准接口、可移植和可扩展。"),
            ],
            "resources": [
                ("运行程序", "处理机、存储等模块参与。"),
                ("申请内存", "存储管理负责分配与保护。"),
                ("提交打印", "设备、缓冲和进程管理协作。"),
                ("保存文件", "文件、设备、内存和处理机均可能参与。"),
                ("下载并保存", "网络、文件、设备、内存、处理机协同。"),
            ],
            "roles": [
                ("管理员模式", "在内部协调、分配和保护资源。"),
                ("服务员模式", "对外提供程序启动、文件访问等服务。"),
                ("两种视角结合", "只是教学比喻，不表示内核只有两个模块。"),
            ],
            "history": [
                ("驱动程序", "适配硬件，不提供未经核验的代码数量。"),
                ("体系结构", "支持不同处理器架构。"),
                ("文件系统与网络", "依赖设备、内存及进程管理。"),
                (
                    "历史版本口径",
                    "代码行数不能直接代表系统质量；精确图表由教师录入来源数据。",
                ),
            ],
        }
        if c.template == "layers" and c.scenario == 1:
            scenarios["layers"][-2:] = [
                ("请求播放音乐", "应用请求读取音频，OS协调文件、内存、设备和处理器。"),
                ("声音设备输出", "解码后的音频交给输出设备；应用和系统各自承担职责。"),
            ]
        if c.template == "resources":
            involved = [{0, 1}, {0, 1}, {0, 1, 2}, {0, 1, 2, 3}, {0, 1, 2, 3, 4}]
            for idx, (name, explanation) in enumerate(scenarios["resources"]):
                add(
                    name,
                    explanation,
                    [
                        {
                            "name": module,
                            "state": "当前" if i in involved[idx] else "本例未涉及",
                        }
                        for i, module in enumerate(
                            ["处理机", "存储", "设备", "文件", "网络与通信"]
                        )
                    ],
                )
            return {
                "engine_version": 1,
                "config": c.model_dump(),
                "frames": frames,
                "disclaimer": "教学简化示意，同一事件可涉及多个资源管理模块。",
            }
        for name, explanation in scenarios[c.template]:
            add(
                name,
                explanation,
                [
                    {"name": n, "state": "当前" if n == name else "可探索"}
                    for n, _ in scenarios[c.template]
                ],
            )
    return {
        "engine_version": 1,
        "config": c.model_dump(),
        "frames": frames,
        "disclaimer": "教学简化模拟，不代表真实操作系统的完整实现。",
    }
