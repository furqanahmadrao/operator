"""LangGraph agent factory and singleton instances.

Two compiled graphs are built at import time:
* ``agent_with_search``    — includes the web_search tool
* ``agent_without_search`` — omits web_search (respects the UI toggle)

Both agents are stateless: no LangGraph checkpointer is used.
The full conversation history is injected via messages on every turn,
and persistence is handled by the app's own session_service.
"""
from __future__ import annotations

import logging
import os

from langchain_litellm import ChatLiteLLM
from langgraph.prebuilt import create_react_agent
from app.services.llm import make_chat_llm

from app.agent.tools import (
    create_artifact,
    get_current_datetime,
    list_session_artifacts,
    update_artifact,
    web_fetch,
    web_search,
)
from app.config import settings

log = logging.getLogger(__name__)

# Disable LangSmith telemetry — we don't use it and don't want silent
# network calls during development.
os.environ.setdefault("LANGCHAIN_TRACING_V2", "false")


def _make_llm(
    model: str | None = None,
    max_tokens: int | None = None,
    temperature: float = 0.6,
) -> ChatLiteLLM:
    """Return a ChatLiteLLM instance configured via the central LLM factory.

    Delegates provider wiring to app.services.llm.make_chat_llm so
    adding new providers only requires changes in that module.
    """
    return make_chat_llm(model=model, max_tokens=max_tokens, temperature=temperature, streaming=True)


def _make_thinking_llm() -> ChatLiteLLM:
    """Return a ChatLiteLLM configured for reasoning/thinking turns.

    Selected automatically when the user toggles Think ON in the UI
    (``think_enabled=True`` in the request body).  Provider and model
    are resolved from ``settings.thinking_model`` / ``settings.chat_model``
    by ``make_chat_llm`` — no hardcoded model names here.

    Differences from the normal LLM:
    * ``temperature=0``  — deterministic, methodical reasoning.
    * ``max_tokens`` raised to 16 k — room for a reasoning block + answer.
    """
    return make_chat_llm(
        max_tokens=settings.thinking_max_tokens,
        temperature=0.0,
        streaming=True,
        thinking=True,
    )


def _build_agent(tools: list, llm: ChatLiteLLM | None = None):
    """Compile a ReAct agent graph with *tools* and an optional *llm*."""
    resolved_llm = llm if llm is not None else _make_llm()
    log.info(
        "Building agent with tools: %s",
        [getattr(t, "name", str(t)) for t in tools],
    )
    return create_react_agent(model=resolved_llm, tools=tools)


# ---------------------------------------------------------------------------
# Singletons — compiled once at startup, reused for all requests.
# Session context and tool config are injected per-turn via messages + config.
# ---------------------------------------------------------------------------

# Core tools always available regardless of web_search toggle
_CORE_TOOLS = [create_artifact, update_artifact, get_current_datetime, list_session_artifacts]

# Web tools that can be toggled
_WEB_TOOLS = [web_search, web_fetch]

agent_with_search = _build_agent(tools=[*_WEB_TOOLS, *_CORE_TOOLS])
agent_without_search = _build_agent(tools=_CORE_TOOLS)

# Thinking-mode agents — use a reasoning-capable model (formerly
# DeepSeek‑R1).  By default this will be the same model as ``agent_with_search``
# but instantiated with a lower temperature and higher token budget.  The
# toggle is still controlled by the ``think_enabled`` flag in
# SessionChatRequest; session_chat.py raises the recursion limit when
# thinking is active because the model may emit long ``<think>`` fragments.
agent_thinking_with_search = _build_agent(
    tools=[*_WEB_TOOLS, *_CORE_TOOLS], llm=_make_thinking_llm()
)
agent_thinking_no_search = _build_agent(
    tools=_CORE_TOOLS, llm=_make_thinking_llm()
)
