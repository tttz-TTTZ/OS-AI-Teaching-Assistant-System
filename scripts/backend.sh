#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../backend"
if [ -f .env ]; then set -a; source .env; set +a; fi
exec ../.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
