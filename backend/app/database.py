"""Async SQLite database layer with error recovery."""
from __future__ import annotations

import os
import sqlite3
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import aiosqlite

from app.config import settings
from app.services.error_recovery import get_error_recovery_service, RecoverableError, ErrorType

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
    # Agent state and activity tracking tables
    """CREATE TABLE IF NOT EXISTS agent_checkpoints (
    checkpoint_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    thread_id TEXT NOT NULL,
    checkpoint_data BLOB NOT NULL,
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(session_id, thread_id)
)""",
    "CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON agent_checkpoints(session_id, created_at)",
    """CREATE TABLE IF NOT EXISTS activity_events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    correlation_id TEXT,
    tool_name TEXT,
    tool_status TEXT,
    created_at TEXT NOT NULL
)""",
    "CREATE INDEX IF NOT EXISTS idx_activity_events_session ON activity_events(session_id, timestamp)",
    "CREATE INDEX IF NOT EXISTS idx_activity_correlation ON activity_events(correlation_id)",
    """CREATE TABLE IF NOT EXISTS browser_sessions (
    id TEXT PRIMARY KEY,
    session_name TEXT NOT NULL UNIQUE,
    agent_session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
    state_path TEXT NOT NULL,
    last_activity TEXT NOT NULL,
    created_at TEXT NOT NULL
)""",
    "CREATE INDEX IF NOT EXISTS idx_browser_sessions_agent ON browser_sessions(agent_session_id, last_activity)",
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
    recovery_service = get_error_recovery_service()
    
    async def db_operation():
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            await db.execute("PRAGMA foreign_keys = ON")
            return db
    
    try:
        # Use retry logic for database connections
        result = await recovery_service.retry_with_backoff(
            operation=db_operation,
            operation_name="database_connect"
        )
        
        if result.success:
            yield result.result
        else:
            raise result.error
            
    except Exception as e:
        # Check if it's a database lock error
        if _is_database_lock_error(e):
            raise RecoverableError(
                f"Database locked: {e}",
                ErrorType.DATABASE_LOCKED,
                e
            )
        else:
            raise


async def execute_with_retry(
    query: str,
    params: tuple = (),
    operation_name: str = "database_execute",
    session_id: str = None
) -> aiosqlite.Cursor:
    """
    Execute database query with retry logic for lock handling.
    
    Args:
        query: SQL query to execute
        params: Query parameters
        operation_name: Name of the operation for logging
        session_id: Optional session ID for activity stream events
        
    Returns:
        Database cursor with results
        
    Raises:
        RecoverableError: For retryable database errors
        Exception: For non-retryable errors
    """
    recovery_service = get_error_recovery_service()
    
    async def db_execute_operation():
        async with get_db() as db:
            try:
                cursor = await db.execute(query, params)
                await db.commit()
                return cursor
            except sqlite3.OperationalError as e:
                if _is_database_lock_error(e):
                    raise RecoverableError(
                        f"Database locked during {operation_name}: {e}",
                        ErrorType.DATABASE_LOCKED,
                        e
                    )
                else:
                    raise
            except Exception as e:
                # Check for other retryable database errors
                if _is_retryable_db_error(e):
                    raise RecoverableError(
                        f"Retryable database error in {operation_name}: {e}",
                        ErrorType.TEMPORARY_FAILURE,
                        e
                    )
                else:
                    raise
    
    result = await recovery_service.retry_with_backoff(
        operation=db_execute_operation,
        operation_name=operation_name,
        session_id=session_id
    )
    
    if result.success:
        return result.result
    else:
        raise result.error


async def fetch_with_retry(
    query: str,
    params: tuple = (),
    fetch_one: bool = False,
    operation_name: str = "database_fetch",
    session_id: str = None
) -> list[aiosqlite.Row] | aiosqlite.Row | None:
    """
    Fetch data from database with retry logic.
    
    Args:
        query: SQL query to execute
        params: Query parameters
        fetch_one: If True, fetch only one row
        operation_name: Name of the operation for logging
        session_id: Optional session ID for activity stream events
        
    Returns:
        Query results (list of rows or single row)
    """
    recovery_service = get_error_recovery_service()
    
    async def db_fetch_operation():
        async with get_db() as db:
            try:
                cursor = await db.execute(query, params)
                if fetch_one:
                    return await cursor.fetchone()
                else:
                    return await cursor.fetchall()
            except sqlite3.OperationalError as e:
                if _is_database_lock_error(e):
                    raise RecoverableError(
                        f"Database locked during {operation_name}: {e}",
                        ErrorType.DATABASE_LOCKED,
                        e
                    )
                else:
                    raise
            except Exception as e:
                if _is_retryable_db_error(e):
                    raise RecoverableError(
                        f"Retryable database error in {operation_name}: {e}",
                        ErrorType.TEMPORARY_FAILURE,
                        e
                    )
                else:
                    raise
    
    result = await recovery_service.retry_with_backoff(
        operation=db_fetch_operation,
        operation_name=operation_name,
        session_id=session_id
    )
    
    if result.success:
        return result.result
    else:
        raise result.error


