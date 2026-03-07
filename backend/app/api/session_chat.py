"""Session-aware chat endpoint — agent-powered streaming with tool calling.

Pipeline per turn
-----------------
1.  Validate session; resolve project system prompt.
2.  Build LangChain message list from app DB history (context.py).
3.  Stream the LangGraph ReAct agent; map events → SSE.
4.  Persist user + assistant messages with tool-event metadata.
5.  Link any created artifacts to the assistant message.
6.  Fallback: regex-extract ``<artifact>`` blocks if the tool was not called.
7.  Auto-title session, emit message IDs, send [DONE].

SSE event types emitted
-----------------------
token              — streaming text chunk from the LLM
thinking           — reasoning/thinking tokens (hidden model reasoning)
tool_activity      — tool start / completion / error indicator
search_results     — structured Tavily results for the sources panel
artifact_created   — newly saved artifact object
message_ids        — DB IDs of the saved user/assistant messages
error              — non-fatal or fatal error description
[DONE]             — end-of-stream sentinel
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.agent.agent import agent_with_search, agent_without_search
from app.agent.context import build_messages_for_turn
from app.agent.events import (
    TurnAccumulator,
    sse_artifact_created,
    sse_error,
    sse_message_ids,
    sse_search_results,
    sse_thinking,
    sse_token,
    sse_tool_activity,
)
from app.api.schemas import SessionChatRequest
from app.services import artifact_service, session_service

log = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# Matches <think>...</think> blocks that some reasoning models emit inline.
# We strip residuals before saving to DB; the stream handler already routes
# them through TurnAccumulator.feed_chunk() during streaming.
_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)


def _strip_thinking(text: str) -> str:
    """Remove any residual <think>...</think> blocks from a completed response."""
    return _THINK_RE.sub("", text).strip()


def _extract_tool_output(raw: object) -> str:
    """Normalise a tool output from an ``on_tool_end`` event to a plain string.

    LangGraph may deliver the output as a ``ToolMessage``, a bare string, or
    a dict; we want a consistent string we can attempt to JSON-parse.
    """
    if hasattr(raw, "content"):          # ToolMessage / AIMessage
        raw = raw.content
    if isinstance(raw, list) and raw:    # content-block lists
        raw = raw[0]
    if isinstance(raw, dict):
        return json.dumps(raw)
    return str(raw) if raw is not None else ""


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------


@router.post("/sessions/{session_id}/chat")
async def session_chat(session_id: str, request: SessionChatRequest):
    session = await session_service.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    async def event_generator():  # noqa: PLR0912, PLR0915
        # ── 1. Resolve project system prompt ──────────────────────────────
        project_system_prompt: str | None = None
        if session.get("project_id"):
            from app.services import project_service  # noqa: PLC0415

            project = await project_service.get_project(session["project_id"])
            if project and project.get("system_prompt"):
                project_system_prompt = project["system_prompt"]

        # ── 2. Build conversation context from app DB ─────────────────────
        messages = await build_messages_for_turn(
            session_id=session_id,
            user_content=request.content,
            project_system_prompt=project_system_prompt,
        )

        # ── 3. Select agent and build per-request config ──────────────────
        agent = (
            agent_with_search if request.web_search_enabled else agent_without_search
        )
        config = {
            "configurable": {"session_id": session_id},
            # Safety guard: prevent runaway tool-calling loops.
            # Most turns complete in 1-3 iterations; 12 gives ample headroom
            # for multi-step research tasks without runaway loops.
            "recursion_limit": 12,
        }

        # ── 4. Stream agent events → SSE ──────────────────────────────────
        acc = TurnAccumulator()
        try:
            async for event in agent.astream_events(
                {"messages": messages},
                config=config,
                version="v2",
            ):
                ev_type: str = event["event"]
                ev_name: str = event.get("name", "")

                # ── LLM text tokens ──────────────────────────────────────
                if ev_type == "on_chat_model_stream":
                    chunk = event["data"]["chunk"]
                    # Skip chunks that carry only tool-call argument fragments.
                    # These chunks contain structured JSON for the function call
                    # parameters, NOT displayable text — forwarding them would
                    # inject raw JSON into the response stream.
                    if getattr(chunk, "tool_call_chunks", None):
                        continue
                    content = chunk.content
                    if isinstance(content, str) and content:
                        resp_text, think_text = acc.feed_chunk(content)
                        if resp_text:
                            yield sse_token(resp_text)
                        if think_text:
                            yield sse_thinking(think_text)
                    elif isinstance(content, list):
                        # Content-block format (Anthropic / some NVIDIA models)
                        for part in content:
                            if isinstance(part, dict) and part.get("type") == "text":
                                text = part.get("text", "")
                                if text:
                                    resp_text, think_text = acc.feed_chunk(text)
                                    if resp_text:
                                        yield sse_token(resp_text)
                                    if think_text:
                                        yield sse_thinking(think_text)

                # ── Tool start — show activity spinner ───────────────────
                elif ev_type == "on_tool_start":
                    tool_input = event["data"].get("input", {})
                    if ev_name == "web_search":
                        yield sse_tool_activity(
                            "web_search",
                            "running",
                            query=tool_input.get("query", ""),
                        )
                    elif ev_name == "create_artifact":
                        yield sse_tool_activity(
                            "create_artifact",
                            "running",
                            title=tool_input.get("title", ""),
                        )
                    elif ev_name == "list_session_artifacts":
                        yield sse_tool_activity("list_session_artifacts", "running")
                    elif ev_name == "get_current_datetime":
                        yield sse_tool_activity("get_current_datetime", "running")

                # ── Tool end — emit structured results or artifact ────────
                elif ev_type == "on_tool_end":
                    raw_output = _extract_tool_output(event["data"].get("output"))

                    if ev_name == "web_search":
                        try:
                            data = json.loads(raw_output)
                            if data.get("status") == "completed":
                                search_id = str(uuid.uuid4())
                                yield sse_search_results(
                                    query=data["query"],
                                    results=data["results"],
                                    result_count=data["result_count"],
                                    search_id=search_id,
                                )
                                acc.search_events.append(
                                    {
                                        "type": "web_search",
                                        "status": "completed",
                                        "query": data["query"],
                                        "result_count": data["result_count"],
                                        "results": data["results"],
                                        "search_id": search_id,
                                        "timestamp": _now(),
                                    }
                                )
                            else:
                                yield sse_tool_activity(
                                    "web_search",
                                    "error",
                                    message=data.get("message", "Search failed."),
                                )
                        except (json.JSONDecodeError, KeyError):
                            log.warning(
                                "Could not parse web_search output: %r", raw_output
                            )

                    elif ev_name == "create_artifact":
                        try:
                            data = json.loads(raw_output)
                            if data.get("status") == "created":
                                acc.created_artifact_ids.append(data["artifact_id"])
                        except (json.JSONDecodeError, KeyError):
                            log.warning(
                                "Could not parse create_artifact output: %r",
                                raw_output,
                            )

                    # Completion acknowledgement for informational tools
                    elif ev_name in ("list_session_artifacts", "get_current_datetime"):
                        yield sse_tool_activity(ev_name, "completed")

        except Exception as error:  # noqa: BLE001
            log.exception("Agent stream error: %s", error)
            yield sse_error(str(error))
            yield "data: [DONE]\n\n"
            return

        # ── 5. Fallback: XML artifact extraction if tool was not called ────
        # Preserves compatibility with any residual <artifact> tag output.
        fallback_artifact_data: dict | None = None
        if not acc.created_artifact_ids:
            clean_text, fallback_artifact_data = artifact_service.extract_artifact(
                acc.full_response
            )
            if fallback_artifact_data:
                acc.full_response = clean_text  # strip tags from persisted message

        # ── 6. Persist user + assistant messages ──────────────────────────
        metadata_json: str | None = None
        if acc.search_events:
            metadata_json = json.dumps({"tool_events": acc.search_events})

        # Strip any residual <think> blocks before saving — feed_chunk()
        # handles them during streaming, but guard against edge cases where
        # the stream ended inside a still-open <think> block.
        clean_response = _strip_thinking(acc.full_response)

        user_msg_id = await session_service.save_message(
            session_id, "user", request.content
        )
        asst_msg_id = await session_service.save_message(
            session_id, "assistant", clean_response, metadata_json=metadata_json
        )

        # ── 7. Link tool-created artifacts + emit artifact_created ─────────
        # (a) Artifacts created via the create_artifact tool
        for artifact_id in acc.created_artifact_ids:
            await artifact_service.update_artifact_source_message(
                artifact_id, asst_msg_id
            )
            await session_service.update_message_artifact(asst_msg_id, artifact_id)
            artifact = await artifact_service.get_artifact(artifact_id)
            if artifact:
                yield sse_artifact_created(artifact)

        # (b) Fallback XML-extracted artifact
        if fallback_artifact_data:
            artifact = await artifact_service.create_artifact(
                session_id=session_id,
                title=fallback_artifact_data["title"],
                content=fallback_artifact_data["content"],
                artifact_type=fallback_artifact_data["type"],
                source_message_id=asst_msg_id,
            )
            await session_service.update_message_artifact(asst_msg_id, artifact["id"])
            yield sse_artifact_created(artifact)

        # ── 8. Session bookkeeping ─────────────────────────────────────────
        await session_service.auto_title_session(session_id, request.content)
        await session_service.touch_session(session_id)

        # ── 9. Emit message IDs then close stream ──────────────────────────
        yield sse_message_ids(user_msg_id, asst_msg_id)
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
