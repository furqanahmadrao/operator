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
- Model: `deepseek-ai/deepseek-v3.1-terminus`
- Streaming enabled with `stream: true`

Note: model IDs and API catalog details can evolve. If NVIDIA updates naming or endpoint behavior, follow current official docs.
