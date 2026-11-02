"""Personal AI self-test validation; no teacher question-bank persistence."""
from typing import Any, Literal
from pydantic import BaseModel, Field, model_validator

class Question(BaseModel):
    prompt: str = Field(min_length=1, max_length=2000)
    kind: Literal["single", "multiple", "boolean", "short", "matching"] = "single"
    options: list[str] = Field(default_factory=list, max_length=8)
    items: list[str] = Field(default_factory=list, max_length=10)
    correct: Any = 0
    explanation: str = Field(default="", max_length=5000)

    @model_validator(mode="after")
    def valid(self):
        if not self.prompt.strip():
            raise ValueError("题干不能为空")
        if self.kind == "boolean":
            self.options = ["正确", "错误"]
        if self.kind == "short":
            if (
                not isinstance(self.correct, str)
                or not self.correct.strip()
                or len(self.correct) > 5000
            ):
                raise ValueError("简答题需要参考答案，最多5000字")
        else:
            if len(self.options) < 2 or any(
                not o.strip() or len(o) > 1000 for o in self.options
            ):
                raise ValueError("需要2–8个有效选项")
            if self.kind in ("single", "boolean"):
                if type(self.correct) != int or not 0 <= self.correct < len(
                    self.options
                ):
                    raise ValueError("正确选项无效")
            else:
                if (
                    not isinstance(self.correct, list)
                    or not self.correct
                    or any(
                        type(i) != int or not 0 <= i < len(self.options)
                        for i in self.correct
                    )
                ):
                    raise ValueError("答案应为有效选项数组")
                if self.kind == "multiple" and len(set(self.correct)) != len(
                    self.correct
                ):
                    raise ValueError("多选答案不能重复")
                if self.kind == "matching" and (
                    not self.items
                    or len(self.items) != len(self.correct)
                    or any(not i.strip() or len(i) > 500 for i in self.items)
                ):
                    raise ValueError("匹配题需逐项填写题项和正确分类")
        return self
