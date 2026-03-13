"""
Activity Stream Service

Emits structured activity events for all agent actions including browser operations,
terminal commands, file operations, planning, and reflection. Implements event buffering,
correlation, and ordering to prevent SSE flooding and maintain event relationships.
"""

import asyncio
import time
from collections import defaultdict
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Optional
from uuid import uuid4


class ActivityEventType(str, Enum):
    """Types of activity events emitted by the agent runtime."""
    
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


@dataclass
class ActivityEvent:
    """Structured activity event with correlation and ordering support."""
    
    event_type: ActivityEventType
    timestamp: str
    session_id: str
    payload: dict[str, Any]
    correlation_id: Optional[str] = None
    sequence_number: int = 0
    
    def to_dict(self) -> dict[str, Any]:
        """Convert event to dictionary for JSON serialization."""
        return {
            "event_type": self.event_type.value,
            "timestamp": self.timestamp,
            "session_id": self.session_id,
            "payload": self.payload,
            "correlation_id": self.correlation_id,
            "sequence_number": self.sequence_number,
        }


@dataclass
class BufferedOutput:
    """Buffer for collecting terminal output before emission."""
    
    lines: list[str] = field(default_factory=list)
    last_flush: float = field(default_factory=time.time)
    stream_type: str = "stdout"
    command_context: Optional[str] = None
    working_directory: str = "/workspace"


