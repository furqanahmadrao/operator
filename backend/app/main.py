from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import init_db
from app.api import artifacts, chat, projects, session_chat, sessions, mcp

# Configure logging based on settings
logging.basicConfig(
    level=getattr(logging, settings.log_level),
    format='%(levelname)s:     %(name)s - %(message)s'
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001
    # Validate configuration on startup
    logger.info("Validating configuration on startup...")
    warnings = settings.validate_on_startup()
    
    if warnings:
        logger.warning("Configuration validation warnings:")
        for warning in warnings:
            logger.warning(f"  - {warning}")
    else:
        logger.info("Configuration validation passed")
    
    # Log key configuration values
    logger.info(f"Workspace root: {settings.workspace_root}")
    logger.info(f"Browser automation: {'enabled' if settings.enable_browser_automation else 'disabled'}")
    logger.info(f"Terminal access: {'enabled' if settings.enable_terminal_access else 'disabled'}")
    logger.info(f"Deep agent: {'enabled' if settings.enable_deep_agent else 'disabled'}")
    logger.info(f"Max concurrent commands: {settings.max_concurrent_commands}")
    logger.info(f"Max concurrent browser sessions: {settings.max_concurrent_browser_sessions}")
    logger.info(f"Command timeout: {settings.command_timeout_seconds}s")
    logger.info(f"Browser timeout: {settings.browser_timeout_seconds}s")
    
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

# MCP (Model Context Protocol) endpoints
app.include_router(mcp.router, prefix="/api", tags=["mcp"])


@app.get("/health")
async def health():
    return {"status": "ok"}
