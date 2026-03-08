# AGENTS.md
Repository guidance for coding agents.
Scope: `frontend/` (Next.js + TypeScript) and `backend/` (FastAPI + Python).

## Project Snapshot
- Frontend: Next.js 16, React 19, TypeScript, Tailwind v4
- Backend: FastAPI, Pydantic v2, aiosqlite
- Runtime DB: `backend/data/agent.db`
- API pattern: REST + SSE streaming

## Cursor/Copilot Rules
Searched for rule files and found none:
- `.cursorrules` -> not present
- `.cursor/rules/` -> not present
- `.github/copilot-instructions.md` -> not present
If these files are added later, treat them as supplemental instructions.

## Build, Lint, and Test Commands
Run commands from the correct working directory.

### Frontend (`frontend/`)
- Install dependencies: `npm install`
- Run dev server: `npm run dev`
- Build production bundle: `npm run build`
- Run production server: `npm run start`
- Run linter: `npm run lint`
- Type-check: `npx tsc --noEmit`

### Backend (`backend/`)
- Create virtual env: `python -m venv .venv`
- Activate (PowerShell): `.\.venv\Scripts\Activate.ps1`
- Install dependencies: `pip install -r requirements.txt`
- Run API locally: `uvicorn app.main:app --reload --port 8000`
- Health check: `curl http://localhost:8000/health`

### Tests and Single-Test Execution
Current state:
- No frontend test script is defined in `frontend/package.json`
- No backend test config exists (`pytest.ini` / `pyproject.toml` not present)

If tests are introduced, prefer these single-test patterns:
- Vitest file: `npx vitest run path/to/file.test.ts`
- Vitest test name: `npx vitest run path/to/file.test.ts -t "test name"`
- Jest test name: `npx jest path/to/file.test.ts -t "test name"`
- Pytest single test: `pytest tests/test_file.py::test_case_name -q`

Current minimum verification before merge:
- Frontend changes: `npm run lint` and `npx tsc --noEmit`
- Backend changes: run API and verify `/health`

## Code Style Guidelines
Prefer existing local patterns over personal preference.

### Imports and Module Boundaries
TypeScript:
- Use `@/*` absolute imports for internal modules
- Group imports: framework/vendor first, then local modules
- Use `import type` for type-only imports where practical
- Keep API client logic in `frontend/src/lib/*`
- Keep UI components in `frontend/src/components/*`

Python:
- Group imports: stdlib, third-party, local `app.*`
- Keep routers focused on transport/HTTP behavior
- Put domain logic in `backend/app/services/*`

### Formatting
TypeScript:
- Follow ESLint rules in `frontend/eslint.config.mjs`
- Existing style uses semicolons and double quotes
- Keep multiline arrays/objects/functions trailing-comma friendly

Python:
- Follow PEP 8 and 4-space indentation
- Use type hints on function signatures
- Keep request-path code asynchronous and non-blocking

### Types and Schemas
TypeScript:
- Define API payload types in `frontend/src/lib/*`
- Use literal unions for finite event values
- Avoid `any`; if needed, isolate casts and keep scope narrow

Python:
- Use Pydantic models for request/response contracts
- Enforce constraints with `Field(...)`
- Use `Literal[...]` for fixed-value fields where possible

### Naming
- Components/classes/types: `PascalCase`
- TypeScript vars/functions/hooks: `camelCase`
- Python vars/functions: `snake_case`
- Constants: `UPPER_SNAKE_CASE`
- Keep API/DB snake_case fields when mirroring backend payloads

### Error Handling
Frontend:
- Throw explicit `Error` for non-OK HTTP responses
- Treat abort/cancel paths as non-fatal flow
- Favor graceful UI fallbacks over hard crashes

Backend:
- Use `HTTPException` for validation/business errors
- In SSE routes, emit structured error events
- Always terminate streams with `data: [DONE]`
- Catch broad exceptions only at stream boundaries

### API and Streaming Rules
- Emit SSE events as `data: <json>\n\n`
- Preserve current event names and payload shapes for compatibility
- Do not break existing endpoints without migration notes

### Database Rules
- Use `backend/app/database.py` helpers/context managers
- Respect `_DDL` and idempotent `_MIGRATIONS` startup pattern
- Avoid destructive schema changes without safe migration steps

### Environment and Security
- Never commit secrets from `.env` files
- Backend settings load from `backend/.env` via pydantic-settings
- Frontend public env vars must start with `NEXT_PUBLIC_`
- Validate external input before persisting or rendering

## Working Rules for Agents
- Read adjacent files before editing and mirror local patterns
- Keep changes scoped; avoid drive-by refactors
- Do not edit generated/runtime folders (`backend/.venv`, `.next`)
- Keep FastAPI routers thin and move reusable logic into services

## Quick File Map
- Frontend entry: `frontend/src/app/page.tsx`
- Frontend layout: `frontend/src/app/layout.tsx`
- Main UI shell: `frontend/src/components/chat-shell.tsx`
- Frontend API clients: `frontend/src/lib/*.ts`
- FastAPI bootstrap: `backend/app/main.py`
- API schemas: `backend/app/api/schemas.py`
- Services: `backend/app/services/*.py`
- DB layer: `backend/app/database.py`

Update this file when scripts, tooling, or architecture change.
