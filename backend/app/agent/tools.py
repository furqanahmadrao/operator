"""LangGraph tool definitions for the agent runtime.

Each tool is a thin, typed wrapper around an existing app service.
The app services (web_search, artifact_service) remain unchanged;
these wrappers simply adapt them to the LangGraph @tool interface.

Tool design notes
-----------------
* ``web_search``            — calls Tavily, returns structured JSON so the
                              event mapper can extract UI data from on_tool_end.
* ``create_artifact``       — creates an artifact row in the app DB immediately.
                              session_id is injected from RunnableConfig.
* ``get_current_datetime``  — returns precise UTC date/time; the agent calls
                              this when the user needs exact temporal context.
* ``list_session_artifacts``— lets the agent see what artifacts already exist
                              in the session so it can reference or build on them.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

from app.services import artifact_service
from app.services.web_search import (
    SearchAPIKeyMissing,
    SearchError,
    SearchTimeout,
    web_search_service,
)

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Web search
# ---------------------------------------------------------------------------


@tool
async def web_search(query: str) -> str:
    """Search the web for current, real-time information.

    Call this tool when the user asks about:
    - Current events, breaking news, or recent developments
    - Live prices, stock data, exchange rates, or sports scores
    - Latest software releases, product updates, or changelogs
    - Anything explicitly time-sensitive or requiring up-to-date facts

    Do NOT call for:
    - General knowledge, stable facts, mathematics, or coding help
    - Creative writing, brainstorming, or opinion generation
    - Casual conversation or greetings
    """
    try:
        result = await web_search_service.search(query)
        results_list = [
            {
                "title": r.title,
                "url": r.url,
                "snippet": r.snippet,
                "domain": r.domain,
            }
            for r in result.results
        ]
        # Build a human-readable context block for the LLM
        context_lines = [f'[WEB SEARCH RESULTS for: "{query}"]', ""]
        for i, r in enumerate(result.results, 1):
            context_lines.append(f"{i}. {r.title} — {r.domain}")
            if r.snippet:
                context_lines.append(f"   {r.snippet}")
        context_lines.extend(
            [
                "",
                "Use these results to inform your answer. Attribute sources inline.",
                "Do not fabricate citations or URLs not listed above.",
            ]
        )
        return json.dumps(
            {
                "status": "completed",
                "query": query,
                "result_count": result.result_count,
                "results": results_list,
                "context": "\n".join(context_lines),
            }
        )
    except SearchAPIKeyMissing:
        log.warning("web_search: API key missing")
        return json.dumps(
            {"status": "error", "message": "Web search API key not configured."}
        )
    except SearchTimeout:
        log.warning("web_search: timeout for query=%r", query)
        return json.dumps({"status": "error", "message": "Web search timed out."})
    except SearchError as exc:
        log.warning("web_search: provider error: %s", exc)
        return json.dumps(
            {"status": "error", "message": "Web search temporarily unavailable."}
        )


# ---------------------------------------------------------------------------
# Artifact creation
# ---------------------------------------------------------------------------


@tool
async def create_artifact(
    title: str,
    artifact_type: str,
    content: str,
    config: RunnableConfig,
) -> str:
    """Create a standalone artifact document and save it to the user's library.

    Use this tool for long-form documents the user would save, export, or
    refer back to, such as:
    - Reports, analyses, research write-ups (~400+ words of prose)
    - Project plans, roadmaps, or structured proposals
    - Full templates: README, email, contract, resume, cover letter
    - Formal technical specifications or design documents
    - Web pages, dashboards, or interactive HTML experiences

    Do NOT use for:
    - Code snippets, short Q&A replies, or conversational content
    - Prose under ~300 words that fits naturally in the chat

    Before calling this tool write one short intro sentence in the chat
    (e.g. "Here is the report you asked for.").
    Only one artifact per response.

    Args:
        title: 2–6 word title, title-cased and descriptive.
        artifact_type: ``"markdown"`` for prose/documents, or ``"html"`` for
                       self-contained web pages with all CSS/JS inlined.
        content: Full content of the artifact.  For HTML this must be a
                 complete page starting with ``<!DOCTYPE html>``.
    """
    session_id: str = config["configurable"]["session_id"]
    artifact = await artifact_service.create_artifact(
        session_id=session_id,
        title=title,
        content=content,
        artifact_type=artifact_type,
        source_message_id=None,  # linked to message after the turn completes
    )
    log.info(
        "create_artifact: id=%s title=%r type=%s session=%s",
        artifact["id"],
        title,
        artifact_type,
        session_id,
    )
    return json.dumps(
        {
            "status": "created",
            "artifact_id": artifact["id"],
            "title": artifact["title"],
            "type": artifact["type"],
            "session_id": session_id,
        }
    )


# ---------------------------------------------------------------------------
# Date / time helper
# ---------------------------------------------------------------------------


@tool
def get_current_datetime() -> str:
    """Get the current date and time in UTC.

    Call this when the user needs to know the exact current date or time,
    perform date arithmetic (e.g. "3 days from now"), or verify what counts
    as 'recent' in the context of a search or calculation.

    The current date is also available in the system prompt, but calling this
    tool returns the most precise real-time value.
    """
    now = datetime.now(timezone.utc)
    return json.dumps(
        {
            "date": now.strftime("%A, %B %d, %Y"),
            "time": now.strftime("%H:%M:%S UTC"),
            "iso8601": now.isoformat(),
            "unix_timestamp": int(now.timestamp()),
        }
    )


# ---------------------------------------------------------------------------
# Session artifact listing
# ---------------------------------------------------------------------------


@tool
async def list_session_artifacts(config: RunnableConfig) -> str:
    """List all artifacts that have been created in the current session.

    Use this to:
    - Tell the user what documents are in their library for this conversation.
    - Reference a previously created artifact before deciding to create a new one.
    - Avoid creating duplicate documents.

    Returns a list of artifacts with id, title, type, and creation time.
    """
    session_id: str = config["configurable"]["session_id"]
    artifacts = await artifact_service.list_artifacts(session_id)
    if not artifacts:
        return json.dumps(
            {
                "status": "empty",
                "message": "No artifacts have been created in this session yet.",
            }
        )
    return json.dumps(
        {
            "status": "ok",
            "count": len(artifacts),
            "artifacts": [
                {
                    "id": a["id"],
                    "title": a["title"],
                    "type": a["type"],
                    "created_at": a["created_at"],
                }
                for a in artifacts
            ],
        }
    )


# ---------------------------------------------------------------------------
# Artifact update
# ---------------------------------------------------------------------------


@tool
async def update_artifact(
    artifact_id: str,
    content: str,
    title: str | None = None,
    config: RunnableConfig = None,
) -> str:
    """Update an existing artifact with revised content.

    Use this when the user asks to edit, revise, improve, rewrite, or update
    a document that was already created in this session.

    Workflow:
    1. Call list_session_artifacts to get the artifact_id by name.
    2. Call this tool with the full replacement content.

    NEVER call create_artifact when the user wants to modify existing work.
    Always update in place so the user gets a versioned revision, not a duplicate.

    Args:
        artifact_id: The ID of the artifact to update (from list_session_artifacts).
        content: Complete replacement content — fully replaces the previous version.
        title: Optional new title. If omitted, the existing title is preserved.
    """
    session_id: str = config["configurable"]["session_id"]
    artifact = await artifact_service.update_artifact(
        artifact_id=artifact_id,
        content=content,
        title=title,
    )
    if not artifact:
        return json.dumps(
            {"status": "error", "message": f"Artifact {artifact_id!r} not found."}
        )
    log.info(
        "update_artifact: id=%s title=%r version=%s session=%s",
        artifact["id"],
        artifact["title"],
        artifact.get("version"),
        session_id,
    )
    return json.dumps(
        {
            "status": "updated",
            "artifact_id": artifact["id"],
            "title": artifact["title"],
            "type": artifact["type"],
            "version": artifact.get("version", 1),
            "session_id": session_id,
        }
    )
