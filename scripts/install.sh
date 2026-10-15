#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
npm --cache "${TMPDIR:-/tmp}/os-assistant-npm-cache" --prefix frontend ci --no-audit --no-fund
