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

from app.agent.agent import (
    agent_thinking_no_search,
    agent_thinking_with_search,
    agent_with_search,
    agent_without_search,
)
from app.agent.context import build_messages_for_turn
from app.agent.deep_research import generate_clarifying_questions, run_deep_research_graph
from app.agent.events import (
    TurnAccumulator,
    sse_artifact_created,
    sse_artifact_updated,
    sse_clarifying_questions,
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

        # ── 3a. Deep research: Call 1 — generate clarifying questions ────────
        if request.deep_research_enabled and request.clarifications is None:
            try:
                questions = await generate_clarifying_questions(request.content)
            except Exception as exc:  # noqa: BLE001
                log.exception("Failed to generate clarifying questions: %s", exc)
                yield sse_error(f"Could not generate clarifying questions: {exc}")
                yield "data: [DONE]\n\n"
                return

            # Persist only the user message for now (no assistant message yet)
            user_msg_id = await session_service.save_message(
                session_id, "user", request.content
            )
            await session_service.auto_title_session(session_id, request.content)
            await session_service.touch_session(session_id)

            yield sse_clarifying_questions(questions)
            yield sse_message_ids(user_msg_id, "")   # empty assistant id — not saved yet
            yield "data: [DONE]\n\n"
            return

        # ── 3b. Deep research: Call 2 — run full research with answers ────
        if request.deep_research_enabled and request.clarifications is not None:
            import asyncio as _asyncio  # noqa: PLC0415

            # Save user message; we'll link the artifact to the assistant message
            user_msg_id = await session_service.save_message(
                session_id, "user", request.content
            )

            # Create a placeholder assistant message now so we can link the artifact
            asst_msg_id = await session_service.save_message(
                session_id,
                "assistant",
                "",  # will be updated after research completes
            )

            # Emit message IDs immediately so the client knows them from the start
            yield sse_message_ids(user_msg_id, asst_msg_id)
            # Emit initial token so the client shows something
            yield sse_token("Starting deep research…\n\n")

            sse_queue: _asyncio.Queue = _asyncio.Queue()
            artifact_result: dict | None = None
            graph_exception: Exception | None = None
            final_state: dict = {}

            # --- Concurrent: run graph + drain queue simultaneously for real-time SSE ---
            async def _run_graph() -> None:
                nonlocal final_state, graph_exception
                try:
                    final_state = await run_deep_research_graph(
                        session_id=session_id,
                        query=request.content,
                        clarifications=request.clarifications,
                        assistant_message_id=asst_msg_id,
                        sse_queue=sse_queue,
                    )
                except Exception as exc:  # noqa: BLE001
                    graph_exception = exc
                finally:
                    await sse_queue.put(None)  # sentinel to stop drain loop

            graph_task = _asyncio.create_task(_run_graph())

            # Drain the queue in real-time while the graph runs
            try:
                while True:
                    try:
                        item = await _asyncio.wait_for(sse_queue.get(), timeout=0.1)
                    except _asyncio.TimeoutError:
                        if graph_task.done():
                            break
                        continue
                    if item is None:  # sentinel — graph finished
                        break
                    if isinstance(item, dict) and "_artifact" in item:
                        artifact_result = item["_artifact"]
                        yield sse_artifact_created(artifact_result)
                    else:
                        yield item  # already-formatted SSE string

                # Drain any remaining items after sentinel
                while not sse_queue.empty():
                    item = sse_queue.get_nowait()
                    if item is None:
                        continue
                    if isinstance(item, dict) and "_artifact" in item:
                        artifact_result = item["_artifact"]
                        yield sse_artifact_created(artifact_result)
                    else:
                        yield item

            finally:
                if not graph_task.done():
                    graph_task.cancel()
                    try:
                        await graph_task
                    except (_asyncio.CancelledError, Exception):
                        pass

            if graph_exception:
                log.exception("Deep research graph error: %s", graph_exception)
                yield sse_error(f"Deep research failed: {graph_exception}")
                yield "data: [DONE]\n\n"
                return

            # Build a brief summary token for the assistant message body
            report = final_state.get("report", "")
            summary_lines = report.splitlines()
            summary = " ".join(summary_lines[:4]).strip() if summary_lines else report[:300]
            if len(summary) > 300:
                summary = summary[:300] + "…"
            if artifact_result:
                summary = f"Research complete. See the **{artifact_result.get('title', 'report')}** artifact."

            # Emit the summary as the visible response token
            yield sse_token(summary)

            # Update assistant message body with summary
            await session_service.update_message_content(asst_msg_id, summary)

            # Link artifact to assistant message
            if artifact_result:
                await artifact_service.update_artifact_source_message(
                    artifact_result["id"], asst_msg_id
                )
                await session_service.update_message_artifact(
                    asst_msg_id, artifact_result["id"]
                )

            await session_service.auto_title_session(session_id, request.content)
            await session_service.touch_session(session_id)
            yield "data: [DONE]\n\n"
            return

        # ── 3. Select agent and build per-request config ──────────────────
        # 4-way matrix: think_enabled × web_search_enabled
        if request.think_enabled:
            agent = (
                agent_thinking_with_search
                if request.web_search_enabled
                else agent_thinking_no_search
            )
            recursion_limit = 16  # thinking turns need extra headroom for <think> blocks
        else:
            agent = (
                agent_with_search if request.web_search_enabled else agent_without_search
            )
            recursion_limit = 12

        config = {
            "configurable": {"session_id": session_id},
            "recursion_limit": recursion_limit,
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
                # Only web_search gets an activity spinner; internal tools
                # (create_artifact, list_session_artifacts, get_current_datetime)
                # must NOT emit tool_activity events here — the frontend has no
                # dedicated handler for them and incorrectly maps them to the
                # web_search spinner, causing a permanent "Searching…" state.
                # Artifact creation is surfaced via sse_artifact_created instead.
                elif ev_type == "on_tool_start":
                    tool_input = event["data"].get("input", {})
                    if ev_name == "web_search":
                        yield sse_tool_activity(
                            "web_search",
                            "running",
                            query=tool_input.get("query", ""),
                        )

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
                                artifact_id = data["artifact_id"]
                                acc.created_artifact_ids.append(artifact_id)
                                # Emit immediately so the panel opens mid-stream
                                artifact = await artifact_service.get_artifact(artifact_id)
                                if artifact:
                                    yield sse_artifact_created(artifact)
                        except (json.JSONDecodeError, KeyError):
                            log.warning(
                                "Could not parse create_artifact output: %r",
                                raw_output,
                            )

                    elif ev_name == "update_artifact":
                        try:
                            data = json.loads(raw_output)
                            if data.get("status") == "updated":
                                artifact_id = data["artifact_id"]
                                acc.updated_artifact_ids.append(artifact_id)
                                # Emit immediately so the panel updates mid-stream
                                artifact = await artifact_service.get_artifact(artifact_id)
                                if artifact:
                                    yield sse_artifact_updated(artifact)
                        except (json.JSONDecodeError, KeyError):
                            log.warning(
                                "Could not parse update_artifact output: %r",
                                raw_output,
                            )

                    # list_session_artifacts and get_current_datetime are
                    # internal lookups with no dedicated frontend indicator —
                    # no SSE event needed on completion.

        except Exception as error:  # noqa: BLE001
            log.exception("Agent stream error: %s", error)
            # Translate raw HTTP/library error codes to user-readable messages
            # so the frontend banner is informative rather than cryptic.
            raw = str(error)
            if any(code in raw for code in ("502", "503", "504")):
                user_msg = (
                    "The AI service is temporarily unavailable "
                    "(gateway error). Please try again in a moment."
                )
            elif "timed out" in raw.lower() or "timeout" in raw.lower():
                user_msg = (
                    "The AI service took too long to respond. "
                    "It may be under heavy load — please try again."
                )
            elif "401" in raw or "403" in raw:
                user_msg = (
                    "API authentication failed. "
                    "Please check that your NVIDIA API key is valid."
                )
            elif "429" in raw:
                user_msg = "Rate limit reached. Please wait a moment and try again."
            elif "chat_template_kwargs" in raw or "unexpected keyword" in raw:
                user_msg = (
                    "LLM configuration error: an unsupported parameter was sent. "
                    "Please restart the backend server."
                )
            else:
                user_msg = f"Agent error: {raw}"
            yield sse_error(user_msg)
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

        # ── 7. Link tool-created artifacts to the saved message ────────────
        # (a) Artifacts created via the create_artifact tool
        # Note: sse_artifact_created was already emitted mid-stream in on_tool_end
        for artifact_id in acc.created_artifact_ids:
            await artifact_service.update_artifact_source_message(
                artifact_id, asst_msg_id
            )
            await session_service.update_message_artifact(asst_msg_id, artifact_id)

        # (b) Artifacts updated via the update_artifact tool
        # Note: sse_artifact_updated was already emitted mid-stream in on_tool_end
        for artifact_id in acc.updated_artifact_ids:
            await session_service.update_message_artifact(asst_msg_id, artifact_id)

        # (c) Fallback XML-extracted artifact (only if tool was not called)
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
