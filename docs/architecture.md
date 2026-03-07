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
- Model used in this phase: `deepseek-ai/deepseek-v3.1-terminus`
- Streaming: `stream: true` with SSE chunks
