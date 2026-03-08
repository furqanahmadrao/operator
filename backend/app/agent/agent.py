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

from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

from app.agent.tools import (
    create_artifact,
    get_current_datetime,
    list_session_artifacts,
    update_artifact,
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
) -> ChatOpenAI:
    """Return a ChatOpenAI client pointed at the NVIDIA OpenAI-compatible API."""
    return ChatOpenAI(
        base_url=settings.nvidia_base_url,
        api_key=settings.nvidia_api_key,
        model=model or settings.nvidia_model,
        max_tokens=max_tokens or settings.nvidia_max_tokens,
        streaming=True,
        temperature=temperature,
        # Hard timeout: if the NVIDIA API hangs (cold start, overload, etc.)
        # raise after 90 s so the stream terminates with a proper error event
        # instead of blocking the connection indefinitely.
        request_timeout=90,
    )


def _make_thinking_llm() -> ChatOpenAI:
    """Return a ChatOpenAI client for reasoning turns.

    This is selected automatically when the user toggles Think ON in the UI
    (``think_enabled=True`` in the request body).  No environment variable
    or manual config is needed beyond choosing a model — the toggle is the
    only switch.

    Differences from the normal LLM:
    * ``temperature=0``  — deterministic, methodical reasoning.
    * ``max_tokens`` raised to 16 k — room for a reasoning block + answer.

    NOTE: The ``chat_template_kwargs`` / ``enable_thinking`` approach was
    removed — it is not a standard OpenAI API parameter and causes an
    immediate TypeError inside ``AsyncCompletions.create()``.  Thinking
    mode is instead achieved purely by model choice (an R1/reasoning variant)
    and lower temperature.  DeepSeek-v3.2 handles both normal and reasoning
    turns without any extra flags.
    """
    chosen_model = settings.nvidia_thinking_model or settings.nvidia_model

    return ChatOpenAI(
        base_url=settings.nvidia_base_url,
        api_key=settings.nvidia_api_key,
        model=chosen_model,
        max_tokens=settings.nvidia_thinking_max_tokens,
        streaming=True,
        temperature=0,
        # Same 90 s hard timeout as the normal LLM — thinking models can
        # take longer to start, but 90 s is a safe ceiling.
        request_timeout=90,
    )


def _build_agent(tools: list, llm: ChatOpenAI | None = None):
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

agent_with_search = _build_agent(tools=[web_search, *_CORE_TOOLS])
agent_without_search = _build_agent(tools=_CORE_TOOLS)

# Thinking-mode agents — use a reasoning-capable model (formerly
# DeepSeek‑R1).  By default this will be the same model as ``agent_with_search``
# but instantiated with a lower temperature and higher token budget.  The
# toggle is still controlled by the ``think_enabled`` flag in
# SessionChatRequest; session_chat.py raises the recursion limit when
# thinking is active because the model may emit long ``<think>`` fragments.
agent_thinking_with_search = _build_agent(
    tools=[web_search, *_CORE_TOOLS], llm=_make_thinking_llm()
)
agent_thinking_no_search = _build_agent(
    tools=_CORE_TOOLS, llm=_make_thinking_llm()
)
