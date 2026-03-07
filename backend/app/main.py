from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import init_db
from app.api import artifacts, chat, projects, session_chat, sessions


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001
    await init_db()
    yield


app = FastAPI(title="Agent API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Original stateless chat endpoint (kept for backward compat)
app.include_router(chat.router, prefix="/api", tags=["chat"])

# Session management
app.include_router(sessions.router, prefix="/api", tags=["sessions"])

# Session-aware streaming chat
app.include_router(session_chat.router, prefix="/api", tags=["session-chat"])

# Artifacts
app.include_router(artifacts.router, prefix="/api", tags=["artifacts"])

# Projects
app.include_router(projects.router, prefix="/api", tags=["projects"])


@app.get("/health")
async def health():
    return {"status": "ok"}
