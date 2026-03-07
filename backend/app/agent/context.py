"""Conversation context assembly.

Loads session history from the app database and converts it into
a list of LangChain BaseMessage objects ready to pass to the agent.

The agent has no persistent state of its own; the full conversation
context is re-injected from the app DB on every turn.
"""
from __future__ import annotations

from datetime import datetime, timezone

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

from app.config.system_prompt import build_system_prompt
from app.services import session_service


async def build_messages_for_turn(
    session_id: str,
    user_content: str,
    project_system_prompt: str | None = None,
) -> list[BaseMessage]:
    """Load history from the app DB and return a complete message list.

    Parameters
    ----------
    session_id:
        The session whose history we should load.
    user_content:
        The new user message for this turn.
    project_system_prompt:
        Optional project-level system prompt override.  When provided it
        replaces the default base prompt entirely.
    """
    session_data = await session_service.get_session_with_messages(session_id)
    history = session_data["messages"] if session_data else []

    # ── System prompt ────────────────────────────────────────────────────
    system_prompt = build_system_prompt(project_override=project_system_prompt)

    # Append current date/time so the model always knows the temporal context
    current_dt = datetime.now(timezone.utc)
    date_str = current_dt.strftime("%A, %B %d, %Y")
    time_str = current_dt.strftime("%H:%M UTC")
    date_context = (
        f"\n\nCurrent date and time: {date_str} at {time_str}. "
        "Always use this for time-sensitive questions, date calculations, "
        "and when determining what counts as 'recent' or 'current'."
    )
    full_system = system_prompt + date_context

    # ── Assemble messages ────────────────────────────────────────────────
    messages: list[BaseMessage] = [SystemMessage(content=full_system)]

    for msg in history:
        role = msg.get("role")
        content = msg.get("content", "")
        if role == "user":
            messages.append(HumanMessage(content=content))
        elif role == "assistant":
            messages.append(AIMessage(content=content))
        # system messages from history are skipped — we manage the system
        # prompt ourselves rather than re-injecting stale history prompts.

    messages.append(HumanMessage(content=user_content))
    return messages
