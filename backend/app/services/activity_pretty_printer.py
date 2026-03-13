"""
Activity Event Pretty Printer

Formats activity events into human-readable text for display in UI and logs.
Implements relative path formatting, timestamp formatting, and output truncation.
"""

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.api.schemas import (
    ActivityEventType,
    BrowserClickEvent,
    BrowserNavigateEvent,
    BrowserScreenshotEvent,
    DirectoryChangedEvent,
    ErrorEvent,
    FileOperationEvent,
    PlanningEvent,
    ProgressUpdateEvent,
    ReflectionEvent,
    TerminalCompleteEvent,
    TerminalOutputEvent,
    ToolEndEvent,
    ToolStartEvent,
)


class ActivityPrettyPrinter:
    """
    Formats activity events into human-readable text.
    
    Features:
    - Human-readable formatting for each event type
    - Relative path formatting (relative to workspace)
    - User-friendly timestamp formatting
    - Output truncation with ellipsis for long content
    - JSON payload formatting with indentation
    """
    
    def __init__(
        self,
        workspace_root: str = "/workspace",
        max_output_length: int = 500,
        timestamp_format: str = "relative",
    ):
        """
        Initialize pretty printer.
        
        Args:
            workspace_root: Workspace root path for relative path formatting
            max_output_length: Maximum length for output before truncation
            timestamp_format: "relative", "iso", or "human"
        """
        self.workspace_root = Path(workspace_root)
        self.max_output_length = max_output_length
        self.timestamp_format = timestamp_format
    
    def format_event(self, event: Any) -> str:
        """
        Format activity event into human-readable text.
        
        Args:
            event: Activity event (Pydantic model or dict)
        
        Returns:
            Human-readable formatted string
        """
        # Convert Pydantic model to dict if needed
        if hasattr(event, "model_dump"):
            event_dict = event.model_dump()
            event_type = event_dict.get("type")
        elif isinstance(event, dict):
            event_dict = event
            event_type = event_dict.get("type") or event_dict.get("event_type")
        else:
            return f"Unknown event: {event}"
        
        # Format timestamp
        timestamp = event_dict.get("timestamp", "")
        formatted_time = self._format_timestamp(timestamp)
        
        # Route to specific formatter based on event type
        formatters = {
            ActivityEventType.TERMINAL_OUTPUT: self._format_terminal_output,
            ActivityEventType.TERMINAL_COMPLETE: self._format_terminal_complete,
            ActivityEventType.BROWSER_NAVIGATE: self._format_browser_navigate,
            ActivityEventType.BROWSER_CLICK: self._format_browser_click,
            ActivityEventType.BROWSER_SCREENSHOT: self._format_browser_screenshot,
            ActivityEventType.FILE_CREATED: self._format_file_operation,
            ActivityEventType.FILE_MODIFIED: self._format_file_operation,
            ActivityEventType.FILE_DELETED: self._format_file_operation,
            ActivityEventType.DIRECTORY_CHANGED: self._format_directory_changed,
            ActivityEventType.PLANNING: self._format_planning,
            ActivityEventType.REFLECTION: self._format_reflection,
            ActivityEventType.PROGRESS_UPDATE: self._format_progress_update,
            ActivityEventType.ERROR: self._format_error,
            ActivityEventType.TOOL_START: self._format_tool_start,
            ActivityEventType.TOOL_END: self._format_tool_end,
        }
        
        formatter = formatters.get(event_type)
        if formatter:
            content = formatter(event_dict)
            return f"[{formatted_time}] {content}"
        else:
            return f"[{formatted_time}] Unknown event type: {event_type}"
    
    def _format_terminal_output(self, event: dict[str, Any]) -> str:
        """Format terminal output event."""
        content = event.get("content", "")
        stream_type = event.get("stream_type", "stdout")
        working_dir = event.get("working_directory", "/workspace")
        
        # Format working directory as relative path
        rel_dir = self._format_path(working_dir)
        
        # Truncate long output
        truncated_content = self._truncate_output(content)
        
        stream_label = "stderr" if stream_type == "stderr" else "stdout"
        return f"Terminal ({stream_label}) in {rel_dir}: {truncated_content}"
    
    def _format_terminal_complete(self, event: dict[str, Any]) -> str:
        """Format terminal completion event."""
        exit_code = event.get("exit_code", 0)
        command = event.get("command", "")
        duration_ms = event.get("duration_ms", 0)
        
        status = "✓" if exit_code == 0 else "✗"
        duration_sec = duration_ms / 1000.0
        
        return f"Command {status} (exit {exit_code}): {command} [{duration_sec:.2f}s]"
    
    def _format_browser_navigate(self, event: dict[str, Any]) -> str:
        """Format browser navigation event."""
        url = event.get("url", "")
        session_name = event.get("session_name", "default")
        status = event.get("status", "started")
        error = event.get("error")
        
        if status == "failed" and error:
            return f"Browser [{session_name}] failed to navigate to {url}: {error}"
        elif status == "completed":
            return f"Browser [{session_name}] navigated to {url}"
        else:
            return f"Browser [{session_name}] navigating to {url}..."
    
    def _format_browser_click(self, event: dict[str, Any]) -> str:
        """Format browser click event."""
        selector = event.get("selector", "")
        session_name = event.get("session_name", "default")
        status = event.get("status", "started")
        error = event.get("error")
        
        if status == "failed" and error:
            return f"Browser [{session_name}] failed to click '{selector}': {error}"
        elif status == "completed":
            return f"Browser [{session_name}] clicked '{selector}'"
        else:
            return f"Browser [{session_name}] clicking '{selector}'..."
    
    def _format_browser_screenshot(self, event: dict[str, Any]) -> str:
        """Format browser screenshot event."""
        filename = event.get("filename", "")
        session_name = event.get("session_name", "default")
        status = event.get("status", "started")
        error = event.get("error")
        
        rel_path = self._format_path(filename)
        
        if status == "failed" and error:
            return f"Browser [{session_name}] failed to capture screenshot: {error}"
        elif status == "completed":
            return f"Browser [{session_name}] captured screenshot: {rel_path}"
        else:
            return f"Browser [{session_name}] capturing screenshot..."
    
    def _format_file_operation(self, event: dict[str, Any]) -> str:
        """Format file operation event (created, modified, deleted)."""
        event_type = event.get("type")
        path = event.get("path", "")
        size_bytes = event.get("size_bytes")
        file_type = event.get("file_type")
        
        rel_path = self._format_path(path)
        
        operation_labels = {
            "file_created": "Created",
            "file_modified": "Modified",
            "file_deleted": "Deleted",
        }
        
        operation = operation_labels.get(event_type, "File operation")
        
        parts = [f"{operation} {rel_path}"]
        
        if size_bytes is not None:
            size_str = self._format_file_size(size_bytes)
            parts.append(f"({size_str})")
        
        if file_type:
            parts.append(f"[{file_type}]")
        
        return " ".join(parts)
    
    def _format_directory_changed(self, event: dict[str, Any]) -> str:
        """Format directory change event."""
        old_path = event.get("old_path", "")
        new_path = event.get("new_path", "")
        
        old_rel = self._format_path(old_path)
        new_rel = self._format_path(new_path)
        
        return f"Changed directory: {old_rel} → {new_rel}"
    
    def _format_planning(self, event: dict[str, Any]) -> str:
        """Format planning event."""
        sub_tasks = event.get("sub_tasks", [])
        reasoning = event.get("reasoning", "")
        
        tasks_str = "\n".join(f"  {i+1}. {task}" for i, task in enumerate(sub_tasks))
        
        if reasoning:
            truncated_reasoning = self._truncate_output(reasoning, max_length=200)
            return f"Planning: {truncated_reasoning}\nSub-tasks:\n{tasks_str}"
        else:
            return f"Planning:\n{tasks_str}"
    
    def _format_reflection(self, event: dict[str, Any]) -> str:
        """Format reflection event."""
        observation = event.get("observation", "")
        adjustment = event.get("adjustment")
        
        truncated_obs = self._truncate_output(observation, max_length=300)
        
        if adjustment:
            return f"Reflection: {truncated_obs}\nAdjustment: {adjustment}"
        else:
            return f"Reflection: {truncated_obs}"
    
    def _format_progress_update(self, event: dict[str, Any]) -> str:
        """Format progress update event."""
        task_name = event.get("task_name", "")
        current_step = event.get("current_step", 0)
        total_steps = event.get("total_steps", 0)
        step_description = event.get("step_description", "")
        status = event.get("status", "in_progress")
        elapsed_ms = event.get("elapsed_ms", 0)
        
        elapsed_sec = elapsed_ms / 1000.0
        progress_pct = (current_step / total_steps * 100) if total_steps > 0 else 0
        
        status_icons = {
            "in_progress": "⏳",
            "completed": "✓",
            "failed": "✗",
        }
        
        icon = status_icons.get(status, "•")
        
        return (
            f"{icon} {task_name} [{current_step}/{total_steps} - {progress_pct:.0f}%] "
            f"{step_description} ({elapsed_sec:.1f}s)"
        )
    
    def _format_error(self, event: dict[str, Any]) -> str:
        """Format error event."""
        error_type = event.get("error_type", "unknown")
        message = event.get("message", "")
        details = event.get("details", {})
        recoverable = event.get("recoverable", True)
        retry_count = event.get("retry_count", 0)
        
        recovery_label = "recoverable" if recoverable else "unrecoverable"
        
        parts = [f"Error ({error_type}, {recovery_label}): {message}"]
        
        if retry_count > 0:
            parts.append(f"[retry {retry_count}]")
        
        if details:
            details_str = self._format_json(details, indent=2)
            truncated_details = self._truncate_output(details_str, max_length=200)
            parts.append(f"\nDetails: {truncated_details}")
        
        return " ".join(parts)
    
    def _format_tool_start(self, event: dict[str, Any]) -> str:
        """Format tool start event."""
        tool_name = event.get("tool_name", "")
        parameters = event.get("parameters", {})
        
        if parameters:
            params_str = self._format_json(parameters, indent=0)
            truncated_params = self._truncate_output(params_str, max_length=100)
            return f"Tool started: {tool_name}({truncated_params})"
        else:
            return f"Tool started: {tool_name}()"
    
    def _format_tool_end(self, event: dict[str, Any]) -> str:
        """Format tool end event."""
        tool_name = event.get("tool_name", "")
        result_summary = event.get("result_summary")
        status = event.get("status", "success")
        error = event.get("error")
        duration_ms = event.get("duration_ms", 0)
        
        duration_sec = duration_ms / 1000.0
        status_icon = "✓" if status == "success" else "✗"
        
        parts = [f"Tool {status_icon} {tool_name} [{duration_sec:.2f}s]"]
        
        if status == "failed" and error:
            parts.append(f": {error}")
        elif result_summary:
            truncated_summary = self._truncate_output(result_summary, max_length=100)
            parts.append(f": {truncated_summary}")
        
        return "".join(parts)
    
    def _format_path(self, path: str) -> str:
        """
        Format file path as relative to workspace root.
        
        Args:
            path: Absolute or relative file path
        
        Returns:
            Path relative to workspace root, or original if not in workspace
        """
        try:
            path_obj = Path(path)
            
            # If path is absolute and within workspace, make it relative
            if path_obj.is_absolute():
                try:
                    rel_path = path_obj.relative_to(self.workspace_root)
                    # Use forward slashes for consistency
                    return f"./{rel_path.as_posix()}"
                except ValueError:
                    # Path is not relative to workspace
                    return str(path)
            else:
                # Already relative, normalize it
                normalized = Path(path).as_posix()
                return f"./{normalized}" if not normalized.startswith("./") else normalized
        except Exception:
            return path
    
    def _format_timestamp(self, timestamp: str) -> str:
        """
        Format ISO 8601 timestamp in user-friendly format.
        
        Args:
            timestamp: ISO 8601 timestamp string
        
        Returns:
            Formatted timestamp based on self.timestamp_format
        """
        if not timestamp:
            return "unknown time"
        
        try:
            dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
            
            if self.timestamp_format == "iso":
                return timestamp
            elif self.timestamp_format == "human":
                return dt.strftime("%Y-%m-%d %H:%M:%S")
            elif self.timestamp_format == "relative":
                # Calculate relative time
                now = datetime.now(timezone.utc)
                delta = now - dt
                
                seconds = delta.total_seconds()
                
                if seconds < 1:
                    return "just now"
                elif seconds < 60:
                    return f"{int(seconds)}s ago"
                elif seconds < 3600:
                    minutes = int(seconds / 60)
                    return f"{minutes}m ago"
                elif seconds < 86400:
                    hours = int(seconds / 3600)
                    return f"{hours}h ago"
                else:
                    days = int(seconds / 86400)
                    return f"{days}d ago"
            else:
                return timestamp
        except Exception:
            return timestamp
    
    def _truncate_output(self, text: str, max_length: int | None = None) -> str:
        """
        Truncate long text with ellipsis.
        
        Args:
            text: Text to truncate
            max_length: Maximum length (uses self.max_output_length if None)
        
        Returns:
            Truncated text with "..." if exceeds max_length
        """
        if max_length is None:
            max_length = self.max_output_length
        
        if len(text) <= max_length:
            return text
        
        # Truncate and add ellipsis
        return text[:max_length - 3] + "..."
    
    def _format_json(self, data: dict[str, Any], indent: int = 2) -> str:
        """
        Format dictionary as JSON string.
        
        Args:
            data: Dictionary to format
            indent: Indentation level (0 for compact)
        
        Returns:
            JSON formatted string
        """
        try:
            if indent == 0:
                return json.dumps(data, separators=(",", ":"))
            else:
                return json.dumps(data, indent=indent)
        except Exception:
            return str(data)
    
    def _format_file_size(self, size_bytes: int) -> str:
        """
        Format file size in human-readable format.
        
        Args:
            size_bytes: File size in bytes
        
        Returns:
            Human-readable size string (e.g., "1.5 KB", "2.3 MB")
        """
        if size_bytes < 1024:
            return f"{size_bytes} B"
        elif size_bytes < 1024 * 1024:
            kb = size_bytes / 1024
            return f"{kb:.1f} KB"
        elif size_bytes < 1024 * 1024 * 1024:
            mb = size_bytes / (1024 * 1024)
            return f"{mb:.1f} MB"
        else:
            gb = size_bytes / (1024 * 1024 * 1024)
            return f"{gb:.2f} GB"


# Global pretty printer instance
_pretty_printer: ActivityPrettyPrinter | None = None


def get_pretty_printer(
    workspace_root: str = "/workspace",
    max_output_length: int = 500,
    timestamp_format: str = "relative",
) -> ActivityPrettyPrinter:
    """
    Get or create global pretty printer instance.
    
    Args:
        workspace_root: Workspace root path for relative path formatting
        max_output_length: Maximum length for output before truncation
        timestamp_format: "relative", "iso", or "human"
    
    Returns:
        ActivityPrettyPrinter instance
    """
    global _pretty_printer
    if _pretty_printer is None:
        _pretty_printer = ActivityPrettyPrinter(
            workspace_root=workspace_root,
            max_output_length=max_output_length,
            timestamp_format=timestamp_format,
        )
    return _pretty_printer
