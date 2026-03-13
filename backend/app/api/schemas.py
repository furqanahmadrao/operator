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
    deep_agent_enabled: bool = False
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


# ── Activity Event Schemas ─────────────────────────────────────────────────────


class ActivityEventType:
    """Activity event type constants."""
    PLANNING = "planning"
    REFLECTION = "reflection"
    TOOL_START = "tool_start"
    TOOL_END = "tool_end"
    TERMINAL_OUTPUT = "terminal_output"
    TERMINAL_COMPLETE = "terminal_complete"
    BROWSER_NAVIGATE = "browser_navigate"
    BROWSER_CLICK = "browser_click"
    BROWSER_SCREENSHOT = "browser_screenshot"
    FILE_CREATED = "file_created"
    FILE_MODIFIED = "file_modified"
    FILE_DELETED = "file_deleted"
    DIRECTORY_CHANGED = "directory_changed"
    PROGRESS_UPDATE = "progress_update"
    ERROR = "error"


class BaseActivityEvent(BaseModel):
    """Base schema for all activity events."""
    event_type: str
    timestamp: str
    session_id: str
    correlation_id: str | None = None
    schema_version: str = "1.0"


class TerminalOutputEvent(BaseModel):
    """Terminal output event emitted during command execution."""
    type: Literal["terminal_output"] = "terminal_output"
    content: str
    stream_type: Literal["stdout", "stderr"]
    command_context: str | None = None
    working_directory: str
    timestamp: str
    session_id: str
    correlation_id: str | None = None
    schema_version: str = "1.0"


class TerminalCompleteEvent(BaseModel):
    """Terminal completion event emitted when command finishes."""
    type: Literal["terminal_complete"] = "terminal_complete"
    exit_code: int
    command: str
    duration_ms: int
    timestamp: str
    session_id: str
    correlation_id: str | None = None
    schema_version: str = "1.0"


class BrowserNavigateEvent(BaseModel):
    """Browser navigation event."""
    type: Literal["browser_navigate"] = "browser_navigate"
    url: str
    session_name: str
    status: Literal["started", "completed", "failed"]
    error: str | None = None
    timestamp: str
    session_id: str
    correlation_id: str | None = None
    schema_version: str = "1.0"


class BrowserClickEvent(BaseModel):
    """Browser click event."""
    type: Literal["browser_click"] = "browser_click"
    selector: str
    session_name: str
    status: Literal["started", "completed", "failed"]
    error: str | None = None
    timestamp: str
    session_id: str
    correlation_id: str | None = None
    schema_version: str = "1.0"


class BrowserScreenshotEvent(BaseModel):
    """Browser screenshot event."""
    type: Literal["browser_screenshot"] = "browser_screenshot"
    filename: str
    session_name: str
    status: Literal["started", "completed", "failed"]
    error: str | None = None
    timestamp: str
    session_id: str
    correlation_id: str | None = None
    schema_version: str = "1.0"


class FileOperationEvent(BaseModel):
    """File operation event (created, modified, deleted)."""
    type: Literal["file_created", "file_modified", "file_deleted"]
    path: str
    size_bytes: int | None = None
    file_type: str | None = None
    timestamp: str
    session_id: str
    correlation_id: str | None = None
    schema_version: str = "1.0"


class PlanningEvent(BaseModel):
    """Planning event emitted by deep agent."""
    type: Literal["planning"] = "planning"
    sub_tasks: list[str]
    reasoning: str
    timestamp: str
    session_id: str
    correlation_id: str | None = None
    schema_version: str = "1.0"


class ReflectionEvent(BaseModel):
    """Reflection event emitted by deep agent."""
    type: Literal["reflection"] = "reflection"
    observation: str
    adjustment: str | None = None
    timestamp: str
    session_id: str
    correlation_id: str | None = None
    schema_version: str = "1.0"


class ProgressUpdateEvent(BaseModel):
    """Progress update event for multi-step tasks."""
    type: Literal["progress_update"] = "progress_update"
    task_name: str
    current_step: int
    total_steps: int
    step_description: str
    status: Literal["in_progress", "completed", "failed"]
    elapsed_ms: int
    timestamp: str
    session_id: str
    correlation_id: str | None = None
    schema_version: str = "1.0"


class ErrorEvent(BaseModel):
    """Error event for unrecoverable failures."""
    type: Literal["error"] = "error"
    error_type: str
    message: str
    details: dict[str, str] | None = None
    recoverable: bool
    retry_count: int = 0
    timestamp: str
    session_id: str
    correlation_id: str | None = None
    schema_version: str = "1.0"


class DirectoryChangedEvent(BaseModel):
    """Directory change event."""
    type: Literal["directory_changed"] = "directory_changed"
    old_path: str
    new_path: str
    timestamp: str
    session_id: str
    correlation_id: str | None = None
    schema_version: str = "1.0"


class ToolStartEvent(BaseModel):
    """Tool invocation start event."""
    type: Literal["tool_start"] = "tool_start"
    tool_name: str
    parameters: dict[str, str] | None = None
    timestamp: str
    session_id: str
    correlation_id: str | None = None
    schema_version: str = "1.0"


class ToolEndEvent(BaseModel):
    """Tool invocation end event."""
    type: Literal["tool_end"] = "tool_end"
    tool_name: str
    result_summary: str | None = None
    status: Literal["success", "failed"]
    error: str | None = None
    duration_ms: int
    timestamp: str
    session_id: str
    correlation_id: str | None = None
    schema_version: str = "1.0"