class ActivityStream:
    """
    Manages activity event emission with buffering, correlation, and ordering.
    
    Features:
    - Event buffering to prevent SSE flooding (100ms buffer for terminal output)
    - Event correlation with correlation_id for linking related events
    - Event ordering with sequence numbers
    - Async emission to event handlers
    """
    
    def __init__(self, buffer_interval_ms: int = 100):
        """
        Initialize activity stream.
        
        Args:
            buffer_interval_ms: Milliseconds to buffer terminal output before emission
        """
        self.buffer_interval_ms = buffer_interval_ms
        self.buffer_interval_sec = buffer_interval_ms / 1000.0
        
        # Event handlers registered by session
        self._handlers: dict[str, list[Callable]] = defaultdict(list)
        
        # Terminal output buffers by session and correlation_id
        self._terminal_buffers: dict[tuple[str, str], BufferedOutput] = {}
        
        # Sequence number tracking per session
        self._sequence_counters: dict[str, int] = defaultdict(int)
        
        # Background task for flushing buffers
        self._flush_task: Optional[asyncio.Task] = None
        self._running = False
    
    def start(self) -> None:
        """Start background buffer flushing task."""
        if not self._running:
            self._running = True
            self._flush_task = asyncio.create_task(self._flush_loop())
    
    async def stop(self) -> None:
        """Stop background flushing and flush remaining buffers."""
        self._running = False
        if self._flush_task:
            self._flush_task.cancel()
            try:
                await self._flush_task
            except asyncio.CancelledError:
                pass
        
        # Flush all remaining buffers
        await self._flush_all_buffers()
    
    def register_handler(self, session_id: str, handler: Callable) -> None:
        """
        Register event handler for a session.
        
        Args:
            session_id: Session identifier
            handler: Async callable that receives ActivityEvent
        """
        self._handlers[session_id].append(handler)
    
    def unregister_handler(self, session_id: str, handler: Callable) -> None:
        """
        Unregister event handler for a session.
        
        Args:
            session_id: Session identifier
            handler: Handler to remove
        """
        if session_id in self._handlers:
            self._handlers[session_id].remove(handler)
            if not self._handlers[session_id]:
                del self._handlers[session_id]
    
    def clear_session(self, session_id: str) -> None:
        """
        Clear all handlers and buffers for a session.
        
        Args:
            session_id: Session identifier
        """
        if session_id in self._handlers:
            del self._handlers[session_id]
        
        # Clear terminal buffers for this session
        keys_to_remove = [
            key for key in self._terminal_buffers.keys()
            if key[0] == session_id
        ]
        for key in keys_to_remove:
            del self._terminal_buffers[key]
        
        # Clear sequence counter
        if session_id in self._sequence_counters:
            del self._sequence_counters[session_id]
    
    async def emit(
        self,
        session_id: str,
        event_type: ActivityEventType,
        payload: dict[str, Any],
        correlation_id: Optional[str] = None,
    ) -> None:
        """
        Emit activity event immediately to all registered handlers.
        
        Args:
            session_id: Session identifier
            event_type: Type of activity event
            payload: Event-specific data
            correlation_id: Optional ID to correlate related events
        """
        event = self._create_event(
            session_id=session_id,
            event_type=event_type,
            payload=payload,
            correlation_id=correlation_id,
        )
        
        await self._emit_event(event)
    
    async def emit_terminal_output(
        self,
        session_id: str,
        content: str,
        stream_type: str = "stdout",
        command_context: Optional[str] = None,
        working_directory: str = "/workspace",
        correlation_id: Optional[str] = None,
    ) -> None:
        """
        Buffer terminal output and emit after buffer interval.
        
        Args:
            session_id: Session identifier
            content: Terminal output content
            stream_type: "stdout" or "stderr"
            command_context: Optional command being executed
            working_directory: Current working directory
            correlation_id: Optional correlation ID
        """
        if correlation_id is None:
            correlation_id = str(uuid4())
        
        buffer_key = (session_id, correlation_id)
        
        if buffer_key not in self._terminal_buffers:
            self._terminal_buffers[buffer_key] = BufferedOutput(
                stream_type=stream_type,
                command_context=command_context,
                working_directory=working_directory,
            )
        
        buffer = self._terminal_buffers[buffer_key]
        buffer.lines.append(content)
    
    async def emit_terminal_complete(
        self,
        session_id: str,
        exit_code: int,
        command: str,
        duration_ms: int,
        correlation_id: Optional[str] = None,
    ) -> None:
        """
        Emit terminal command completion event.
        
        Args:
            session_id: Session identifier
            exit_code: Command exit code
            command: Command that was executed
            duration_ms: Execution duration in milliseconds
            correlation_id: Optional correlation ID
        """
        # Flush any buffered output for this correlation_id first
        if correlation_id:
            buffer_key = (session_id, correlation_id)
            if buffer_key in self._terminal_buffers:
                await self._flush_buffer(buffer_key)
        
        await self.emit(
            session_id=session_id,
            event_type=ActivityEventType.TERMINAL_COMPLETE,
            payload={
                "exit_code": exit_code,
                "command": command,
                "duration_ms": duration_ms,
            },
            correlation_id=correlation_id,
        )
    
    async def emit_planning(
        self,
        session_id: str,
        sub_tasks: list[str],
        reasoning: str,
        correlation_id: Optional[str] = None,
    ) -> None:
        """Emit planning event."""
        await self.emit(
            session_id=session_id,
            event_type=ActivityEventType.PLANNING,
            payload={
                "sub_tasks": sub_tasks,
                "reasoning": reasoning,
            },
            correlation_id=correlation_id,
        )
    
    async def emit_reflection(
        self,
        session_id: str,
        reflection: str,
        adjustments: Optional[list[str]] = None,
        correlation_id: Optional[str] = None,
    ) -> None:
        """Emit reflection event."""
        await self.emit(
            session_id=session_id,
            event_type=ActivityEventType.REFLECTION,
            payload={
                "reflection": reflection,
                "adjustments": adjustments or [],
            },
            correlation_id=correlation_id,
        )
    
    async def emit_progress_update(
        self,
        session_id: str,
        task_name: str,
        current_step: int,
        total_steps: int,
        step_description: str,
        status: str,
        elapsed_ms: int,
        correlation_id: Optional[str] = None,
    ) -> None:
        """Emit progress update event."""
        await self.emit(
            session_id=session_id,
            event_type=ActivityEventType.PROGRESS_UPDATE,
            payload={
                "task_name": task_name,
                "current_step": current_step,
                "total_steps": total_steps,
                "step_description": step_description,
                "status": status,
                "elapsed_ms": elapsed_ms,
            },
            correlation_id=correlation_id,
        )
    
    async def emit_error(
        self,
        session_id: str,
        error_type: str,
        message: str,
        details: Optional[dict[str, Any]] = None,
        recoverable: bool = True,
        retry_count: int = 0,
        correlation_id: Optional[str] = None,
    ) -> None:
        """Emit error event."""
        await self.emit(
            session_id=session_id,
            event_type=ActivityEventType.ERROR,
            payload={
                "error_type": error_type,
                "message": message,
                "details": details or {},
                "recoverable": recoverable,
                "retry_count": retry_count,
            },
            correlation_id=correlation_id,
        )
    
    def _create_event(
        self,
        session_id: str,
        event_type: ActivityEventType,
        payload: dict[str, Any],
        correlation_id: Optional[str] = None,
    ) -> ActivityEvent:
        """Create activity event with sequence number and timestamp."""
        sequence_number = self._sequence_counters[session_id]
        self._sequence_counters[session_id] += 1
        
        return ActivityEvent(
            event_type=event_type,
            timestamp=self._get_timestamp(),
            session_id=session_id,
            payload=payload,
            correlation_id=correlation_id,
            sequence_number=sequence_number,
        )
    
    async def _emit_event(self, event: ActivityEvent) -> None:
        """Emit event to all registered handlers for the session."""
        handlers = self._handlers.get(event.session_id, [])
        
        for handler in handlers:
            try:
                if asyncio.iscoroutinefunction(handler):
                    await handler(event)
                else:
                    handler(event)
            except Exception as e:
                # Log error but don't fail emission
                print(f"Error in activity stream handler: {e}")
    
    async def _flush_loop(self) -> None:
        """Background task that periodically flushes terminal output buffers."""
        while self._running:
            try:
                await asyncio.sleep(self.buffer_interval_sec)
                await self._flush_expired_buffers()
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"Error in flush loop: {e}")
    
    async def _flush_expired_buffers(self) -> None:
        """Flush buffers that have exceeded the buffer interval."""
        current_time = time.time()
        keys_to_flush = []
        
        for key, buffer in self._terminal_buffers.items():
            if current_time - buffer.last_flush >= self.buffer_interval_sec:
                keys_to_flush.append(key)
        
        for key in keys_to_flush:
            await self._flush_buffer(key)
    
    async def _flush_all_buffers(self) -> None:
        """Flush all remaining buffers."""
        keys = list(self._terminal_buffers.keys())
        for key in keys:
            await self._flush_buffer(key)
    
    async def _flush_buffer(self, buffer_key: tuple[str, str]) -> None:
        """
        Flush a specific terminal output buffer.
        
        Args:
            buffer_key: Tuple of (session_id, correlation_id)
        """
        if buffer_key not in self._terminal_buffers:
            return
        
        buffer = self._terminal_buffers[buffer_key]
        
        if not buffer.lines:
            return
        
        session_id, correlation_id = buffer_key
        
        # Combine buffered lines
        content = "".join(buffer.lines)
        
        # Emit terminal output event
        await self.emit(
            session_id=session_id,
            event_type=ActivityEventType.TERMINAL_OUTPUT,
            payload={
                "content": content,
                "stream_type": buffer.stream_type,
                "command_context": buffer.command_context,
                "working_directory": buffer.working_directory,
            },
            correlation_id=correlation_id,
        )
        
        # Clear buffer
        del self._terminal_buffers[buffer_key]
    
    @staticmethod
    def _get_timestamp() -> str:
        """Get ISO 8601 timestamp."""
        from datetime import datetime, timezone
        return datetime.now(timezone.utc).isoformat()


# Global activity stream instance
_activity_stream: Optional[ActivityStream] = None


def get_activity_stream() -> ActivityStream:
    """Get or create global activity stream instance."""
    global _activity_stream
    if _activity_stream is None:
        _activity_stream = ActivityStream()
        _activity_stream.start()
    return _activity_stream
