"""Shared database configuration and transactions, independent of the web app."""

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env", override=False)
_configured_path = Path(os.getenv("DATABASE_PATH", "data/assistant.db"))
DB_PATH = (
    _configured_path
    if _configured_path.is_absolute()
    else BACKEND_DIR / _configured_path
)


def db_path() -> Path:
    return DB_PATH


@contextmanager
def database():
    connection = sqlite3.connect(DB_PATH, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    try:
        with connection:
            yield connection
    finally:
        connection.close()