def _is_database_lock_error(error: Exception) -> bool:
    """Check if error is a database lock error."""
    error_str = str(error).lower()
    return any(term in error_str for term in [
        "database is locked",
        "database locked",
        "sqlite_busy",
        "cannot start a transaction within a transaction"
    ])


def _is_retryable_db_error(error: Exception) -> bool:
    """Check if database error is retryable."""
    error_str = str(error).lower()
    return any(term in error_str for term in [
        "disk i/o error",
        "temporary failure",
        "sqlite_ioerr",
        "sqlite_full"
    ])


async def cleanup_session_state(session_id: str) -> None:
    """Clean up agent state and browser sessions when a session is deleted."""
    await execute_with_retry(
        "DELETE FROM agent_checkpoints WHERE session_id = ?",
        (session_id,),
        "cleanup_agent_checkpoints"
    )
    
    await execute_with_retry(
        "DELETE FROM activity_events WHERE session_id = ?",
        (session_id,),
        "cleanup_activity_events"
    )
    
    await execute_with_retry(
        "DELETE FROM browser_sessions WHERE agent_session_id = ?",
        (session_id,),
        "cleanup_browser_sessions"
    )


async def get_agent_checkpoint(session_id: str, thread_id: str) -> dict | None:
    """Retrieve the latest checkpoint for a session and thread."""
    row = await fetch_with_retry(
        """SELECT checkpoint_data, metadata_json 
           FROM agent_checkpoints 
           WHERE session_id = ? AND thread_id = ?
           ORDER BY created_at DESC 
           LIMIT 1""",
        (session_id, thread_id),
        fetch_one=True,
        operation_name="get_agent_checkpoint"
    )
    
    if row:
        return {
            "checkpoint_data": row["checkpoint_data"],
            "metadata_json": row["metadata_json"]
        }
    return None


async def save_agent_checkpoint(
    session_id: str, 
    thread_id: str, 
    checkpoint_data: bytes, 
    metadata_json: str | None = None
) -> str:
    """Save an agent checkpoint and return the checkpoint ID."""
    import uuid
    from datetime import datetime
    
    checkpoint_id = str(uuid.uuid4())
    created_at = datetime.utcnow().isoformat()
    
    await execute_with_retry(
        """INSERT OR REPLACE INTO agent_checkpoints 
           (checkpoint_id, session_id, thread_id, checkpoint_data, metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (checkpoint_id, session_id, thread_id, checkpoint_data, metadata_json, created_at),
        "save_agent_checkpoint",
        session_id
    )
    
    return checkpoint_id


async def save_activity_event(
    session_id: str,
    event_type: str,
    timestamp: str,
    payload_json: str,
    correlation_id: str | None = None,
    tool_name: str | None = None,
    tool_status: str | None = None
) -> str:
    """Save an activity event and return the event ID."""
    import uuid
    from datetime import datetime
    
    event_id = str(uuid.uuid4())
    created_at = datetime.utcnow().isoformat()
    
    await execute_with_retry(
        """INSERT INTO activity_events 
           (id, session_id, event_type, timestamp, payload_json, 
            correlation_id, tool_name, tool_status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (event_id, session_id, event_type, timestamp, payload_json,
         correlation_id, tool_name, tool_status, created_at),
        "save_activity_event",
        session_id
    )
    
    return event_id


async def get_browser_session(session_name: str) -> dict | None:
    """Retrieve browser session by name."""
    row = await fetch_with_retry(
        """SELECT id, session_name, agent_session_id, state_path, last_activity, created_at
           FROM browser_sessions 
           WHERE session_name = ?""",
        (session_name,),
        fetch_one=True,
        operation_name="get_browser_session"
    )
    
    if row:
        return dict(row)
    return None


async def save_browser_session(
    session_name: str,
    agent_session_id: str | None,
    state_path: str
) -> str:
    """Save or update a browser session and return the session ID."""
    import uuid
    from datetime import datetime
    
    session_id = str(uuid.uuid4())
    created_at = datetime.utcnow().isoformat()
    
    await execute_with_retry(
        """INSERT OR REPLACE INTO browser_sessions 
           (id, session_name, agent_session_id, state_path, last_activity, created_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (session_id, session_name, agent_session_id, state_path, created_at, created_at),
        "save_browser_session",
        agent_session_id
    )
    
    return session_id


async def update_browser_session_activity(session_name: str) -> None:
    """Update the last activity timestamp for a browser session."""
    from datetime import datetime
    
    last_activity = datetime.utcnow().isoformat()
    
    await execute_with_retry(
        "UPDATE browser_sessions SET last_activity = ? WHERE session_name = ?",
        (last_activity, session_name),
        "update_browser_session_activity"
    )
