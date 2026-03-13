# AGENTS.md

**Agentic Runtime**: Full-stack AI agent platform with Next.js frontend, FastAPI backend, and integrated tool execution capabilities.

## Quick Start

### Local Development
```bash
# Backend setup
cd backend && python -m venv .venv
.\.venv\Scripts\Activate.ps1  # Windows PowerShell
pip install -r requirements.txt
cp .env.example .env  # Configure API keys
uvicorn app.main:app --reload --port 8000

# Frontend setup (separate terminal)
cd frontend && npm install
npm run dev  # Runs on port 3000
```

### Docker Deployment
```bash
cp backend/.env.example backend/.env  # Configure API keys
./run-docker.sh        # Linux/Mac
run-docker.bat         # Windows
# Access: Frontend http://localhost:3000, API http://localhost:8000
```

### Verification Commands
```bash
# Frontend verification
cd frontend && npm run lint && npx tsc --noEmit

# Backend verification
curl http://localhost:8000/health

# Docker verification
docker logs -f agentic-runtime
```

## Architecture

### Stack
- **Frontend**: Next.js 16, React 19, TypeScript, Tailwind v4
- **Backend**: FastAPI, Pydantic v2, aiosqlite
- **Runtime**: Single Docker container with dual-service startup
- **Database**: SQLite at `backend/data/agent.db`
- **Communication**: REST APIs + SSE streaming

### Key Directories
```
frontend/src/
├── app/           # Next.js App Router pages
├── components/    # React components (chat, terminal, browser, files)
├── lib/          # API clients and utilities
└── types/        # TypeScript definitions

backend/app/
├── agent/        # Core agent logic (deep_agent, tools, events)
├── api/          # FastAPI routers (chat, sessions, artifacts, mcp)
├── services/     # Business logic (llm, security, browser, terminal)
├── mcp/          # Model Context Protocol integration
└── config/       # Settings and system prompts
```

## Development Rules

### Code Style
**TypeScript**:
- Use `@/*` absolute imports for internal modules
- Group imports: framework/vendor first, then local modules
- Follow ESLint rules in `frontend/eslint.config.mjs`
- Use `import type` for type-only imports
- Components/types: `PascalCase`, vars/functions: `camelCase`

**Python**:
- Follow PEP 8 with 4-space indentation
- Group imports: stdlib, third-party, local `app.*`
- Use type hints on all function signatures
- Keep routers thin, put logic in `backend/app/services/*`
- Use `snake_case` for vars/functions, `UPPER_SNAKE_CASE` for constants

### API Patterns
- **SSE Events**: Emit as `data: <json>\n\n`, terminate with `data: [DONE]`
- **Error Handling**: Use `HTTPException` for validation errors, structured error events for SSE
- **Schemas**: Define Pydantic models in `backend/app/api/schemas.py`
- **Frontend Types**: Mirror backend schemas in `frontend/src/lib/*`

### Database Operations
- Use `backend/app/database.py` helpers and context managers
- Follow `_DDL` and `_MIGRATIONS` startup patterns
- Make schema changes idempotent and safe

### Security Constraints
- Never commit secrets from `.env` files
- Validate all external input before persistence
- Frontend public env vars must start with `NEXT_PUBLIC_`
- Terminal commands filtered through `backend/app/services/security.py`

## Agent Capabilities

### Core Features
- **Chat Interface**: Real-time streaming responses with SSE
- **Session Management**: Persistent conversations with artifacts
- **Tool Execution**: Terminal commands, browser automation, file operations
- **Deep Agent**: Multi-step planning and reflection capabilities
- **MCP Integration**: Model Context Protocol for extensible tools
- **Resource Limits**: Configurable memory, CPU, and concurrency controls

### Tool Categories
- **Terminal**: Command execution with security filtering
- **Browser**: Playwright-based web automation
- **Files**: Workspace file operations (read/write/search)
- **Web**: Search and fetch capabilities via Tavily/Serper
- **Artifacts**: Code/document generation and management

### Configuration
Environment variables in `backend/.env`:
```bash
# Required
CHAT_API_KEY=your-api-key
TAVILY_API_KEY=your-tavily-key

# Optional limits
MAX_CONCURRENT_COMMANDS=3
MAX_CONCURRENT_BROWSER_SESSIONS=5
COMMAND_TIMEOUT_SECONDS=30
MAX_WORKSPACE_SIZE_GB=10

# Feature flags
ENABLE_BROWSER_AUTOMATION=true
ENABLE_TERMINAL_ACCESS=true
ENABLE_DEEP_AGENT=true
```

## Testing & Quality

### Current State
- No test framework configured (tests removed for simplicity)
- Minimum verification: linting + type checking + health check
- Manual testing via Docker deployment

### Quality Gates
1. **Frontend**: `npm run lint && npx tsc --noEmit`
2. **Backend**: API starts successfully + `/health` returns 200
3. **Integration**: Docker container runs both services
4. **Manual**: Chat interface responds to user input

## Deployment

### Docker Architecture
- **Single container** with dual-service startup script
- **Frontend**: Next.js production server on port 3000
- **Backend**: FastAPI server on port 8000
- **Volumes**: Workspace persistence + database storage
- **Health checks**: Backend `/health` endpoint monitoring

### Production Considerations
- Set resource limits via Docker `--memory` and `--cpus`
- Configure reverse proxy for SSL termination
- Use secrets management for API keys
- Monitor logs via `docker logs -f agentic-runtime`
- Backup workspace and database volumes regularly

## Troubleshooting

### Common Issues
```bash
# Container won't start
docker logs agentic-runtime
# Check: API keys configured, ports available, sufficient resources

# Frontend not accessible
curl http://localhost:3000
# Check: Both services running, no port conflicts

# Agent not responding
curl http://localhost:8000/health
# Check: Backend running, API keys valid, model accessible

# Resource errors
docker exec agentic-runtime ps aux
# Check: Memory usage, process count, disk space
```

### Debug Commands
```bash
# View container processes
docker exec -it agentic-runtime bash

# Check service status
docker exec agentic-runtime ps aux | grep -E "(node|uvicorn)"

# Monitor resource usage
docker stats agentic-runtime

# View application logs
docker logs -f agentic-runtime --tail 100
```

---

**Last Updated**: March 2026 - Reflects simplified Docker deployment, removed test infrastructure, and current agent capabilities.