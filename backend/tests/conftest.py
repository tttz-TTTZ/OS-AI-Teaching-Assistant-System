"""普通测试明确禁用启动内容替换；专用用例启用并验证它，避免污染各自固定夹具。"""

import pytest


@pytest.fixture(autouse=True)
def isolated_content_upgrade(monkeypatch):
    monkeypatch.setenv("CHAPTER01_AUTO_APPLY", "0")
    monkeypatch.setenv("CHAPTER04_AUTO_CORRECT", "0")
