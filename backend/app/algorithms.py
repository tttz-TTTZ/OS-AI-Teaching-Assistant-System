"""不依赖 AI 或数据库的 FCFS 实现。相同到达时间按输入顺序处理。"""

from pydantic import BaseModel, Field, ConfigDict, field_validator, model_validator


class Process(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    pid: str = Field(min_length=1, max_length=30)
    arrival: float = Field(ge=0, le=1000000)
    burst: float = Field(gt=0, le=1000000)

    @field_validator("pid")
    @classmethod
    def clean_pid(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("进程 ID 不能为空")
        return value.strip()


class FCFSInput(BaseModel):
    processes: list[Process] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def unique_ids(self):
        ids = [p.pid for p in self.processes]
        if len(ids) != len(set(ids)):
            raise ValueError("进程 ID 不可重复")
        return self


def fcfs(processes: list[Process]) -> dict:
    clock = 0.0
    results, timeline = [], []
    for p in sorted(processes, key=lambda p: p.arrival):
        if clock < p.arrival:
            timeline.append(
                {"pid": "CPU 空闲", "start": clock, "end": p.arrival, "idle": True}
            )
            clock = p.arrival
        start = clock
        clock += p.burst
        results.append(
            {
                **p.model_dump(),
                "start": start,
                "completion": clock,
                "waiting": start - p.arrival,
                "turnaround": clock - p.arrival,
            }
        )
        timeline.append({"pid": p.pid, "start": start, "end": clock, "idle": False})
    return {
        "results": results,
        "timeline": timeline,
        "average_waiting": sum(p["waiting"] for p in results) / len(results),
        "average_turnaround": sum(p["turnaround"] for p in results) / len(results),
    }
