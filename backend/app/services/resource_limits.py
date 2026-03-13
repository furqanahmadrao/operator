"""
Resource Limits Service

Monitors and enforces resource limits for the agent runtime environment.
Tracks memory usage, CPU usage, concurrent operations, and workspace disk usage.
Emits warning events when limits are approached.

Requirements: 22
"""

import asyncio
import logging
import psutil
import shutil
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional

from .activity_stream import get_activity_stream, ActivityEventType

logger = logging.getLogger(__name__)


@dataclass
class ResourceUsage:
    """Current resource usage metrics."""
    memory_mb: float
    memory_percent: float
    cpu_percent: float
    workspace_size_mb: float
    active_commands: int
    active_browser_sessions: int
    timestamp: str


@dataclass
class ResourceLimits:
    """Configured resource limits."""
    memory_limit_gb: float
    cpu_limit_cores: float
    max_concurrent_commands: int
    max_concurrent_browser_sessions: int
    max_workspace_size_gb: float
    
    # Warning thresholds (percentage of limit)
    memory_warning_threshold: float = 0.8  # 80%
    cpu_warning_threshold: float = 0.8  # 80%
    workspace_warning_threshold: float = 0.9  # 90%


class ResourceLimitError(Exception):
    """Raised when a resource limit is exceeded."""
    pass


