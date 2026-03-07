"""Project persistence layer."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from app.database import get_db


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------


async def create_project(
    name: str,
    description: str = "",
    system_prompt: str = "",
) -> dict[str, Any]:
    project_id = str(uuid.uuid4())
    now = _now()
    async with get_db() as db:
        await db.execute(
            """INSERT INTO projects (id, name, description, system_prompt, pinned, created_at, updated_at)
               VALUES (?, ?, ?, ?, 0, ?, ?)""",
            (project_id, name, description, system_prompt, now, now),
        )
        await db.commit()
    return {
        "id": project_id,
        "name": name,
        "description": description,
        "system_prompt": system_prompt,
        "pinned": False,
        "session_count": 0,
        "created_at": now,
        "updated_at": now,
    }


async def list_projects() -> list[dict[str, Any]]:
    async with get_db() as db:
        cursor = await db.execute(
            """
            SELECT p.id, p.name, p.description, p.system_prompt,
                   COALESCE(p.pinned, 0) AS pinned,
                   p.created_at, p.updated_at,
                   COUNT(s.id) AS session_count
            FROM projects p
            LEFT JOIN sessions s ON s.project_id = p.id
            GROUP BY p.id
            ORDER BY p.pinned DESC, p.updated_at DESC
            """
        )
        rows = await cursor.fetchall()
    return [dict(row) for row in rows]


async def get_project(project_id: str) -> dict[str, Any] | None:
    async with get_db() as db:
        cursor = await db.execute(
            """
            SELECT p.id, p.name, p.description, p.system_prompt,
                   COALESCE(p.pinned, 0) AS pinned,
                   p.created_at, p.updated_at,
                   COUNT(s.id) AS session_count
            FROM projects p
            LEFT JOIN sessions s ON s.project_id = p.id
            WHERE p.id = ?
            GROUP BY p.id
            """,
            (project_id,),
        )
        row = await cursor.fetchone()
    return dict(row) if row else None


async def update_project(
    project_id: str,
    name: str | None = None,
    description: str | None = None,
    system_prompt: str | None = None,
) -> dict[str, Any] | None:
    updates: list[str] = []
    params: list[Any] = []

    if name is not None:
        updates.append("name = ?")
        params.append(name)
    if description is not None:
        updates.append("description = ?")
        params.append(description)
    if system_prompt is not None:
        updates.append("system_prompt = ?")
        params.append(system_prompt)

    if not updates:
        return await get_project(project_id)

    now = _now()
    updates.append("updated_at = ?")
    params.extend([now, project_id])

    async with get_db() as db:
        await db.execute(
            f"UPDATE projects SET {', '.join(updates)} WHERE id = ?",  # noqa: S608
            params,
        )
        await db.commit()
    return await get_project(project_id)


async def delete_project(project_id: str) -> bool:
    async with get_db() as db:
        cursor = await db.execute(
            "DELETE FROM projects WHERE id = ?",
            (project_id,),
        )
        await db.commit()
    return (cursor.rowcount or 0) > 0


async def list_project_sessions(project_id: str) -> list[dict[str, Any]]:
    """Return all sessions belonging to a project, pinned first."""
    async with get_db() as db:
        cursor = await db.execute(
            """SELECT id, title, pinned, project_id, created_at, updated_at
               FROM sessions
               WHERE project_id = ?
               ORDER BY pinned DESC, updated_at DESC""",
            (project_id,),
        )
        rows = await cursor.fetchall()
    return [dict(row) for row in rows]


async def pin_project(
    project_id: str, pinned: bool
) -> dict[str, Any] | None:
    """Toggle pinned state of a project."""
    async with get_db() as db:
        await db.execute(
            "UPDATE projects SET pinned = ?, updated_at = ? WHERE id = ?",
            (1 if pinned else 0, _now(), project_id),
        )
        await db.commit()
    return await get_project(project_id)


async def list_project_artifacts(project_id: str) -> list[dict[str, Any]]:
    """Return all artifacts for sessions belonging to a project."""
    async with get_db() as db:
        cursor = await db.execute(
            """SELECT a.id, a.session_id, a.source_message_id, a.type,
                      a.title, a.content, a.created_at, a.updated_at
               FROM artifacts a
               JOIN sessions s ON s.id = a.session_id
               WHERE s.project_id = ?
               ORDER BY a.created_at DESC""",
            (project_id,),
        )
        rows = await cursor.fetchall()
    return [dict(row) for row in rows]
