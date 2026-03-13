"""
Terminal Controller Service

Provides asynchronous shell command execution in Alpine Linux environment
with real-time output streaming, timeout enforcement, and security boundaries.

Requirements: 6, 7, 12, 16
"""

import asyncio
import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import AsyncIterator, Callable
from uuid import uuid4

from .security import SecurityBoundary, SecurityViolation, get_security_boundary
from .activity_stream import get_activity_stream, ActivityEventType
from .error_recovery import get_error_recovery_service, RecoverableError, ErrorType

logger = logging.getLogger(__name__)


@dataclass
class CommandResult:
    """Result of command execution."""
    exit_code: int
    stdout: str
    stderr: str
    duration_ms: int
    timed_out: bool = False


class TerminalController:
    """
    Manages Alpine Linux terminal access and command execution.
    
    Features:
    - Async command execution with asyncio.subprocess
    - Real-time stdout/stderr streaming
    - Command timeout enforcement
    - Working directory management
    - Security boundary integration
    - Command history tracking
    """
    
    DEFAULT_TIMEOUT = 30  # seconds
    
    def __init__(
        self,
        security_boundary: SecurityBoundary | None = None,
        default_timeout: int = DEFAULT_TIMEOUT
    ):
        """
        Initialize terminal controller.
        
        Args:
            security_boundary: Security boundary instance for validation
            default_timeout: Default command timeout in seconds
        """
        self.security = security_boundary or get_security_boundary()
        self.default_timeout = default_timeout
        self._current_directory = self.security.get_safe_working_directory()
        self._active_processes: dict[int, asyncio.subprocess.Process] = {}
        
        logger.info(
            f"Terminal controller initialized: cwd={self._current_directory}, "
            f"timeout={self.default_timeout}s"
        )
    
    def get_current_directory(self) -> Path:
        """
        Get current working directory.
        
        Returns:
            Current working directory path
        """
        return self._current_directory
    
    async def change_directory(self, path: str) -> Path:
        """
        Change working directory within workspace.
        
        Args:
            path: Target directory path (absolute or relative)
        
        Returns:
            New working directory path
        
        Raises:
            SecurityViolation: If path is outside workspace
            FileNotFoundError: If directory doesn't exist
        """
        # Validate path is within workspace
        validated_path = self.security.validate_path(path)
        
        # Check if directory exists
        if not validated_path.exists():
            raise FileNotFoundError(f"Directory not found: {path}")
        
        if not validated_path.is_dir():
            raise NotADirectoryError(f"Not a directory: {path}")
        
        self._current_directory = validated_path
        logger.info(f"Changed directory to: {self._current_directory}")
        
        return self._current_directory
    
    async def execute_command(
        self,
        command: str,
        timeout: int | None = None,
        env: dict[str, str] | None = None,
        stream_callback: Callable[[str, str], None] | None = None,
        session_id: str | None = None
    ) -> CommandResult:
        """
        Execute shell command asynchronously with enhanced timeout handling.
        
        Args:
            command: Shell command to execute
            timeout: Command timeout in seconds (None = default)
            env: Additional environment variables
            stream_callback: Optional callback for real-time output
                           Called with (content: str, stream_type: str)
            session_id: Optional session ID for activity stream events
        
        Returns:
            CommandResult with exit code, output, and metadata
        
        Raises:
            SecurityViolation: If command is dangerous
            RecoverableError: For retryable errors like timeouts
        """
        # Sanitize command for security
        self.security.sanitize_command(command)
        
        # Use default timeout if not specified
        if timeout is None:
            timeout = self.default_timeout
        
        # Use error recovery service for retry logic
        recovery_service = get_error_recovery_service()
        
        async def command_operation():
            return await self._execute_command_internal(
                command, timeout, env, stream_callback, session_id
            )
        
        try:
            result = await recovery_service.retry_with_backoff(
                operation=command_operation,
                operation_name="terminal_execute_command",
                session_id=session_id
            )
            
            if result.success:
                return result.result
            else:
                # Convert error to CommandResult
                return CommandResult(
                    exit_code=-1,
                    stdout="",
                    stderr=f"Command failed after retries: {result.error}",
                    duration_ms=result.total_duration_ms,
                    timed_out=isinstance(result.error, RecoverableError) and 
                              result.error.error_type == ErrorType.COMMAND_TIMEOUT
                )
                
        except Exception as e:
            # Final fallback
            return CommandResult(
                exit_code=-1,
                stdout="",
                stderr=f"Command execution error: {str(e)}",
                duration_ms=0,
                timed_out=False
            )
    
    async def _execute_command_internal(
        self,
        command: str,
        timeout: int,
        env: dict[str, str] | None,
        stream_callback: Callable[[str, str], None] | None,
        session_id: str | None
    ) -> CommandResult:
        """Internal command execution with timeout handling."""
        # Prepare environment
        process_env = dict(env) if env else {}
        
        # Get activity stream for event emission
        activity_stream = get_activity_stream()
        correlation_id = str(uuid4()) if session_id else None
        
        logger.info(
            f"Executing command: {command} (timeout={timeout}s, cwd={self._current_directory})"
        )
        
        start_time = time.time()
        stdout_lines = []
        stderr_lines = []
        timed_out = False
        process = None
        
        try:
            # Create subprocess
            process = await asyncio.create_subprocess_shell(
                command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(self._current_directory),
                env=process_env if process_env else None
            )
            
            # Track active process
            self._active_processes[process.pid] = process
            
            try:
                # Stream output in real-time with timeout
                async def stream_output(stream, stream_type: str, lines_list: list):
                    """Stream output from subprocess."""
                    while True:
                        try:
                            # Use a short timeout for readline to allow for overall timeout checking
                            line = await asyncio.wait_for(stream.readline(), timeout=1.0)
                            if not line:
                                break
                            
                            decoded = line.decode('utf-8', errors='replace')
                            lines_list.append(decoded)
                            
                            # Emit activity stream event for terminal output
                            if session_id and correlation_id:
                                await activity_stream.emit_terminal_output(
                                    session_id=session_id,
                                    content=decoded,
                                    stream_type=stream_type,
                                    command_context=command,
                                    working_directory=str(self._current_directory),
                                    correlation_id=correlation_id
                                )
                            
                            # Call stream callback if provided
                            if stream_callback:
                                stream_callback(decoded, stream_type)
                                
                        except asyncio.TimeoutError:
                            # Check if process is still running
                            if process.returncode is not None:
                                break
                            # Continue reading if process is still alive
                            continue
                
                # Stream stdout and stderr concurrently with overall timeout
                try:
                    await asyncio.wait_for(
                        asyncio.gather(
                            stream_output(process.stdout, "stdout", stdout_lines),
                            stream_output(process.stderr, "stderr", stderr_lines),
                            process.wait()
                        ),
                        timeout=timeout
                    )
                    
                except asyncio.TimeoutError:
                    logger.warning(f"Command timed out after {timeout}s: {command}")
                    timed_out = True
                    
                    # Attempt graceful termination
                    await self._terminate_process_gracefully(process, command)
                    
                    # Raise recoverable error for retry logic
                    raise RecoverableError(
                        f"Command timed out after {timeout}s",
                        ErrorType.COMMAND_TIMEOUT
                    )
                
            finally:
                # Remove from active processes
                self._active_processes.pop(process.pid, None)
            
            duration_ms = int((time.time() - start_time) * 1000)
            
            result = CommandResult(
                exit_code=process.returncode,
                stdout=''.join(stdout_lines),
                stderr=''.join(stderr_lines),
                duration_ms=duration_ms,
                timed_out=timed_out
            )
            
            # Emit terminal completion event
            if session_id and correlation_id:
                await activity_stream.emit_terminal_complete(
                    session_id=session_id,
                    exit_code=process.returncode,
                    command=command,
                    duration_ms=duration_ms,
                    correlation_id=correlation_id
                )
            
            logger.info(
                f"Command completed: exit_code={result.exit_code}, "
                f"duration={result.duration_ms}ms"
            )
            
            return result
            
        except RecoverableError:
            # Re-raise recoverable errors for retry logic
            raise
            
        except Exception as e:
            logger.error(f"Command execution error: {e}")
            duration_ms = int((time.time() - start_time) * 1000)
            
            # Clean up process if it exists
            if process and process.returncode is None:
                await self._terminate_process_gracefully(process, command)
            
            # Check if it's a retryable error
            if self._is_retryable_command_error(e):
                raise RecoverableError(
                    f"Retryable command error: {e}",
                    ErrorType.TEMPORARY_FAILURE,
                    e
                )
            else:
                # Non-retryable error, return result
                return CommandResult(
                    exit_code=-1,
                    stdout=''.join(stdout_lines),
                    stderr=''.join(stderr_lines) + f"\n[Error: {str(e)}]",
                    duration_ms=duration_ms
                )
    
    async def _terminate_process_gracefully(self, process: asyncio.subprocess.Process, command: str) -> None:
        """Terminate process gracefully with escalating force."""
        try:
            # First try SIGTERM
            process.terminate()
            logger.info(f"Sent SIGTERM to process {process.pid} for command: {command}")
            
            try:
                # Wait up to 5 seconds for graceful termination
                await asyncio.wait_for(process.wait(), timeout=5)
                logger.info(f"Process {process.pid} terminated gracefully")
                return
            except asyncio.TimeoutError:
                logger.warning(f"Process {process.pid} did not terminate gracefully, using SIGKILL")
                
                # Force kill if terminate doesn't work
                process.kill()
                await process.wait()
                logger.info(f"Process {process.pid} killed forcefully")
                
        except ProcessLookupError:
            # Process already terminated
            logger.info(f"Process {process.pid} already terminated")
        except Exception as e:
            logger.error(f"Error terminating process {process.pid}: {e}")
    
    def _is_retryable_command_error(self, error: Exception) -> bool:
        """Check if command error is retryable."""
        error_str = str(error).lower()
        return any(term in error_str for term in [
            "resource temporarily unavailable",
            "no such file or directory",  # Might be temporary
            "permission denied",  # Might be temporary file lock
            "device or resource busy",
            "interrupted system call"
        ])
    
    async def kill_process_with_recovery(self, pid: int, session_id: str = None) -> bool:
        """
        Kill an active process with error recovery.
        
        Args:
            pid: Process ID to kill
            session_id: Optional session ID for activity stream events
        
        Returns:
            True if process was killed, False if not found
        """
        recovery_service = get_error_recovery_service()
        
        async def kill_operation():
            process = self._active_processes.get(pid)
            
            if process is None:
                logger.warning(f"Process not found: {pid}")
                return False
            
            try:
                await self._terminate_process_gracefully(process, f"PID {pid}")
                logger.info(f"Process terminated: {pid}")
                self._active_processes.pop(pid, None)
                return True
                
            except Exception as e:
                logger.error(f"Failed to kill process {pid}: {e}")
                raise RecoverableError(
                    f"Failed to kill process {pid}: {e}",
                    ErrorType.TEMPORARY_FAILURE,
                    e
                )
        
        try:
            result = await recovery_service.retry_with_backoff(
                operation=kill_operation,
                operation_name="terminal_kill_process",
                session_id=session_id
            )
            
            return result.success and result.result
            
        except Exception as e:
            logger.error(f"Process kill failed permanently: {e}")
            return False
    
    async def execute_command_stream(
        self,
        command: str,
        timeout: int | None = None,
        env: dict[str, str] | None = None
    ) -> AsyncIterator[tuple[str, str]]:
        """
        Execute command and stream output in real-time.
        
        Yields tuples of (content, stream_type) where stream_type is "stdout" or "stderr".
        
        Args:
            command: Shell command to execute
            timeout: Command timeout in seconds
            env: Additional environment variables
        
        Yields:
            Tuple of (content: str, stream_type: str)
        
        Raises:
            SecurityViolation: If command is dangerous
        """
        # Sanitize command
        self.security.sanitize_command(command)
        
        if timeout is None:
            timeout = self.default_timeout
        
        logger.info(
            f"Executing command (streaming): {command} (timeout={timeout}s)"
        )
        
        try:
            process = await asyncio.create_subprocess_shell(
                command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(self._current_directory),
                env=env if env else None
            )
            
            self._active_processes[process.pid] = process
            
            try:
                async def read_stream(stream, stream_type: str):
                    """Read from stream and yield lines."""
                    while True:
                        line = await stream.readline()
                        if not line:
                            break
                        decoded = line.decode('utf-8', errors='replace')
                        yield (decoded, stream_type)
                
                # Create async generators for both streams
                stdout_gen = read_stream(process.stdout, "stdout")
                stderr_gen = read_stream(process.stderr, "stderr")
                
                # Merge streams and yield output
                pending = {
                    asyncio.create_task(stdout_gen.__anext__()): "stdout",
                    asyncio.create_task(stderr_gen.__anext__()): "stderr"
                }
                
                while pending:
                    done, pending_set = await asyncio.wait(
                        pending.keys(),
                        return_when=asyncio.FIRST_COMPLETED,
                        timeout=timeout
                    )
                    
                    for task in done:
                        stream_type = pending.pop(task)
                        
                        try:
                            content, actual_type = task.result()
                            yield (content, actual_type)
                            
                            # Create new task for this stream
                            if stream_type == "stdout":
                                new_task = asyncio.create_task(stdout_gen.__anext__())
                            else:
                                new_task = asyncio.create_task(stderr_gen.__anext__())
                            pending[new_task] = stream_type
                            
                        except StopAsyncIteration:
                            # Stream ended
                            pass
                
                # Wait for process to complete
                await asyncio.wait_for(process.wait(), timeout=timeout)
                
            finally:
                self._active_processes.pop(process.pid, None)
                
        except asyncio.TimeoutError:
            logger.warning(f"Streaming command timed out: {command}")
            yield (f"\n[Command timed out after {timeout}s]", "stderr")
        
        except Exception as e:
            logger.error(f"Streaming command error: {e}")
            yield (f"\n[Error: {str(e)}]", "stderr")
    
    async def kill_process(self, pid: int) -> bool:
        """
        Kill an active process (legacy method, use kill_process_with_recovery for new code).
        
        Args:
            pid: Process ID to kill
        
        Returns:
            True if process was killed, False if not found
        """
        return await self.kill_process_with_recovery(pid)
    
    def get_active_process_count(self) -> int:
        """
        Get count of active processes.
        
        Returns:
            Number of active processes
        """
        return len(self._active_processes)
    
    async def list_directory(self, path: str = ".") -> list[dict[str, str]]:
        """
        List files and directories at path.
        
        Args:
            path: Directory path to list (relative to current directory)
        
        Returns:
            List of file/directory information dictionaries
        
        Raises:
            SecurityViolation: If path is outside workspace
        """
        # Validate path
        if path == ".":
            target_path = self._current_directory
        else:
            target_path = self.security.validate_path(path)
        
        if not target_path.exists():
            raise FileNotFoundError(f"Path not found: {path}")
        
        if not target_path.is_dir():
            raise NotADirectoryError(f"Not a directory: {path}")
        
        entries = []
        
        for entry in sorted(target_path.iterdir()):
            try:
                stat = entry.stat()
                entries.append({
                    "name": entry.name,
                    "type": "directory" if entry.is_dir() else "file",
                    "size": stat.st_size if entry.is_file() else 0,
                    "modified": stat.st_mtime
                })
            except (OSError, PermissionError) as e:
                logger.warning(f"Error accessing {entry}: {e}")
                continue
        
        return entries


# Global singleton instance
_terminal_controller: TerminalController | None = None


def get_terminal_controller() -> TerminalController:
    """
    Get the global TerminalController instance.
    
    Returns:
        TerminalController singleton
    """
    global _terminal_controller
    if _terminal_controller is None:
        _terminal_controller = TerminalController()
    return _terminal_controller
