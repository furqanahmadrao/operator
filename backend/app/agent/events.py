"""SSE event helpers and per-turn state accumulator.

Provides:
* Lightweight helper functions that format payloads as SSE data lines.
* ``TurnAccumulator`` — collects side-effect data (tokens, search results,
  created artifact IDs, thinking content) during an agent turn so that
  post-stream persistence and SSE emission logic stays readable.

Think-tag streaming
-------------------
Some reasoning-capable models (historically DeepSeek-R1 and newer
DeepSeek releases) emit ``<think>...</think>``
blocks inline with their response.  ``TurnAccumulator.feed_chunk()`` parses
these in real-time:

  * Text outside ``<think>`` blocks → ``full_response`` / ``token`` SSE events.
  * Text inside  ``<think>`` blocks → ``thinking_buffer`` / ``thinking`` SSE events.

The frontend ignores ``thinking`` events if it does not handle them; regular
``token`` events remain clean.  ``full_response`` never contains raw think tags.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any


# ---------------------------------------------------------------------------
# SSE formatting helpers
# ---------------------------------------------------------------------------


def sse(payload: dict[str, Any]) -> str:
    """Serialize *payload* as a Server-Sent Events ``data:`` line."""
    return f"data: {json.dumps(payload)}\n\n"


def sse_token(content: str) -> str:
    return sse({"type": "token", "content": content})


def sse_thinking(content: str) -> str:
    """Emit a thinking/reasoning token (hidden reasoning from the model)."""
    return sse({"type": "thinking", "content": content})


def sse_tool_activity(tool_name: str, status: str, **extra: Any) -> str:
    return sse({"type": "tool_activity", "tool": tool_name, "status": status, **extra})


def sse_search_results(
    query: str,
    results: list[dict],
    result_count: int,
    search_id: str,
) -> str:
    return sse(
        {
            "type": "search_results",
            "tool": "web_search",
            "query": query,
            "results": results,
            "result_count": result_count,
            "search_id": search_id,
        }
    )


def sse_artifact_created(artifact: dict) -> str:
    return sse({"type": "artifact_created", "artifact": artifact})


def sse_artifact_updated(artifact: dict) -> str:
    return sse({"type": "artifact_updated", "artifact": artifact})


def sse_message_ids(user_message_id: str, assistant_message_id: str) -> str:
    return sse(
        {
            "type": "message_ids",
            "user_message_id": user_message_id,
            "assistant_message_id": assistant_message_id,
        }
    )


def sse_error(message: str) -> str:
    return sse({"type": "error", "message": message})


def sse_clarifying_questions(questions: list[dict]) -> str:
    """Emit clarifying questions before a deep research run begins.

    Each question dict: ``{"id": str, "text": str, "choices": list[str]}``.
    """
    return sse({"type": "clarifying_questions", "questions": questions})


def sse_deep_research_plan(sub_questions: list[str], iteration: int) -> str:
    """Emit the planned sub-questions for a deep research iteration."""
    return sse(
        {
            "type": "deep_research_plan",
            "sub_questions": sub_questions,
            "iteration": iteration,
        }
    )


def sse_deep_research_progress(step: str) -> str:
    """Emit a deep research progress step.

    step values: ``"evaluating"`` | ``"synthesizing"`` | ``"writing"``
    """
    return sse({"type": "deep_research_progress", "step": step})


def sse_todo_update(items: list[dict]) -> str:
    """Emit a todo/task-list update during a deep research run.

    Each item: ``{"id": str, "text": str, "status": "pending"|"active"|"done"}``
    """
    return sse({"type": "todo_update", "items": items})


# ---------------------------------------------------------------------------
# Per-turn accumulator
# ---------------------------------------------------------------------------


@dataclass
class TurnAccumulator:
    """Collects content and side-effect data during an agent turn.

    Attributes
    ----------
    full_response:
        Non-thinking assistant text tokens (what gets saved to DB and shown).
    thinking_buffer:
        Reasoning/thinking content stripped from the response stream.
    search_events:
        Structured search result payloads for ``metadata_json`` persistence.
    created_artifact_ids:
        IDs of artifacts created by ``create_artifact`` tool calls this turn.

    Internal streaming state
    ------------------------
    ``feed_chunk(content)`` routes each streaming chunk into ``full_response``
    or ``thinking_buffer`` by detecting ``<think>``/``</think>`` tags.
    """

    full_response: str = ""
    thinking_buffer: str = ""
    search_events: list[dict] = field(default_factory=list)
    created_artifact_ids: list[str] = field(default_factory=list)
    updated_artifact_ids: list[str] = field(default_factory=list)

    # Internal streaming think-tag state (excluded from repr / __init__)
    _in_thinking: bool = field(default=False, init=False, repr=False)
    _pending: str = field(default="", init=False, repr=False)

    def feed_chunk(self, content: str) -> tuple[str, str]:
        """Route a streaming content chunk through the think-tag state machine.

        Returns
        -------
        (response_text, thinking_text)
            ``response_text`` should be emitted as ``token`` SSE events and
            accumulated into ``full_response``.
            ``thinking_text`` should be emitted as ``thinking`` SSE events.

        Implementation note
        -------------------
        The parser is deliberately kept simple: it does not handle ``<think>``
        tags split across chunk boundaries (very rare in practice).  If a model
        generates such a split the partial tag characters pass through as
        response tokens; no data is lost.
        """
        self._pending += content
        resp_parts: list[str] = []
        think_parts: list[str] = []

        while self._pending:
            if self._in_thinking:
                end = self._pending.find("</think>")
                if end == -1:
                    # Still inside; buffer everything
                    think_parts.append(self._pending)
                    self._pending = ""
                else:
                    think_parts.append(self._pending[:end])
                    self._pending = self._pending[end + 8:]  # len("</think>") == 8
                    self._in_thinking = False
            else:
                start = self._pending.find("<think>")
                if start == -1:
                    resp_parts.append(self._pending)
                    self._pending = ""
                else:
                    resp_parts.append(self._pending[:start])
                    self._pending = self._pending[start + 7:]  # len("<think>") == 7
                    self._in_thinking = True

        response_text = "".join(resp_parts)
        thinking_text = "".join(think_parts)
        self.full_response += response_text
        self.thinking_buffer += thinking_text
        return response_text, thinking_text

