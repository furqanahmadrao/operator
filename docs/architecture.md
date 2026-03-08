# Phase 1 Architecture

## Scope

This phase implements a premium chat shell UI and a minimal chat backend that streams model output.

## Frontend (`/frontend`)

- `src/components/chat-shell.tsx`: full screen shell layout, composer, suggestion chips, chat rendering.
- `src/lib/chat-api.ts`: streaming client that talks to backend (`/api/chat`) via SSE.
- `src/app/page.tsx`: renders the shell.

The frontend is provider-agnostic and only depends on a generic backend chat stream.

## Backend (`/backend`)

- `app/api/chat.py`: HTTP route boundary and SSE event shaping.
- `app/services/chat_service.py`: chat abstraction layer.
- `app/services/nvidia.py`: NVIDIA provider implementation (OpenAI-compatible).
- `app/config/__init__.py`: environment-driven settings.

The chat service layer is intentionally separate so LangGraph or another orchestrator can be inserted later without rewriting route handlers.

## NVIDIA Integration Notes (Verified)

- Base URL: `https://integrate.api.nvidia.com/v1`
- Endpoint: `POST /chat/completions`
- Auth: `Authorization: Bearer <NVIDIA_API_KEY>`
- Streaming: `stream: true` with SSE chunks

### Model guidance and choices
The original Phase 1 example used `deepseek-ai/deepseek-v3.1-terminus`.  NVIDIA
regularly publishes updated DeepSeek variants; some are optimized for
longer context, others include explicit reasoning/"thinking" behaviour.  The
legacy `deepseek-ai/deepseek-r1` reasoning model has reached end‑of‑life and
should no longer be used.  You may point both the normal and thinking model
settings at the same ID when using a modern model that supports both modes.

| Model ID                             | Release | Max tokens | Reasoning support       | Notes / Recommendation |
|-------------------------------------|---------|------------|-------------------------|-------------------------|
| deepseek-ai/deepseek-r1             | 2023‑12 | ~8k        | yes (EOL)               | Retired – do not use    |
| deepseek-ai/deepseek-v3.1-terminus  | 2024‑03 | 4k         | no / limited            | Default baseline        |
| deepseek-ai/deepseek-v3.2-reasoning | 2024‑09 | 8k         | yes (built-in, <think>) | Recommended upgrade     |
| deepseek-ai/deepseek-v4.0-unified   | 2025‑02 | 16k+       | yes (toggleable)        | Highest capacity / future-proof |

For your use case a single up‑to‑date DeepSeek model (v3.2‑reasoning or later)
can serve both normal and think-enabled turns; the backend configuration
already falls back from `nvidia_thinking_model` to `nvidia_model` so the same
ID can be reused.  To switch simply update `NVIDIA_MODEL` (and optionally
`NVIDIA_THINKING_MODEL`) in `.env`.
