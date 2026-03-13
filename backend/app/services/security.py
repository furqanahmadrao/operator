"""
Security Boundary Service

Provides workspace sandboxing, command sanitization, and resource limit enforcement
to prevent agent access outside designated workspace directory.

Requirements: 1, 5, 6, 16, 20
"""

import logging
import os
import re
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


class SecurityViolation(Exception):
    """Raised when a security boundary is violated."""
    pass


class ResourceLimitExceeded(Exception):
    """Raised when a resource limit is exceeded."""
    pass


class SecurityBoundary:
    """
    Enforces security boundaries for agent operations.
    
    - Validates file paths against workspace boundary
    - Sanitizes shell commands for dangerous patterns
    - Enforces resource limits
    - Logs security violations
    """
    
    # Default workspace root (can be overridden via environment variable)
    DEFAULT_WORKSPACE_ROOT = Path("/workspace")
    
    # Dangerous command patterns that should be blocked
    BLOCKED_COMMAND_PATTERNS = [
        r"rm\s+-rf\s+/(?!workspace)",  # rm -rf / (but allow /workspace)
        r"dd\s+if=",  # dd commands (disk operations)
        r":\(\)\s*\{.*\}",  # Fork bomb pattern
        r"sudo\s",  # Privilege escalation
        r"su\s",  # Switch user
        r"chmod\s+[0-7]*7[0-7]*\s+/",  # chmod with world-writable on root
        r"chown\s+.*\s+/(?!workspace)",  # chown on root
        r"mkfs\.",  # Filesystem creation
        r"fdisk\s",  # Disk partitioning
        r"mount\s",  # Mounting filesystems
        r"umount\s",  # Unmounting filesystems
        r"systemctl\s",  # System service control
        r"service\s",  # Service management
        r"reboot",  # System reboot
        r"shutdown",  # System shutdown
        r"init\s+[0-6]",  # Runlevel changes
        r"kill\s+-9\s+1",  # Kill init process
        r">\s*/dev/sd[a-z]",  # Direct disk writes
        r"curl.*\|\s*bash",  # Pipe to shell
        r"wget.*\|\s*sh",  # Pipe to shell
    ]
    
    # Resource limits (configurable via environment variables)
    MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024  # 100MB
    MAX_WORKSPACE_SIZE_BYTES = 10 * 1024 * 1024 * 1024  # 10GB
    MAX_CONCURRENT_COMMANDS = 3
    MAX_CONCURRENT_BROWSER_SESSIONS = 5
    
    def __init__(self, workspace_root: str | Path | None = None):
        """
        Initialize security boundary.
        
        Args:
            workspace_root: Root directory for workspace. Defaults to /workspace
                          or WORKSPACE_ROOT environment variable.
        """
        if workspace_root is None:
            workspace_root = os.environ.get(
                "WORKSPACE_ROOT",
                str(self.DEFAULT_WORKSPACE_ROOT)
            )
        
        self.workspace_root = Path(workspace_root).resolve()
        
        # Ensure workspace root exists
        self.workspace_root.mkdir(parents=True, exist_ok=True)
        
        # Load resource limits from environment
        self.max_file_size = int(
            os.environ.get("MAX_FILE_SIZE_MB", 100)
        ) * 1024 * 1024
        
        self.max_workspace_size = int(
            os.environ.get("MAX_WORKSPACE_SIZE_GB", 10)
        ) * 1024 * 1024 * 1024
        
        self.max_concurrent_commands = int(
            os.environ.get("MAX_CONCURRENT_COMMANDS", 3)
        )
        
        self.max_concurrent_browser_sessions = int(
            os.environ.get("MAX_CONCURRENT_BROWSER_SESSIONS", 5)
        )
        
        logger.info(
            f"Security boundary initialized: workspace_root={self.workspace_root}"
        )
    
    def validate_path(self, path: str | Path) -> Path:
        """
        Validate that a path is within the workspace boundary.
        
        Resolves symlinks and ensures the final path is within workspace_root.
        
        Args:
            path: Path to validate (absolute or relative to workspace_root)
        
        Returns:
            Resolved absolute path within workspace
        
        Raises:
            SecurityViolation: If path is outside workspace boundary
        """
        try:
            # Convert to Path object
            path_obj = Path(path)
            
            # If path is absolute, use it directly; otherwise join with workspace_root
            if path_obj.is_absolute():
                resolved = path_obj.resolve()
            else:
                resolved = (self.workspace_root / path_obj).resolve()
            
            # Check if resolved path is within workspace_root
            # Use is_relative_to for Python 3.9+
            try:
                resolved.relative_to(self.workspace_root)
            except ValueError:
                # Path is outside workspace
                logger.warning(
                    f"Security violation: Path outside workspace: {path} -> {resolved}"
                )
                raise SecurityViolation(
                    f"Path outside workspace boundary: {path}"
                )
            
            return resolved
            
        except Exception as e:
            if isinstance(e, SecurityViolation):
                raise
            logger.error(f"Path validation error for {path}: {e}")
            raise SecurityViolation(f"Invalid path: {path}")
    
    def sanitize_command(self, command: str) -> str:
        """
        Sanitize shell command and check against blocklist.
        
        Args:
            command: Shell command to sanitize
        
        Returns:
            Original command if safe
        
        Raises:
            SecurityViolation: If command matches dangerous pattern
        """
        # Check against blocked patterns
        for pattern in self.BLOCKED_COMMAND_PATTERNS:
            if re.search(pattern, command, re.IGNORECASE):
                logger.warning(
                    f"Security violation: Dangerous command blocked: {command}"
                )
                raise SecurityViolation(
                    f"Command blocked due to security policy: matches pattern '{pattern}'"
                )
        
        return command
    
    def check_file_size(self, size_bytes: int) -> None:
        """
        Check if file size is within limits.
        
        Args:
            size_bytes: File size in bytes
        
        Raises:
            ResourceLimitExceeded: If file size exceeds limit
        """
        if size_bytes > self.max_file_size:
            logger.warning(
                f"Resource limit exceeded: File size {size_bytes} bytes "
                f"exceeds limit {self.max_file_size} bytes"
            )
            raise ResourceLimitExceeded(
                f"File size {size_bytes / 1024 / 1024:.2f}MB exceeds "
                f"limit {self.max_file_size / 1024 / 1024:.2f}MB"
            )
    
    def check_workspace_size(self) -> dict[str, Any]:
        """
        Check current workspace disk usage.
        
        Returns:
            Dictionary with usage information:
            - size_bytes: Current workspace size
            - limit_bytes: Maximum allowed size
            - usage_percent: Percentage of limit used
            - within_limit: Boolean indicating if within limit
        
        Raises:
            ResourceLimitExceeded: If workspace size exceeds limit
        """
        total_size = 0
        
        try:
            for dirpath, dirnames, filenames in os.walk(self.workspace_root):
                for filename in filenames:
                    filepath = Path(dirpath) / filename
                    try:
                        total_size += filepath.stat().st_size
                    except (OSError, FileNotFoundError):
                        # Skip files that can't be accessed
                        continue
        except Exception as e:
            logger.error(f"Error calculating workspace size: {e}")
            # Don't fail on calculation errors
            return {
                "size_bytes": 0,
                "limit_bytes": self.max_workspace_size,
                "usage_percent": 0.0,
                "within_limit": True,
                "error": str(e)
            }
        
        usage_percent = (total_size / self.max_workspace_size) * 100
        within_limit = total_size <= self.max_workspace_size
        
        result = {
            "size_bytes": total_size,
            "limit_bytes": self.max_workspace_size,
            "usage_percent": usage_percent,
            "within_limit": within_limit
        }
        
        if not within_limit:
            logger.warning(
                f"Resource limit exceeded: Workspace size {total_size / 1024 / 1024:.2f}MB "
                f"exceeds limit {self.max_workspace_size / 1024 / 1024:.2f}MB"
            )
            raise ResourceLimitExceeded(
                f"Workspace size {total_size / 1024 / 1024 / 1024:.2f}GB exceeds "
                f"limit {self.max_workspace_size / 1024 / 1024 / 1024:.2f}GB"
            )
        
        return result
    
    def check_concurrent_limit(
        self,
        current_count: int,
        limit_type: str = "commands"
    ) -> None:
        """
        Check if concurrent resource count is within limits.
        
        Args:
            current_count: Current number of concurrent resources
            limit_type: Type of resource ("commands" or "browser_sessions")
        
        Raises:
            ResourceLimitExceeded: If concurrent limit exceeded
        """
        if limit_type == "commands":
            limit = self.max_concurrent_commands
        elif limit_type == "browser_sessions":
            limit = self.max_concurrent_browser_sessions
        else:
            raise ValueError(f"Unknown limit_type: {limit_type}")
        
        if current_count >= limit:
            logger.warning(
                f"Resource limit exceeded: {current_count} concurrent {limit_type} "
                f"exceeds limit {limit}"
            )
            raise ResourceLimitExceeded(
                f"Concurrent {limit_type} limit ({limit}) exceeded"
            )
    
    def get_safe_working_directory(self) -> Path:
        """
        Get the safe working directory for command execution.
        
        Returns:
            Workspace root path
        """
        return self.workspace_root
    
    def log_violation(
        self,
        violation_type: str,
        details: str,
        context: dict[str, Any] | None = None
    ) -> None:
        """
        Log a security violation.
        
        Args:
            violation_type: Type of violation (e.g., "path_traversal", "dangerous_command")
            details: Detailed description of the violation
            context: Additional context information
        """
        log_entry = {
            "violation_type": violation_type,
            "details": details,
            "context": context or {}
        }
        
        logger.warning(f"Security violation logged: {log_entry}")


# Global singleton instance
_security_boundary: SecurityBoundary | None = None


def get_security_boundary() -> SecurityBoundary:
    """
    Get the global SecurityBoundary instance.
    
    Returns:
        SecurityBoundary singleton
    """
    global _security_boundary
    if _security_boundary is None:
        _security_boundary = SecurityBoundary()
    return _security_boundary
