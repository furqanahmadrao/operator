from typing import Literal

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1)


# ── Session schemas ────────────────────────────────────────────────────────────


class SessionCreate(BaseModel):
    title: str = "New Chat"
    project_id: str | None = None


class SessionRename(BaseModel):
    title: str = Field(min_length=1, max_length=200)


class SessionPin(BaseModel):
    pinned: bool


class SessionProjectMove(BaseModel):
    project_id: str | None = None


class SessionSchema(BaseModel):
    id: str
    title: str
    pinned: bool = False
    project_id: str | None = None
    created_at: str
    updated_at: str


class MessageSchema(BaseModel):
    id: str
    session_id: str
    role: str
    content: str
    artifact_id: str | None = None
    created_at: str
    metadata_json: str | None = None


class SessionWithMessagesSchema(BaseModel):
    id: str
    title: str
    pinned: bool = False
    project_id: str | None = None
    created_at: str
    updated_at: str
    messages: list[MessageSchema]


# ── Artifact schemas ───────────────────────────────────────────────────────────


class ArtifactSchema(BaseModel):
    id: str
    session_id: str
    source_message_id: str | None = None
    type: str
    title: str
    content: str
    version: int = 1
    created_at: str
    updated_at: str


class ArtifactWithSessionSchema(ArtifactSchema):
    """Artifact enriched with its parent session title (for Library view)."""
    session_title: str


class ArtifactUpdate(BaseModel):
    title: str | None = None
    content: str | None = None


class ArtifactRevisionSchema(BaseModel):
    id: str
    artifact_id: str
    version: int
    title: str
    content: str
    source_message_id: str | None = None
    created_at: str


# ── Project schemas ────────────────────────────────────────────────────────────


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    system_prompt: str = ""


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    system_prompt: str | None = None


class ProjectPin(BaseModel):
    pinned: bool


class ProjectSchema(BaseModel):
    id: str
    name: str
    description: str
    system_prompt: str
    pinned: bool = False
    session_count: int = 0
    created_at: str
    updated_at: str


# ── Session chat ───────────────────────────────────────────────────────────────


class SessionChatRequest(BaseModel):
    content: str = Field(min_length=1)
    web_search_enabled: bool = True
    think_enabled: bool = False
    deep_research_enabled: bool = False
    clarifications: dict[str, str] | None = None


# ── Web search ─────────────────────────────────────────────────────────────────


class SearchResultItemSchema(BaseModel):
    title: str
    url: str
    snippet: str
    domain: str


class SearchEventSchema(BaseModel):
    """Persisted search event stored in messages.metadata_json."""

    type: str = "web_search"
    status: str          # "completed" | "error"
    query: str
    result_count: int
    results: list[SearchResultItemSchema]
    search_id: str
    timestamp: str
    message: str | None = None  # human-readable error description when status="error"


class MessageMetadataSchema(BaseModel):
    """Shape of messages.metadata_json when parsed."""

    tool_events: list[SearchEventSchema] = []
