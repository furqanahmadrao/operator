"""Async SQLite database layer."""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import aiosqlite

from app.config import settings

# ---------------------------------------------------------------------------
# DDL — run once on startup via init_db()
# ---------------------------------------------------------------------------
_DDL = """
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS projects (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    system_prompt TEXT NOT NULL DEFAULT '',
    pinned        INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL DEFAULT 'New Chat',
    pinned      INTEGER NOT NULL DEFAULT 0,
    project_id  TEXT REFERENCES projects(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
    id                TEXT PRIMARY KEY,
    session_id        TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    source_message_id TEXT,
    type              TEXT NOT NULL DEFAULT 'markdown',
    title             TEXT NOT NULL,
    content           TEXT NOT NULL,
    version           INTEGER NOT NULL DEFAULT 1,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifact_revisions (
    id                TEXT PRIMARY KEY,
    artifact_id       TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    version           INTEGER NOT NULL,
    title             TEXT NOT NULL,
    content           TEXT NOT NULL,
    source_message_id TEXT,
    created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_revisions_artifact
    ON artifact_revisions(artifact_id, version);

CREATE TABLE IF NOT EXISTS messages (
    id              TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK(role IN ('system','user','assistant')),
    content         TEXT NOT NULL,
    artifact_id     TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
    created_at      TEXT NOT NULL,
    metadata_json   TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_session
    ON messages(session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_artifacts_session
    ON artifacts(session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_artifacts_created
    ON artifacts(created_at);
"""

# Idempotent column migrations — attempted on every startup; errors from
# already-existing columns are silently swallowed.
_MIGRATIONS = [
    "ALTER TABLE sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE sessions ADD COLUMN project_id TEXT",
    "ALTER TABLE projects ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE artifacts ADD COLUMN version INTEGER NOT NULL DEFAULT 1",
    """CREATE TABLE IF NOT EXISTS artifact_revisions (
    id                TEXT PRIMARY KEY,
    artifact_id       TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    version           INTEGER NOT NULL,
    title             TEXT NOT NULL,
    content           TEXT NOT NULL,
    source_message_id TEXT,
    created_at        TEXT NOT NULL
)""",
    "CREATE INDEX IF NOT EXISTS idx_revisions_artifact ON artifact_revisions(artifact_id, version)",
]


async def init_db() -> None:
    """Create the database file (and data/ directory) then run DDL."""
    db_path = settings.db_path
    data_dir = os.path.dirname(db_path)
    if data_dir:
        os.makedirs(data_dir, exist_ok=True)
    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        await db.executescript(_DDL)
        # Idempotent column migrations (ignore "duplicate column name" errors)
        for stmt in _MIGRATIONS:
            try:
                await db.execute(stmt)
            except Exception:  # noqa: BLE001
                pass
        await db.commit()


@asynccontextmanager
async def get_db() -> AsyncGenerator[aiosqlite.Connection, None]:
    """Yield an open aiosqlite connection with row_factory and FK enforcement."""
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA foreign_keys = ON")
        yield db
