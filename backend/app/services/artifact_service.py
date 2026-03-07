"""Artifact persistence and extraction."""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any

from app.database import get_db

# ---------------------------------------------------------------------------
# Regex — matches <artifact type="..." title="..."> OR <artifact title="..." type="...">
# Attributes can appear in either order.
# ---------------------------------------------------------------------------
_ARTIFACT_RE = re.compile(
    r'<artifact(?=\s)(?=[^>]*\btype="([^"]+)")(?=[^>]*\btitle="([^"]+)")[^>]*>'
    r'(.*?)</artifact>',
    re.DOTALL,
)


def extract_artifact(text: str) -> tuple[str, dict[str, str] | None]:
    """
    Extract a single <artifact> block from response text.

    Returns (clean_text, artifact_dict | None).
    clean_text has the artifact block stripped and trimmed so the chat
    message renders without the raw tag.
    """
    match = _ARTIFACT_RE.search(text)
    if not match:
        return text, None

    artifact_type = match.group(1).strip()
    title = match.group(2).strip()
    content = match.group(3).strip()

    # Remove the artifact block from the surrounding text
    before = text[: match.start()].rstrip()
    after = text[match.end() :].lstrip()
    clean = (before + (" " if before and after else "") + after).strip()

    return clean, {"type": artifact_type, "title": title, "content": content}


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


async def create_artifact(
    session_id: str,
    title: str,
    content: str,
    artifact_type: str = "markdown",
    source_message_id: str | None = None,
) -> dict[str, Any]:
    artifact_id = str(uuid.uuid4())
    now = _now()
    async with get_db() as db:
        await db.execute(
            """
            INSERT INTO artifacts
              (id, session_id, source_message_id, type, title, content, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                artifact_id,
                session_id,
                source_message_id,
                artifact_type,
                title,
                content,
                now,
                now,
            ),
        )
        await db.commit()
    return {
        "id": artifact_id,
        "session_id": session_id,
        "source_message_id": source_message_id,
        "type": artifact_type,
        "title": title,
        "content": content,
        "created_at": now,
        "updated_at": now,
    }


async def list_artifacts(session_id: str) -> list[dict[str, Any]]:
    async with get_db() as db:
        cursor = await db.execute(
            """
            SELECT id, session_id, source_message_id, type, title,
                   content, created_at, updated_at
            FROM artifacts
            WHERE session_id = ?
            ORDER BY created_at ASC
            """,
            (session_id,),
        )
        rows = await cursor.fetchall()
    return [dict(row) for row in rows]


async def list_all_artifacts() -> list[dict[str, Any]]:
    """Return every artifact across all sessions, enriched with session_title."""
    async with get_db() as db:
        cursor = await db.execute(
            """
            SELECT a.id, a.session_id, a.source_message_id, a.type, a.title,
                   a.content, a.created_at, a.updated_at,
                   COALESCE(s.title, 'Deleted Session') AS session_title
            FROM artifacts a
            LEFT JOIN sessions s ON a.session_id = s.id
            ORDER BY a.created_at DESC
            """
        )
        rows = await cursor.fetchall()
    return [dict(row) for row in rows]


async def get_artifact(artifact_id: str) -> dict[str, Any] | None:
    async with get_db() as db:
        cursor = await db.execute(
            """
            SELECT id, session_id, source_message_id, type, title,
                   content, created_at, updated_at
            FROM artifacts
            WHERE id = ?
            """,
            (artifact_id,),
        )
        row = await cursor.fetchone()
    return dict(row) if row else None


async def update_artifact(
    artifact_id: str,
    title: str | None = None,
    content: str | None = None,
) -> dict[str, Any] | None:
    updates: list[str] = []
    params: list[Any] = []

    if title is not None:
        updates.append("title = ?")
        params.append(title)
    if content is not None:
        updates.append("content = ?")
        params.append(content)

    if not updates:
        return await get_artifact(artifact_id)

    now = _now()
    updates.append("updated_at = ?")
    params.extend([now, artifact_id])

    async with get_db() as db:
        await db.execute(
            f"UPDATE artifacts SET {', '.join(updates)} WHERE id = ?",  # noqa: S608
            params,
        )
        await db.commit()

    return await get_artifact(artifact_id)


async def update_artifact_source_message(
    artifact_id: str, source_message_id: str
) -> None:
    """Set the source_message_id on an artifact created during agent streaming.

    Artifacts are written to the DB during tool execution (before the assistant
    message exists).  Once the message is persisted post-turn, this helper
    back-fills the link so the artifact is properly associated with its message.
    """
    async with get_db() as db:
        await db.execute(
            "UPDATE artifacts SET source_message_id = ? WHERE id = ?",
            (source_message_id, artifact_id),
        )
        await db.commit()


async def delete_artifact(artifact_id: str) -> bool:
    async with get_db() as db:
        cursor = await db.execute(
            "DELETE FROM artifacts WHERE id = ?",
            (artifact_id,),
        )
        await db.commit()
    return (cursor.rowcount or 0) > 0