class ResourceLimitsMonitor:
    """
    Monitors and enforces resource limits for the agent runtime.
    
    Features:
    - Memory usage monitoring
    - CPU usage monitoring
    - Concurrent command limit enforcement
    - Concurrent browser session limit enforcement
    - Workspace disk usage monitoring
    - Warning event emission when limits approached
    """
    
    def __init__(
        self,
        workspace_root: str,
        limits: ResourceLimits,
        terminal_controller=None,
        browser_controller=None,
    ):
        """
        Initialize resource limits monitor.
        
        Args:
            workspace_root: Path to workspace directory
            limits: Resource limits configuration
            terminal_controller: Optional terminal controller for command tracking
            browser_controller: Optional browser controller for session tracking
        """
        self.workspace_root = Path(workspace_root)
        self.limits = limits
        self.terminal_controller = terminal_controller
        self.browser_controller = browser_controller
        
        # Track warning states to avoid spam
        self._memory_warning_emitted = False
        self._cpu_warning_emitted = False
        self._workspace_warning_emitted = False
        
        # Get process for monitoring
        self._process = psutil.Process()
        
        logger.info(
            f"Resource limits monitor initialized: "
            f"memory={limits.memory_limit_gb}GB, "
            f"cpu={limits.cpu_limit_cores} cores, "
            f"commands={limits.max_concurrent_commands}, "
            f"browser_sessions={limits.max_concurrent_browser_sessions}, "
            f"workspace={limits.max_workspace_size_gb}GB"
        )
    
    def get_memory_usage(self) -> tuple[float, float]:
        """
        Get current memory usage.
        
        Returns:
            Tuple of (memory_mb, memory_percent)
        """
        try:
            memory_info = self._process.memory_info()
            memory_mb = memory_info.rss / (1024 * 1024)  # Convert to MB
            memory_percent = memory_mb / (self.limits.memory_limit_gb * 1024) * 100
            return memory_mb, memory_percent
        except Exception as e:
            logger.error(f"Failed to get memory usage: {e}")
            return 0.0, 0.0
    
    def get_cpu_usage(self) -> float:
        """
        Get current CPU usage as percentage of limit.
        
        Returns:
            CPU usage percentage (0-100)
        """
        try:
            # Get CPU percent (interval=0.1 for quick measurement)
            cpu_percent = self._process.cpu_percent(interval=0.1)
            # Normalize to limit (e.g., if limit is 2 cores, 200% = 100% of limit)
            cpu_percent_of_limit = cpu_percent / (self.limits.cpu_limit_cores * 100) * 100
            return cpu_percent_of_limit
        except Exception as e:
            logger.error(f"Failed to get CPU usage: {e}")
            return 0.0
    
    def get_workspace_size(self) -> float:
        """
        Get current workspace disk usage in MB.
        
        Returns:
            Workspace size in MB
        """
        try:
            if not self.workspace_root.exists():
                return 0.0
            
            # Use shutil.disk_usage for total disk usage
            # Note: This gets the total usage of the directory tree
            total_size = 0
            for item in self.workspace_root.rglob('*'):
                if item.is_file():
                    try:
                        total_size += item.stat().st_size
                    except (OSError, PermissionError):
                        continue
            
            return total_size / (1024 * 1024)  # Convert to MB
        except Exception as e:
            logger.error(f"Failed to get workspace size: {e}")
            return 0.0
    
    def get_active_commands(self) -> int:
        """
        Get count of active terminal commands.
        
        Returns:
            Number of active commands
        """
        if self.terminal_controller is None:
            return 0
        
        try:
            return self.terminal_controller.get_active_process_count()
        except Exception as e:
            logger.error(f"Failed to get active command count: {e}")
            return 0
    
    def get_active_browser_sessions(self) -> int:
        """
        Get count of active browser sessions.
        
        Returns:
            Number of active browser sessions
        """
        if self.browser_controller is None:
            return 0
        
        try:
            return len(self.browser_controller.sessions)
        except Exception as e:
            logger.error(f"Failed to get browser session count: {e}")
            return 0
    
    def get_resource_usage(self) -> ResourceUsage:
        """
        Get current resource usage metrics.
        
        Returns:
            ResourceUsage with all current metrics
        """
        memory_mb, memory_percent = self.get_memory_usage()
        cpu_percent = self.get_cpu_usage()
        workspace_size_mb = self.get_workspace_size()
        active_commands = self.get_active_commands()
        active_browser_sessions = self.get_active_browser_sessions()
        
        return ResourceUsage(
            memory_mb=memory_mb,
            memory_percent=memory_percent,
            cpu_percent=cpu_percent,
            workspace_size_mb=workspace_size_mb,
            active_commands=active_commands,
            active_browser_sessions=active_browser_sessions,
            timestamp=datetime.now().isoformat()
        )
    
    def check_command_limit(self) -> bool:
        """
        Check if concurrent command limit would be exceeded.
        
        Returns:
            True if limit would be exceeded, False otherwise
        """
        active_commands = self.get_active_commands()
        return active_commands >= self.limits.max_concurrent_commands
    
    def check_browser_session_limit(self) -> bool:
        """
        Check if concurrent browser session limit would be exceeded.
        
        Returns:
            True if limit would be exceeded, False otherwise
        """
        active_sessions = self.get_active_browser_sessions()
        return active_sessions >= self.limits.max_concurrent_browser_sessions
    
    def enforce_command_limit(self) -> None:
        """
        Enforce concurrent command limit.
        
        Raises:
            ResourceLimitError: If limit would be exceeded
        """
        if self.check_command_limit():
            active = self.get_active_commands()
            raise ResourceLimitError(
                f"Concurrent command limit reached: {active}/{self.limits.max_concurrent_commands}. "
                "Wait for existing commands to complete."
            )
    
    def enforce_browser_session_limit(self) -> None:
        """
        Enforce concurrent browser session limit.
        
        Raises:
            ResourceLimitError: If limit would be exceeded
        """
        if self.check_browser_session_limit():
            active = self.get_active_browser_sessions()
            raise ResourceLimitError(
                f"Concurrent browser session limit reached: {active}/{self.limits.max_concurrent_browser_sessions}. "
                "Close existing sessions or wait for idle timeout."
            )
    
    async def check_and_emit_warnings(self, session_id: Optional[str] = None) -> None:
        """
        Check resource usage and emit warning events if thresholds exceeded.
        
        Args:
            session_id: Optional session ID for activity stream events
        """
        usage = self.get_resource_usage()
        activity_stream = get_activity_stream()
        
        # Check memory usage
        memory_threshold = self.limits.memory_limit_gb * 1024 * self.limits.memory_warning_threshold
        if usage.memory_mb > memory_threshold and not self._memory_warning_emitted:
            logger.warning(
                f"Memory usage approaching limit: {usage.memory_mb:.1f}MB / "
                f"{self.limits.memory_limit_gb * 1024:.1f}MB ({usage.memory_percent:.1f}%)"
            )
            
            if session_id:
                await activity_stream.emit(
                    session_id=session_id,
                    event_type=ActivityEventType.ERROR,
                    payload={
                        "warning_type": "memory_limit",
                        "message": f"Memory usage at {usage.memory_percent:.1f}% of limit",
                        "current_mb": usage.memory_mb,
                        "limit_mb": self.limits.memory_limit_gb * 1024,
                        "threshold_percent": self.limits.memory_warning_threshold * 100
                    }
                )
            
            self._memory_warning_emitted = True
        elif usage.memory_mb <= memory_threshold * 0.9:
            # Reset warning flag when usage drops below 90% of threshold
            self._memory_warning_emitted = False
        
        # Check CPU usage
        cpu_threshold = self.limits.cpu_limit_cores * 100 * self.limits.cpu_warning_threshold
        if usage.cpu_percent > self.limits.cpu_warning_threshold * 100 and not self._cpu_warning_emitted:
            logger.warning(
                f"CPU usage approaching limit: {usage.cpu_percent:.1f}% of "
                f"{self.limits.cpu_limit_cores} cores"
            )
            
            if session_id:
                await activity_stream.emit(
                    session_id=session_id,
                    event_type=ActivityEventType.ERROR,
                    payload={
                        "warning_type": "cpu_limit",
                        "message": f"CPU usage at {usage.cpu_percent:.1f}% of limit",
                        "current_percent": usage.cpu_percent,
                        "limit_cores": self.limits.cpu_limit_cores,
                        "threshold_percent": self.limits.cpu_warning_threshold * 100
                    }
                )
            
            self._cpu_warning_emitted = True
        elif usage.cpu_percent <= self.limits.cpu_warning_threshold * 100 * 0.9:
            self._cpu_warning_emitted = False
        
        # Check workspace size
        workspace_threshold_mb = self.limits.max_workspace_size_gb * 1024 * self.limits.workspace_warning_threshold
        if usage.workspace_size_mb > workspace_threshold_mb and not self._workspace_warning_emitted:
            workspace_percent = (usage.workspace_size_mb / (self.limits.max_workspace_size_gb * 1024)) * 100
            logger.warning(
                f"Workspace size approaching limit: {usage.workspace_size_mb:.1f}MB / "
                f"{self.limits.max_workspace_size_gb * 1024:.1f}MB ({workspace_percent:.1f}%)"
            )
            
            if session_id:
                await activity_stream.emit(
                    session_id=session_id,
                    event_type=ActivityEventType.ERROR,
                    payload={
                        "warning_type": "workspace_limit",
                        "message": f"Workspace size at {workspace_percent:.1f}% of limit",
                        "current_mb": usage.workspace_size_mb,
                        "limit_mb": self.limits.max_workspace_size_gb * 1024,
                        "threshold_percent": self.limits.workspace_warning_threshold * 100
                    }
                )
            
            self._workspace_warning_emitted = True
        elif usage.workspace_size_mb <= workspace_threshold_mb * 0.9:
            self._workspace_warning_emitted = False
    
    def get_limits_info(self) -> dict:
        """
        Get resource limits configuration as dictionary.
        
        Returns:
            Dictionary with limit information
        """
        return {
            "memory_limit_gb": self.limits.memory_limit_gb,
            "cpu_limit_cores": self.limits.cpu_limit_cores,
            "max_concurrent_commands": self.limits.max_concurrent_commands,
            "max_concurrent_browser_sessions": self.limits.max_concurrent_browser_sessions,
            "max_workspace_size_gb": self.limits.max_workspace_size_gb,
            "memory_warning_threshold_percent": self.limits.memory_warning_threshold * 100,
            "cpu_warning_threshold_percent": self.limits.cpu_warning_threshold * 100,
            "workspace_warning_threshold_percent": self.limits.workspace_warning_threshold * 100,
        }


# Global singleton instance
_resource_limits_monitor: Optional[ResourceLimitsMonitor] = None


def get_resource_limits_monitor(
    workspace_root: Optional[str] = None,
    limits: Optional[ResourceLimits] = None,
    terminal_controller=None,
    browser_controller=None,
) -> ResourceLimitsMonitor:
    """
    Get or create the global ResourceLimitsMonitor instance.
    
    Args:
        workspace_root: Path to workspace directory
        limits: Resource limits configuration
        terminal_controller: Optional terminal controller
        browser_controller: Optional browser controller
        
    Returns:
        ResourceLimitsMonitor singleton
    """
    global _resource_limits_monitor
    
    if _resource_limits_monitor is None:
        if workspace_root is None or limits is None:
            raise ValueError(
                "workspace_root and limits must be provided on first call"
            )
        
        _resource_limits_monitor = ResourceLimitsMonitor(
            workspace_root=workspace_root,
            limits=limits,
            terminal_controller=terminal_controller,
            browser_controller=browser_controller,
        )
        logger.info("Created ResourceLimitsMonitor singleton instance")
    
    return _resource_limits_monitor
