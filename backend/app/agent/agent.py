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
    web_search,
)
from app.config import settings

log = logging.getLogger(__name__)

# Disable LangSmith telemetry — we don't use it and don't want silent
# network calls during development.
os.environ.setdefault("LANGCHAIN_TRACING_V2", "false")


def _make_llm() -> ChatOpenAI:
    """Return a ChatOpenAI client pointed at the NVIDIA OpenAI-compatible API."""
    return ChatOpenAI(
        base_url=settings.nvidia_base_url,
        api_key=settings.nvidia_api_key,
        model=settings.nvidia_model,
        max_tokens=settings.nvidia_max_tokens,
        streaming=True,
        temperature=0.6,
    )


def _build_agent(tools: list):
    """Compile a ReAct agent graph with *tools*."""
    llm = _make_llm()
    log.info(
        "Building agent with tools: %s",
        [getattr(t, "name", str(t)) for t in tools],
    )
    return create_react_agent(model=llm, tools=tools)


# ---------------------------------------------------------------------------
# Singletons — compiled once at startup, reused for all requests.
# Session context and tool config are injected per-turn via messages + config.
# ---------------------------------------------------------------------------

# Core tools always available regardless of web_search toggle
_CORE_TOOLS = [create_artifact, get_current_datetime, list_session_artifacts]

agent_with_search = _build_agent(tools=[web_search, *_CORE_TOOLS])
agent_without_search = _build_agent(tools=_CORE_TOOLS)
