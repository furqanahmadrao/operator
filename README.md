# Phase 1 - Premium Chat Shell

Minimal, clean chat foundation built for future agent expansion.

## Stack

- Frontend: Next.js + TypeScript + Tailwind CSS
- Backend: FastAPI (Python)
- Model API: NVIDIA OpenAI-compatible API (`deepseek-ai/deepseek-v3.1-terminus`)

## Project Structure

```
.
├── frontend/   # UI shell and client-side streaming rendering
├── backend/    # FastAPI API and NVIDIA integration
└── docs/       # architecture notes
```

## 1) Environment Setup

Copy env examples:

```bash
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

Set your NVIDIA API key in `backend/.env`:

```env
NVIDIA_API_KEY=your_real_key
```

## 2) Backend Setup (FastAPI + `.venv`)

From `backend/`:

```bash
python -m venv .venv
```

Activate virtual environment:

- Windows (PowerShell)

```powershell
.\.venv\Scripts\Activate.ps1
```

- Windows (cmd)

```cmd
.venv\Scripts\activate.bat
```

- macOS/Linux

```bash
source .venv/bin/activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Run backend:

```bash
uvicorn app.main:app --reload --port 8000
```

Health check: `http://localhost:8000/health`

## 3) Frontend Setup (Next.js)

From `frontend/`:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## What V1 Includes

- Premium dark chat landing shell
- Session-local chat UI state
- Message submit from UI to backend
- Streaming assistant response from NVIDIA API
- Clear service boundaries for future expansion

## Deliberately Excluded in Phase 1

- LangGraph orchestration
- Tool calling / MCP / Playwright
- Persistence (SQLite/vector DB)
- Auth and multi-user support
- RAG, memory, background jobs

## NVIDIA Doc-Based Verification

Verified against NVIDIA API catalog/docs:

- Base URL: `https://integrate.api.nvidia.com/v1`
- Chat endpoint: `POST /chat/completions`
- Auth: Bearer token via `Authorization` header
- Streaming enabled with `stream: true`

The default model used in examples has been `deepseek-ai/deepseek-v3.1-terminus`,
but the NVIDIA DeepSeek family is updated frequently.  Consult the official
catalog to pick the best model; the following table summarizes the current
options (as of early 2026) and their properties:

| Model ID                             | Release | Max tokens | Reasoning support       | Notes / Recommendation |
|-------------------------------------|---------|------------|-------------------------|-------------------------|
| deepseek-ai/deepseek-r1             | 2023‑12 | ~8k        | yes (EOL)               | Retired – do not use    |
| deepseek-ai/deepseek-v3.1-terminus  | 2024‑03 | 4k         | no / limited            | Baseline default        |
| deepseek-ai/deepseek-v3.2-reasoning | 2024‑09 | 8k         | yes (built-in, <think>) | Recommended drop-in     |
| deepseek-ai/deepseek-v4.0-unified   | 2025‑02 | 16k+       | yes (toggleable)        | Latest / highest cap    |

To enable thinking-mode you can either set `NVIDIA_THINKING_MODEL` to a
separate ID or leave it blank and the backend will reuse `NVIDIA_MODEL`.
Because reasoning capabilities are now embedded in the same model, the
frontend toggle `think_enabled` simply causes the server to send a low
temperature and higher token budget; no separate “R1” model is required.

Note: model availability and names may change; always verify against
[the official NVIDIA docs or the `/v1/models` API](https://integrate.api.nvidia.com/v1/models).
