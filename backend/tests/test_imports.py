"""Business modules must be independently importable for manual debugging."""

import os
from pathlib import Path
import subprocess
import sys

import pytest


@pytest.mark.parametrize(
    "module",
    ["app.distillation", "app.personal_sources", "app.personal_learning", "app.personal_chat", "app.auth"],
)
def test_module_import_does_not_bootstrap_web_app(module, tmp_path):
    backend = Path(__file__).resolve().parents[1]
    target = tmp_path / "not-created.db"
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import importlib,sys; importlib.import_module(sys.argv[1]); "
            "assert 'app.main' not in sys.modules",
            module,
        ],
        cwd=tmp_path,
        env={**os.environ, "PYTHONPATH": str(backend), "DATABASE_PATH": str(target)},
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert result.returncode == 0, result.stderr
    assert not target.exists()
