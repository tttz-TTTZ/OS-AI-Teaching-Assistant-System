"""确定性的单CPU教学调度；无I/O、切换开销。RR边界先入队新到达者。"""

from collections import deque
from decimal import Decimal, ROUND_CEILING
from typing import Literal
from fastapi import HTTPException
from pydantic import Field
from .algorithms import FCFSInput

Algorithm = Literal["fcfs", "sjf", "rr"]
TEMPLATES = [
    {
        "id": "fcfs",
        "title": "FCFS 先来先服务",
        "description": "非抢占；同到达按输入顺序。",
    },
    {
        "id": "sjf",
        "title": "SJF 短作业优先",
        "description": "非抢占；就绪进程中选择运行时间最短者，同长度先到达、再按输入顺序。",
    },
    {
        "id": "rr",
        "title": "RR 时间片轮转",
        "description": "抢占；时间片边界新到达者先入队，再将未完成进程放到队尾。",
    },
]


class ScheduleInput(FCFSInput):
    quantum: float = Field(default=2, gt=0, le=1000000, allow_inf_nan=False)


def calculate(algorithm: Algorithm, body: ScheduleInput) -> dict:
    def dec(v):
        return Decimal(str(v))

    q = dec(body.quantum)
    jobs = sorted(
        [
            dict(
                index=i,
                pid=p.pid,
                arrival=dec(p.arrival),
                burst=dec(p.burst),
                remaining=dec(p.burst),
            )
            for i, p in enumerate(body.processes)
        ],
        key=lambda p: (p["arrival"], p["index"]),
    )
    if (
        algorithm == "rr"
        and sum(
            int((p["burst"] / q).to_integral_value(rounding=ROUND_CEILING))
            for p in jobs
        )
        > 2000
    ):
        raise HTTPException(422, "轮转超过2000个时间片，请增大时间片或缩小输入")
    clock = Decimal(0)
    pending = 0
    ready = deque()
    timeline = []
    done = []
    while pending < len(jobs) or ready:
        while pending < len(jobs) and jobs[pending]["arrival"] <= clock:
            ready.append(jobs[pending])
            pending += 1
        if not ready:
            end = jobs[pending]["arrival"]
            timeline.append(
                dict(
                    pid="CPU 空闲",
                    start=float(clock),
                    end=float(end),
                    idle=True,
                    reason="尚无就绪进程",
                    ready=[],
                )
            )
            clock = end
            continue
        if algorithm == "sjf":
            chosen = min(ready, key=lambda p: (p["burst"], p["arrival"], p["index"]))
            ready.remove(chosen)
        else:
            chosen = ready.popleft()
        queue = [p["pid"] for p in ready]
        chosen.setdefault("start", clock)
        start = clock
        duration = (
            min(q, chosen["remaining"]) if algorithm == "rr" else chosen["remaining"]
        )
        clock += duration
        chosen["remaining"] -= duration
        timeline.append(
            dict(
                pid=chosen["pid"],
                start=float(start),
                end=float(clock),
                idle=False,
                ready=queue,
                reason={
                    "fcfs": "选择最早进入就绪队列的进程",
                    "sjf": "选择当前就绪进程中运行时间最短者",
                    "rr": "队首进程运行一个时间片或至完成",
                }[algorithm],
            )
        )
        while pending < len(jobs) and jobs[pending]["arrival"] <= clock:
            ready.append(jobs[pending])
            pending += 1
        if chosen["remaining"]:
            ready.append(chosen)
        else:
            turnaround = clock - chosen["arrival"]
            done.append(
                dict(
                    pid=chosen["pid"],
                    arrival=float(chosen["arrival"]),
                    burst=float(chosen["burst"]),
                    start=float(chosen["start"]),
                    completion=float(clock),
                    waiting=float(turnaround - chosen["burst"]),
                    turnaround=float(turnaround),
                    response=float(chosen["start"] - chosen["arrival"]),
                )
            )
    n = len(done)
    total = sum(p.burst for p in body.processes)
    return dict(
        algorithm=algorithm,
        engine_version="scheduler-1",
        quantum=body.quantum,
        timeline=timeline,
        results=done,
        average_waiting=sum(p["waiting"] for p in done) / n,
        average_turnaround=sum(p["turnaround"] for p in done) / n,
        average_response=sum(p["response"] for p in done) / n,
        cpu_utilization=total / float(clock),
        elapsed=float(clock),
    )
