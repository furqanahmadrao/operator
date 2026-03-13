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

## 4) Docker Setup (Alternative)

For a simplified single-container deployment:

### Quick Start

1. **Configure environment:**
   ```bash
   cp backend/.env.example backend/.env
   # Edit backend/.env and set your API keys
   ```

2. **Run with script:**
   ```bash
   # Linux/Mac
   chmod +x run-docker.sh
   ./run-docker.sh
   
   # Windows
   run-docker.bat
   ```

3. **Access application:**
   - **Frontend (Web UI)**: http://localhost:3000
   - **API**: http://localhost:8000
   - **Health**: http://localhost:8000/health

### Manual Docker Commands

```bash
# Build and run
docker build -t agentic-runtime .
docker run -d \
  --name agentic-runtime \
  -p 3000:3000 \
  -p 8000:8000 \
  -v $(pwd)/workspace:/workspace \
  -v $(pwd)/backend/data:/app/backend/data \
  --env-file backend/.env \
  --restart unless-stopped \
  agentic-runtime
```

The Docker container builds both frontend and backend into a single container, using the same environment configuration as local development.

## Resource Limits

The agent runtime includes comprehensive resource monitoring and enforcement to ensure stable operation and prevent resource exhaustion.

### Available Resource Limits

The system monitors and enforces limits on the following resources:

| Resource Type | Default Limit | Environment Variable | Description |
|---------------|---------------|---------------------|-------------|
| **Memory** | 2 GB | `MEMORY_LIMIT_GB` | Maximum memory usage for monitoring |
| **CPU** | 2 cores | `CPU_LIMIT_CORES` | CPU limit in cores for monitoring |
| **Concurrent Commands** | 3 | `MAX_CONCURRENT_COMMANDS` | Maximum simultaneous terminal commands |
| **Browser Sessions** | 5 | `MAX_CONCURRENT_BROWSER_SESSIONS` | Maximum concurrent browser automation sessions |
| **Workspace Size** | 10 GB | `MAX_WORKSPACE_SIZE_GB` | Maximum workspace disk usage |

### Configuration

Resource limits are configured via environment variables in your `.env` file:

```env
# Resource Limits
MEMORY_LIMIT_GB=2
CPU_LIMIT_CORES=2
MAX_CONCURRENT_COMMANDS=3
MAX_CONCURRENT_BROWSER_SESSIONS=5
MAX_WORKSPACE_SIZE_GB=10
```

### Warning Thresholds

The system emits warning events when resource usage approaches limits:

- **Memory**: Warning at 80% of limit
- **CPU**: Warning at 80% of limit  
- **Workspace**: Warning at 90% of limit

### Enforcement Behavior

**Hard Limits (Blocking):**
- **Concurrent Commands**: New command execution is blocked when limit reached
- **Browser Sessions**: New browser session creation is blocked when limit reached

**Soft Limits (Monitoring Only):**
- **Memory**: Monitored and warnings emitted, but not enforced
- **CPU**: Monitored and warnings emitted, but not enforced
- **Workspace Size**: Monitored and warnings emitted, but not enforced

### Warning Events

When resource usage approaches limits, the system:

1. Logs warnings to the application log
2. Emits warning events via the activity stream (visible in UI)
3. Provides specific resource usage details and recommendations

Example warning event:
```json
{
  "event_type": "warning",
  "warning_type": "memory_limit",
  "message": "Memory usage at 85.2% of limit",
  "current_mb": 1740.8,
  "limit_mb": 2048,
  "threshold_percent": 80
}
```

### Configuration Examples

**Development Environment (Relaxed Limits):**
```env
MEMORY_LIMIT_GB=4
CPU_LIMIT_CORES=4
MAX_CONCURRENT_COMMANDS=5
MAX_CONCURRENT_BROWSER_SESSIONS=3
MAX_WORKSPACE_SIZE_GB=20
```

**Production Environment (Strict Limits):**
```env
MEMORY_LIMIT_GB=1
CPU_LIMIT_CORES=1
MAX_CONCURRENT_COMMANDS=2
MAX_CONCURRENT_BROWSER_SESSIONS=2
MAX_WORKSPACE_SIZE_GB=5
```

**Docker Deployment:**
```bash
docker run \
  -p 8000:8000 \
  -v $(pwd)/workspace:/workspace \
  -e MEMORY_LIMIT_GB=2 \
  -e CPU_LIMIT_CORES=2 \
  -e MAX_CONCURRENT_COMMANDS=3 \
  -e MAX_CONCURRENT_BROWSER_SESSIONS=5 \
  -e MAX_WORKSPACE_SIZE_GB=10 \
  agent-runtime
```

### Monitoring Resource Usage

Check current resource usage via the health endpoint:

```bash
curl http://localhost:8000/health
```

The response includes current resource usage and limit information:

```json
{
  "status": "healthy",
  "resource_usage": {
    "memory_mb": 512.3,
    "memory_percent": 25.1,
    "cpu_percent": 15.2,
    "workspace_size_mb": 1024.5,
    "active_commands": 1,
    "active_browser_sessions": 2
  },
  "resource_limits": {
    "memory_limit_gb": 2.0,
    "cpu_limit_cores": 2.0,
    "max_concurrent_commands": 3,
    "max_concurrent_browser_sessions": 5,
    "max_workspace_size_gb": 10.0
  }
}
```

### Troubleshooting

**Command Execution Blocked:**
- Check active command count: `curl http://localhost:8000/health`
- Wait for existing commands to complete
- Increase `MAX_CONCURRENT_COMMANDS` if needed

**Browser Session Creation Failed:**
- Check active browser sessions: `curl http://localhost:8000/health`
- Close unused browser sessions
- Increase `MAX_CONCURRENT_BROWSER_SESSIONS` if needed

**High Resource Usage Warnings:**
- Monitor resource usage trends via health endpoint
- Consider increasing limits for your use case
- Clean up workspace files if disk usage is high
- Restart the service to reset memory usage

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
