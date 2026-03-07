"""Session and message persistence layer."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from app.database import get_db


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------


async def create_session(
    title: str = "New Chat",
    project_id: str | None = None,
) -> dict[str, Any]:
    session_id = str(uuid.uuid4())
    now = _now()
    async with get_db() as db:
        await db.execute(
            """INSERT INTO sessions (id, title, pinned, project_id, created_at, updated_at)
               VALUES (?, ?, 0, ?, ?, ?)""",
            (session_id, title, project_id, now, now),
        )
        await db.commit()
    return {
        "id": session_id,
        "title": title,
        "pinned": False,
        "project_id": project_id,
        "created_at": now,
        "updated_at": now,
    }


async def list_sessions() -> list[dict[str, Any]]:
    async with get_db() as db:
        cursor = await db.execute(
            """SELECT id, title, pinned, project_id, created_at, updated_at
               FROM sessions
               ORDER BY pinned DESC, updated_at DESC"""
        )
        rows = await cursor.fetchall()
    return [dict(row) for row in rows]


async def get_session(session_id: str) -> dict[str, Any] | None:
    async with get_db() as db:
        cursor = await db.execute(
            """SELECT id, title, pinned, project_id, created_at, updated_at
               FROM sessions WHERE id = ?""",
            (session_id,),
        )
        row = await cursor.fetchone()
    return dict(row) if row else None


async def get_session_with_messages(session_id: str) -> dict[str, Any] | None:
    async with get_db() as db:
        s_cur = await db.execute(
            """SELECT id, title, pinned, project_id, created_at, updated_at
               FROM sessions WHERE id = ?""",
            (session_id,),
        )
        session_row = await s_cur.fetchone()
        if not session_row:
            return None

        m_cur = await db.execute(
            """
            SELECT id, session_id, role, content, artifact_id, created_at, metadata_json
            FROM messages
            WHERE session_id = ?
            ORDER BY created_at ASC
            """,
            (session_id,),
        )
        msg_rows = await m_cur.fetchall()

    session = dict(session_row)
    session["messages"] = [dict(r) for r in msg_rows]
    return session


async def rename_session(session_id: str, title: str) -> dict[str, Any] | None:
    now = _now()
    async with get_db() as db:
        await db.execute(
            "UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?",
            (title, now, session_id),
        )
        await db.commit()
        cursor = await db.execute(
            """SELECT id, title, pinned, project_id, created_at, updated_at
               FROM sessions WHERE id = ?""",
            (session_id,),
        )
        row = await cursor.fetchone()
    return dict(row) if row else None


async def pin_session(session_id: str, pinned: bool) -> dict[str, Any] | None:
    """Set the pinned state of a session."""
    now = _now()
    async with get_db() as db:
        await db.execute(
            "UPDATE sessions SET pinned = ?, updated_at = ? WHERE id = ?",
            (1 if pinned else 0, now, session_id),
        )
        await db.commit()
        cursor = await db.execute(
            """SELECT id, title, pinned, project_id, created_at, updated_at
               FROM sessions WHERE id = ?""",
            (session_id,),
        )
        row = await cursor.fetchone()
    return dict(row) if row else None


async def set_session_project(
    session_id: str, project_id: str | None
) -> dict[str, Any] | None:
    """Move a session into (or out of) a project."""
    now = _now()
    async with get_db() as db:
        await db.execute(
            "UPDATE sessions SET project_id = ?, updated_at = ? WHERE id = ?",
            (project_id, now, session_id),
        )
        await db.commit()
        cursor = await db.execute(
            """SELECT id, title, pinned, project_id, created_at, updated_at
               FROM sessions WHERE id = ?""",
            (session_id,),
        )
        row = await cursor.fetchone()
    return dict(row) if row else None


async def delete_session(session_id: str) -> bool:
    async with get_db() as db:
        cursor = await db.execute(
            "DELETE FROM sessions WHERE id = ?",
            (session_id,),
        )
        await db.commit()
    return (cursor.rowcount or 0) > 0


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------


async def save_message(
    session_id: str,
    role: str,
    content: str,
    artifact_id: str | None = None,
    metadata_json: str | None = None,
) -> str:
    """Persist a message and return its UUID."""
    message_id = str(uuid.uuid4())
    now = _now()
    async with get_db() as db:
        await db.execute(
            """
            INSERT INTO messages
              (id, session_id, role, content, artifact_id, created_at, metadata_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (message_id, session_id, role, content, artifact_id, now, metadata_json),
        )
        await db.commit()
    return message_id


async def update_message_artifact(message_id: str, artifact_id: str) -> None:
    async with get_db() as db:
        await db.execute(
            "UPDATE messages SET artifact_id = ? WHERE id = ?",
            (artifact_id, message_id),
        )
        await db.commit()


# ---------------------------------------------------------------------------
# Session helpers
# ---------------------------------------------------------------------------


async def auto_title_session(session_id: str, first_message: str) -> None:
    """Update title from first user message if still 'New Chat'.

    Trims to ≤50 characters at a natural word boundary so the title is
    never cut mid-word.
    """
    # Normalise whitespace / newlines
    text = " ".join(first_message.split())

    max_len = 50
    if len(text) > max_len:
        # Try to break cleanly at the last space before the limit
        truncated = text[:max_len].rsplit(" ", 1)[0]
        # Fallback: hard-cut if there was no space at all
        title = (truncated or text[:max_len]).rstrip(" .,;:!?")
    else:
        title = text.rstrip(" .,;:!?")

    if not title:
        title = "New Chat"

    now = _now()
    async with get_db() as db:
        await db.execute(
            "UPDATE sessions SET title = ?, updated_at = ? WHERE id = ? AND title = 'New Chat'",
            (title, now, session_id),
        )
        await db.commit()


async def touch_session(session_id: str) -> None:
    """Bump updated_at to now."""
    now = _now()
    async with get_db() as db:
        await db.execute(
            "UPDATE sessions SET updated_at = ? WHERE id = ?",
            (now, session_id),
        )
        await db.commit()
