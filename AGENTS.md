# Agent Coding Guidelines

This file provides guidelines for AI agents working on this codebase.

## Project Overview

This is a premium chat application with a Next.js frontend and FastAPI backend. The stack includes:
- **Frontend**: Next.js 16.1.6, TypeScript, Tailwind CSS v4
- **Backend**: FastAPI, Python 3.12
- **AI Model**: NVIDIA API with deepseek-ai/deepseek-v3.1-terminus

## Build, Lint, and Test Commands

### Frontend (Next.js)
```bash
cd frontend

# Development
npm run dev              # Start development server

# Build and Production
npm run build            # Build production bundle
npm run start            # Start production server

# Linting
npm run lint             # Run ESLint

# Type checking
npx tsc --noEmit         # TypeScript type checking
```

### Backend (FastAPI)
```bash
cd backend

# Setup virtual environment (Windows)
python -m venv .venv
.venv\Scripts\Activate.ps1

# Development
uvicorn app.main:app --reload --port 8000

# Install dependencies
pip install -r requirements.txt

# Health check
curl http://localhost:8000/health
```

### Running Individual Tests
Currently no test framework is configured. When adding tests:
- Use Jest/Vitest for frontend tests
- Use pytest for backend tests
- Follow existing patterns when adding test files

## Code Style Guidelines

### TypeScript/React Conventions

**Imports**
- Use absolute imports with `@/*` alias (configured in tsconfig.json)
- Group imports: external libraries first, then internal modules
- Example from `src/lib/chat-api.ts`:

```typescript
export type ChatRole = "user" | "assistant" | "system";
```

**Naming Conventions**
- PascalCase for components and types (`ChatShell`, `ChatMessage`)
- camelCase for functions and variables (`streamChatCompletion`, `onToken`)
- UPPER_CASE for constants (`API_BASE_URL`)
- Use descriptive, meaningful names

**Error Handling**
- Use TypeScript's strict mode (enabled in tsconfig)
- Throw meaningful Error objects with descriptive messages
- Handle async errors with try/catch

**Component Structure**
- Functional components with TypeScript interfaces
- Use arrow function syntax for components
- Export default for page components

### Python/FastAPI Conventions

**Imports**
- Group imports: standard library, third-party, local modules
- Use absolute imports for local modules
- Example from `app/api/chat.py`:

```python
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.api.schemas import ChatRequest
from app.services.chat_service import chat_service
```

**Naming Conventions**
- snake_case for functions and variables (`stream_reply`, `event_generator`)
- PascalCase for classes (`ChatService`)
- UPPER_CASE for constants

**Error Handling**
- Use specific exception types when possible
- Catch exceptions at appropriate levels
- Return HTTP status codes with meaningful messages
- Example from `app/api/chat.py`:

```python
try:
    async for token in chat_service.stream_reply(request.messages):
        payload = json.dumps({"type": "token", "content": token})
        yield f"data: {payload}\n\n"
except Exception as error:  # noqa: BLE001
    payload = json.dumps({"type": "error", "message": str(error)})
    yield f"data: {payload}\n\n"
```

**Type Annotations**
- Use Python type hints consistently
- Leverage Pydantic for request/response validation
- Use `AsyncGenerator` for streaming responses

### File Organization

**Frontend Structure**
```
frontend/src/
├── app/                 # Next.js App Router pages
├── components/         # Reusable React components
│   ├── shell/          # Layout components
│   └── chat-shell.tsx  # Main chat interface
├── lib/                # Utility functions and API clients
└── styles/             # Global styles
```

**Backend Structure**
```
backend/app/
├── api/                # FastAPI route handlers
├── services/           # Business logic layer
├── config/            # Configuration and settings
└── schemas.py         # Pydantic models
```

## Formatting Rules

### TypeScript/JavaScript
- Use ESLint with Next.js configuration
- Follow Prettier defaults (when added)
- Line length: 80-100 characters
- Use semicolons
- Double quotes for strings

### Python
- Follow PEP 8 conventions
- Line length: 79 characters
- Use 4 spaces for indentation
- Blank lines between functions/classes
- Docstrings for public functions

## Development Workflow

### Adding New Features
1. **Frontend**: Add components in `frontend/src/components/`
2. **Backend**: Add API routes in `backend/app/api/` and services in `backend/app/services/`
3. **Schemas**: Update `backend/app/api/schemas.py` for new data models
4. **Testing**: Add tests alongside implementation

### Code Quality Checks
- Run `npm run lint` before committing frontend changes
- Ensure TypeScript compilation passes (`npx tsc --noEmit`)
- Check Python imports and syntax
- Verify API endpoints work correctly

### Environment Variables
- Frontend: Use `frontend/.env.local` for local development
- Backend: Use `backend/.env` for configuration
- Follow existing patterns for API base URLs and keys

## Architecture Patterns

### Frontend Patterns
- **Streaming**: Use Server-Sent Events for real-time updates
- **State Management**: Local component state (no external stores yet)
- **Styling**: Tailwind CSS with utility-first approach

### Backend Patterns
- **API Design**: RESTful endpoints with streaming support
- **Service Layer**: Business logic separated from route handlers
- **Configuration**: Environment-based settings with Pydantic
- **Error Handling**: Structured error responses with appropriate HTTP codes

### Integration Patterns
- **API Communication**: HTTP streaming between frontend and backend
- **Error Propagation**: Consistent error handling across layers
- **Type Safety**: Shared type definitions between frontend and backend

## Best Practices

### General
- Write clear, self-documenting code
- Add comments for complex logic
- Keep functions small and focused
- Follow the Single Responsibility Principle

### Security
- Never commit API keys or secrets
- Validate all user inputs
- Use environment variables for sensitive data
- Implement proper CORS configuration

### Performance
- Use streaming for large responses
- Implement proper error boundaries
- Optimize bundle size with code splitting
- Cache appropriately

## Common Issues to Avoid

### Frontend
- Avoid inline styles; use Tailwind classes
- Don't mutate state directly; use functional updates
- Handle loading states properly
- Implement proper error boundaries

### Backend
- Don't block the event loop with synchronous operations
- Handle streaming responses correctly
- Validate all inputs with Pydantic
- Implement proper exception handling

This file should be updated as the codebase evolves and new patterns emerge.