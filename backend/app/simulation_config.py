from typing import Literal
from pydantic import BaseModel, Field, model_validator, ConfigDict

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
