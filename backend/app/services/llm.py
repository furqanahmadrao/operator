from __future__ import annotations

import os
import logging
from typing import AsyncGenerator

try:
    # LiteLLM top-level — used for simple async streaming via stream_chat_completion.
    import litellm
except Exception:  # pragma: no cover - optional at import time
    litellm = None  # type: ignore

# Use the dedicated ``langchain-litellm`` package (declared in requirements.txt).
# Do NOT import from langchain_community.chat_models.litellm — that module is
# deprecated and langchain_community is not a declared dependency of this project.
from langchain_litellm import ChatLiteLLM

from app.config import settings

log = logging.getLogger(__name__)


def _ensure_provider_env() -> None:
    """Export provider credentials as env vars so LiteLLM can authenticate.

    Different LiteLLM provider adapters look for different environment variables.
    We map our generic ``settings.chat_api_key`` / ``settings.chat_base_url``
    to the correct env var names here so callers never touch os.environ directly.

    Uses ``os.environ.setdefault`` so values already set in the container
    environment (e.g. Kubernetes secrets) are never overwritten.
    """
    provider = (settings.llm_provider or "").lower()
    api_key = settings.chat_api_key
    base_url = settings.chat_base_url

    if "nvidia" in provider:
        # LiteLLM nvidia_nim adapter reads these env vars
        # Use direct assignment (not setdefault) to ensure our config takes precedence
        if api_key:
            os.environ["NVIDIA_NIM_API_KEY"] = api_key
        if base_url:
            os.environ["NVIDIA_NIM_API_BASE"] = base_url
    elif "openai" in provider:
        if api_key:
            os.environ["OPENAI_API_KEY"] = api_key
        if base_url:
            os.environ["OPENAI_API_BASE"] = base_url
    elif "anthropic" in provider:
        if api_key:
            os.environ["ANTHROPIC_API_KEY"] = api_key
    elif "groq" in provider:
        if api_key:
            os.environ["GROQ_API_KEY"] = api_key
    else:
        # Generic fallback — many OpenAI-compatible providers use OPENAI_API_KEY
        if api_key:
            os.environ["OPENAI_API_KEY"] = api_key
        if base_url:
            os.environ["OPENAI_API_BASE"] = base_url


def make_chat_llm(
    model: str | None = None,
    max_tokens: int | None = None,
    temperature: float = 0.6,
    streaming: bool = True,
    thinking: bool = False,
) -> ChatLiteLLM:
    """Return a ``ChatLiteLLM`` instance configured for the active provider.

    Provider wiring is centralised here — to add a new provider, update
    ``_ensure_provider_env`` and, if needed, adjust ``settings.llm_provider``.

    Parameters
    ----------
    model:
        Model name override.  Defaults to ``settings.chat_model`` for normal
        turns and ``settings.thinking_model`` when ``thinking=True``.
    max_tokens:
        Token limit.  Defaults to ``settings.chat_max_tokens`` or
        ``settings.thinking_max_tokens`` depending on the turn type.
    temperature:
        Sampling temperature.
    streaming:
        Whether to enable streaming mode on the LangChain model wrapper.
    thinking:
        Select the dedicated reasoning/thinking model and its higher token
        budget when ``True``.
    """
    _ensure_provider_env()

    if thinking and settings.thinking_model:
        chosen_model = settings.thinking_model
        chosen_max_tokens = max_tokens or settings.thinking_max_tokens
    else:
        chosen_model = model or settings.chat_model
        chosen_max_tokens = max_tokens or settings.chat_max_tokens

    if not chosen_model:
        raise RuntimeError(
            "Chat model not configured. Set CHAT_MODEL in backend/.env."
        )

    # Pass api_base only when explicitly configured — some cloud providers
    # (e.g. hosted Anthropic) reject requests that include an unexpected api_base.
    api_base: str | None = settings.chat_base_url or None

    return ChatLiteLLM(
        model=chosen_model,
        streaming=streaming,
        temperature=temperature,
        max_tokens=chosen_max_tokens,
        api_base=api_base,
        # Dynamic provider from settings — supports nvidia_nim, openai, anthropic, etc.
        custom_llm_provider=settings.llm_provider or None,
        request_timeout=90,
    )


async def stream_chat_completion(
    messages: list[dict], model: str | None = None
) -> AsyncGenerator[str, None]:
    """Stream chat completion via ``litellm.acompletion`` (async).

    Used by the legacy stateless ``/api/chat`` endpoint (via ``chat_service.py``).
    The session-aware ``/api/sessions/{id}/chat`` endpoint uses the LangGraph
    agent path (``make_chat_llm`` + ``create_react_agent``) instead.

    Parameters
    ----------
    messages:
        OpenAI-style message list: ``[{"role": ..., "content": ...}, ...]``.
    model:
        Model name override; defaults to ``settings.chat_model``.

    Yields
    ------
    str
        Plain-text tokens as they stream from the LLM.

    Raises
    ------
    RuntimeError
        When ``litellm`` is not installed or no model is configured.
    """
    if litellm is None:
        raise RuntimeError(
            "litellm package is not installed. "
            "Run: pip install litellm  (or add it to requirements.txt)"
        )

    _ensure_provider_env()

    chosen_model = model or settings.chat_model
    if not chosen_model:
        raise RuntimeError(
            "Chat model not configured. Set CHAT_MODEL in backend/.env."
        )

    api_base: str | None = settings.chat_base_url or None

    # IMPORTANT: use acompletion (async), NOT completion (sync).
    # litellm.completion() returns a synchronous CustomStreamWrapper; iterating
    # it with ``async for`` raises TypeError.  litellm.acompletion() returns a
    # true async generator that works correctly in an async context.
    resp = await litellm.acompletion(
        model=chosen_model,
        messages=messages,
        stream=True,
        api_base=api_base,
        custom_llm_provider=settings.llm_provider or None,
    )

    # LiteLLM streaming yields ModelResponse objects — NOT plain strings or dicts.
    # Token text lives at chunk.choices[0].delta.content.
    async for chunk in resp:
        try:
            delta_content: str | None = chunk.choices[0].delta.content
            if delta_content:
                yield delta_content
        except (AttributeError, IndexError, TypeError):
            # Malformed or end-of-stream sentinel chunk — skip silently
            pass
