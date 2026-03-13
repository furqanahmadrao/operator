"""
Error Recovery Service

Provides retry logic with exponential backoff, error classification,
and recovery strategies for tool invocations and system operations.

Requirements: 21
"""

import asyncio
import logging
import time
from dataclasses import dataclass
from enum import Enum
from typing import Any, Callable, Optional, TypeVar, Union
from uuid import uuid4

from .activity_stream import get_activity_stream, ActivityEventType

logger = logging.getLogger(__name__)

T = TypeVar('T')


class ErrorType(str, Enum):
    """Classification of error types for recovery strategies."""
    
    # Retryable errors
    NETWORK_TIMEOUT = "network_timeout"
    CONNECTION_REFUSED = "connection_refused"
    TEMPORARY_FAILURE = "temporary_failure"
    RATE_LIMITED = "rate_limited"
    DATABASE_LOCKED = "database_locked"
    BROWSER_CRASH = "browser_crash"
    COMMAND_TIMEOUT = "command_timeout"
    
    # Non-retryable errors
    AUTHENTICATION_FAILED = "authentication_failed"
    PERMISSION_DENIED = "permission_denied"
    INVALID_INPUT = "invalid_input"
    SECURITY_VIOLATION = "security_violation"
    RESOURCE_NOT_FOUND = "resource_not_found"
    QUOTA_EXCEEDED = "quota_exceeded"
    
    # System errors
    OUT_OF_MEMORY = "out_of_memory"
    DISK_FULL = "disk_full"
    SYSTEM_FAILURE = "system_failure"


@dataclass
class RetryConfig:
    """Configuration for retry behavior."""
    
    max_attempts: int = 3
    initial_delay_seconds: float = 1.0
    max_delay_seconds: float = 60.0
    exponential_base: float = 2.0
    jitter: bool = True
    retryable_errors: set[ErrorType] = None
    
    def __post_init__(self):
        if self.retryable_errors is None:
            self.retryable_errors = {
                ErrorType.NETWORK_TIMEOUT,
                ErrorType.CONNECTION_REFUSED,
                ErrorType.TEMPORARY_FAILURE,
                ErrorType.RATE_LIMITED,
                ErrorType.DATABASE_LOCKED,
                ErrorType.BROWSER_CRASH,
                ErrorType.COMMAND_TIMEOUT,
            }


@dataclass
class RetryAttempt:
    """Information about a retry attempt."""
    
    attempt_number: int
    delay_seconds: float
    error: Exception
    timestamp: str
    
    @classmethod
    def create(cls, attempt_number: int, delay_seconds: float, error: Exception) -> 'RetryAttempt':
        """Create retry attempt with current timestamp."""
        from datetime import datetime, timezone
        return cls(
            attempt_number=attempt_number,
            delay_seconds=delay_seconds,
            error=error,
            timestamp=datetime.now(timezone.utc).isoformat()
        )


@dataclass
class RetryResult:
    """Result of a retry operation."""
    
    success: bool
    result: Any = None
    error: Optional[Exception] = None
    attempts: list[RetryAttempt] = None
    total_duration_ms: int = 0
    
    def __post_init__(self):
        if self.attempts is None:
            self.attempts = []


class RecoverableError(Exception):
    """Base class for errors that can be retried."""
    
    def __init__(self, message: str, error_type: ErrorType, original_error: Optional[Exception] = None):
        super().__init__(message)
        self.error_type = error_type
        self.original_error = original_error


class NonRecoverableError(Exception):
    """Base class for errors that should not be retried."""
    
    def __init__(self, message: str, error_type: ErrorType, original_error: Optional[Exception] = None):
        super().__init__(message)
        self.error_type = error_type
        self.original_error = original_error


class ErrorRecoveryService:
    """
    Service for handling error recovery with exponential backoff retry logic.
    
    Features:
    - Configurable retry policies per operation type
    - Exponential backoff with jitter
    - Error classification and recovery strategies
    - Activity stream integration for error events
    - Circuit breaker pattern for repeated failures
    """
    
    def __init__(self):
        self.default_config = RetryConfig()
        self._operation_configs: dict[str, RetryConfig] = {}
        self._circuit_breakers: dict[str, dict] = {}
    
    def configure_operation(self, operation_name: str, config: RetryConfig) -> None:
        """
        Configure retry behavior for a specific operation.
        
        Args:
            operation_name: Name of the operation (e.g., "browser_navigate", "execute_command")
            config: Retry configuration for this operation
        """
        self._operation_configs[operation_name] = config
        logger.info(f"Configured retry policy for {operation_name}: {config}")
    
    async def retry_with_backoff(
        self,
        operation: Callable[[], Any],
        operation_name: str = "unknown",
        config: Optional[RetryConfig] = None,
        session_id: Optional[str] = None,
        correlation_id: Optional[str] = None,
    ) -> RetryResult:
        """
        Execute operation with retry logic and exponential backoff.
        
        Args:
            operation: Async callable to execute
            operation_name: Name of the operation for logging and configuration
            config: Optional retry configuration (uses default if None)
            session_id: Optional session ID for activity stream events
            correlation_id: Optional correlation ID for related events
            
        Returns:
            RetryResult with success status, result, and attempt information
        """
        # Get configuration
        retry_config = config or self._operation_configs.get(operation_name, self.default_config)
        
        # Check circuit breaker
        if self._is_circuit_open(operation_name):
            # Emit circuit breaker error event
            if session_id:
                consecutive_failures = self._circuit_breakers.get(operation_name, {}).get("consecutive_failures", 0)
                await self.emit_circuit_breaker_error(
                    session_id=session_id,
                    operation_name=operation_name,
                    consecutive_failures=consecutive_failures,
                    correlation_id=correlation_id
                )
            
            error = NonRecoverableError(
                f"Circuit breaker open for {operation_name}",
                ErrorType.SYSTEM_FAILURE
            )
            return RetryResult(success=False, error=error)
        
        start_time = time.time()
        attempts = []
        correlation_id = correlation_id or str(uuid4())
        
        logger.info(f"Starting retry operation: {operation_name} (max_attempts={retry_config.max_attempts})")
        
        for attempt in range(retry_config.max_attempts):
            try:
                # Execute operation
                if asyncio.iscoroutinefunction(operation):
                    result = await operation()
                else:
                    result = operation()
                
                # Success - reset circuit breaker
                self._reset_circuit_breaker(operation_name)
                
                duration_ms = int((time.time() - start_time) * 1000)
                
                logger.info(
                    f"Operation {operation_name} succeeded on attempt {attempt + 1} "
                    f"after {duration_ms}ms"
                )
                
                return RetryResult(
                    success=True,
                    result=result,
                    attempts=attempts,
                    total_duration_ms=duration_ms
                )
                
            except Exception as error:
                # Classify error
                error_type = self._classify_error(error)
                is_retryable = error_type in retry_config.retryable_errors
                
                # Calculate delay for next attempt
                delay_seconds = self._calculate_delay(
                    attempt, 
                    retry_config.initial_delay_seconds,
                    retry_config.max_delay_seconds,
                    retry_config.exponential_base,
                    retry_config.jitter
                )
                
                # Record attempt
                retry_attempt = RetryAttempt.create(attempt + 1, delay_seconds, error)
                attempts.append(retry_attempt)
                
                logger.warning(
                    f"Operation {operation_name} failed on attempt {attempt + 1}: "
                    f"{error} (retryable={is_retryable})"
                )
                
                # Emit error event
                if session_id:
                    await self._emit_error_event(
                        session_id=session_id,
                        operation_name=operation_name,
                        error=error,
                        error_type=error_type,
                        attempt_number=attempt + 1,
                        is_retryable=is_retryable,
                        correlation_id=correlation_id
                    )
                
                # Check if we should retry
                if not is_retryable or attempt == retry_config.max_attempts - 1:
                    # Final failure
                    duration_ms = int((time.time() - start_time) * 1000)
                    
                    # Update circuit breaker
                    self._record_failure(operation_name)
                    
                    logger.error(
                        f"Operation {operation_name} failed permanently after "
                        f"{attempt + 1} attempts in {duration_ms}ms"
                    )
                    
                    # Emit final error event
                    if session_id:
                        await self._emit_final_error_event(
                            session_id=session_id,
                            operation_name=operation_name,
                            error=error,
                            error_type=error_type,
                            total_attempts=attempt + 1,
                            correlation_id=correlation_id
                        )
                    
                    return RetryResult(
                        success=False,
                        error=error,
                        attempts=attempts,
                        total_duration_ms=duration_ms
                    )
                
                # Wait before retry
                if delay_seconds > 0:
                    logger.info(f"Waiting {delay_seconds:.2f}s before retry {attempt + 2}")
                    await asyncio.sleep(delay_seconds)
        
        # Should not reach here
        duration_ms = int((time.time() - start_time) * 1000)
        return RetryResult(
            success=False,
            error=Exception("Unexpected end of retry loop"),
            attempts=attempts,
            total_duration_ms=duration_ms
        )
    
    def _classify_error(self, error: Exception) -> ErrorType:
        """
        Classify error type for retry decision.
        
        Args:
            error: Exception to classify
            
        Returns:
            ErrorType classification
        """
        # Check if error is already classified
        if isinstance(error, (RecoverableError, NonRecoverableError)):
            return error.error_type
        
        error_str = str(error).lower()
        error_type_name = type(error).__name__.lower()
        
        # Network and connection errors
        if any(term in error_str for term in ["timeout", "timed out"]):
            return ErrorType.NETWORK_TIMEOUT
        
        if any(term in error_str for term in ["connection refused", "connection failed"]):
            return ErrorType.CONNECTION_REFUSED
        
        if "rate limit" in error_str or "too many requests" in error_str:
            return ErrorType.RATE_LIMITED
        
        # Database errors
        if "database is locked" in error_str or "sqlite" in error_str:
            return ErrorType.DATABASE_LOCKED
        
        # Browser errors
        if any(term in error_str for term in ["browser", "playwright", "chromium"]):
            return ErrorType.BROWSER_CRASH
        
        # Security errors
        if any(term in error_str for term in ["permission denied", "access denied", "forbidden"]):
            return ErrorType.PERMISSION_DENIED
        
        if "security violation" in error_str:
            return ErrorType.SECURITY_VIOLATION
        
        # Authentication errors
        if any(term in error_str for term in ["unauthorized", "authentication", "invalid token"]):
            return ErrorType.AUTHENTICATION_FAILED
        
        # Resource errors
        if any(term in error_str for term in ["not found", "does not exist"]):
            return ErrorType.RESOURCE_NOT_FOUND
        
        if any(term in error_str for term in ["quota", "limit exceeded"]):
            return ErrorType.QUOTA_EXCEEDED
        
        # System errors
        if any(term in error_str for term in ["out of memory", "memory error"]):
            return ErrorType.OUT_OF_MEMORY
        
        if any(term in error_str for term in ["disk full", "no space"]):
            return ErrorType.DISK_FULL
        
        # Default to temporary failure for unknown errors
        return ErrorType.TEMPORARY_FAILURE
    
    def _calculate_delay(
        self,
        attempt: int,
        initial_delay: float,
        max_delay: float,
        exponential_base: float,
        jitter: bool
    ) -> float:
        """
        Calculate delay for next retry attempt using exponential backoff.
        
        Args:
            attempt: Current attempt number (0-based)
            initial_delay: Initial delay in seconds
            max_delay: Maximum delay in seconds
            exponential_base: Base for exponential calculation
            jitter: Whether to add random jitter
            
        Returns:
            Delay in seconds for next attempt
        """
        # Calculate exponential delay
        delay = initial_delay * (exponential_base ** attempt)
        
        # Cap at maximum delay
        delay = min(delay, max_delay)
        
        # Add jitter to avoid thundering herd
        if jitter:
            import random
            jitter_factor = random.uniform(0.5, 1.5)
            delay *= jitter_factor
        
        return delay
    
    def _is_circuit_open(self, operation_name: str) -> bool:
        """Check if circuit breaker is open for an operation."""
        if operation_name not in self._circuit_breakers:
            return False
        
        breaker = self._circuit_breakers[operation_name]
        
        # Simple circuit breaker: open for 60 seconds after 5 consecutive failures
        if breaker.get("consecutive_failures", 0) >= 5:
            last_failure = breaker.get("last_failure_time", 0)
            if time.time() - last_failure < 60:  # 60 second timeout
                return True
        
        return False
    
    def _record_failure(self, operation_name: str) -> None:
        """Record a failure for circuit breaker tracking."""
        if operation_name not in self._circuit_breakers:
            self._circuit_breakers[operation_name] = {
                "consecutive_failures": 0,
                "last_failure_time": 0
            }
        
        breaker = self._circuit_breakers[operation_name]
        breaker["consecutive_failures"] += 1
        breaker["last_failure_time"] = time.time()
    
    def _reset_circuit_breaker(self, operation_name: str) -> None:
        """Reset circuit breaker after successful operation."""
        if operation_name in self._circuit_breakers:
            self._circuit_breakers[operation_name]["consecutive_failures"] = 0
    
    async def _emit_error_event(
        self,
        session_id: str,
        operation_name: str,
        error: Exception,
        error_type: ErrorType,
        attempt_number: int,
        is_retryable: bool,
        correlation_id: str
    ) -> None:
        """Emit error event to activity stream."""
        activity_stream = get_activity_stream()
        
        await activity_stream.emit_error(
            session_id=session_id,
            error_type=f"{operation_name}_{error_type.value}",
            message=f"Attempt {attempt_number} failed: {str(error)}",
            details={
                "operation_name": operation_name,
                "error_type": error_type.value,
                "attempt_number": attempt_number,
                "is_retryable": is_retryable,
                "error_class": type(error).__name__,
                "failure_reason": self._get_failure_reason(error_type),
                "original_error": str(error),
                "recovery_attempted": True
            },
            recoverable=is_retryable,
            retry_count=attempt_number - 1,
            correlation_id=correlation_id
        )
    
    async def _emit_final_error_event(
        self,
        session_id: str,
        operation_name: str,
        error: Exception,
        error_type: ErrorType,
        total_attempts: int,
        correlation_id: str
    ) -> None:
        """Emit final error event after all retries exhausted."""
        activity_stream = get_activity_stream()
        
        await activity_stream.emit_error(
            session_id=session_id,
            error_type=f"{operation_name}_final_failure",
            message=f"Operation failed permanently after {total_attempts} attempts: {str(error)}",
            details={
                "operation_name": operation_name,
                "error_type": error_type.value,
                "total_attempts": total_attempts,
                "error_class": type(error).__name__,
                "is_unrecoverable": True,
                "failure_reason": self._get_failure_reason(error_type),
                "original_error": str(error),
                "recovery_attempted": True
            },
            recoverable=False,
            retry_count=total_attempts,
            correlation_id=correlation_id
        )
    
    async def emit_unrecoverable_error(
        self,
        session_id: str,
        operation_name: str,
        error: Exception,
        error_type: ErrorType,
        context: dict[str, Any] = None,
        correlation_id: Optional[str] = None
    ) -> None:
        """
        Emit error event for unrecoverable failures that bypass retry logic.
        
        Args:
            session_id: Session identifier
            operation_name: Name of the failed operation
            error: The exception that occurred
            error_type: Classification of the error
            context: Additional context about the failure
            correlation_id: Optional correlation ID for related events
        """
        if correlation_id is None:
            correlation_id = str(uuid4())
        
        activity_stream = get_activity_stream()
        
        # Determine if this is a security or system critical error
        is_critical = error_type in {
            ErrorType.SECURITY_VIOLATION,
            ErrorType.AUTHENTICATION_FAILED,
            ErrorType.PERMISSION_DENIED,
            ErrorType.OUT_OF_MEMORY,
            ErrorType.DISK_FULL,
            ErrorType.SYSTEM_FAILURE
        }
        
        await activity_stream.emit_error(
            session_id=session_id,
            error_type=f"{operation_name}_unrecoverable",
            message=f"Unrecoverable failure in {operation_name}: {str(error)}",
            details={
                "operation_name": operation_name,
                "error_type": error_type.value,
                "error_class": type(error).__name__,
                "is_unrecoverable": True,
                "is_critical": is_critical,
                "failure_reason": self._get_failure_reason(error_type),
                "original_error": str(error),
                "context": context or {},
                "recovery_attempted": False
            },
            recoverable=False,
            retry_count=0,
            correlation_id=correlation_id
        )
        
        logger.error(
            f"Unrecoverable error in {operation_name}: {error} "
            f"(type={error_type.value}, critical={is_critical})"
        )
    
    async def emit_circuit_breaker_error(
        self,
        session_id: str,
        operation_name: str,
        consecutive_failures: int,
        correlation_id: Optional[str] = None
    ) -> None:
        """
        Emit error event when circuit breaker prevents operation execution.
        
        Args:
            session_id: Session identifier
            operation_name: Name of the blocked operation
            consecutive_failures: Number of consecutive failures that triggered the circuit breaker
            correlation_id: Optional correlation ID for related events
        """
        if correlation_id is None:
            correlation_id = str(uuid4())
        
        activity_stream = get_activity_stream()
        
        await activity_stream.emit_error(
            session_id=session_id,
            error_type=f"{operation_name}_circuit_breaker",
            message=f"Circuit breaker open for {operation_name} after {consecutive_failures} consecutive failures",
            details={
                "operation_name": operation_name,
                "error_type": "circuit_breaker_open",
                "consecutive_failures": consecutive_failures,
                "is_unrecoverable": True,
                "failure_reason": "Circuit breaker protection activated due to repeated failures",
                "recovery_attempted": False
            },
            recoverable=False,
            retry_count=0,
            correlation_id=correlation_id
        )
        
        logger.warning(
            f"Circuit breaker open for {operation_name} "
            f"(consecutive_failures={consecutive_failures})"
        )
    
    def _get_failure_reason(self, error_type: ErrorType) -> str:
        """
        Get human-readable failure reason for error type.
        
        Args:
            error_type: The error type classification
            
        Returns:
            Human-readable description of why the error is unrecoverable
        """
        failure_reasons = {
            ErrorType.AUTHENTICATION_FAILED: "Authentication credentials are invalid or expired",
            ErrorType.PERMISSION_DENIED: "Insufficient permissions to perform the operation",
            ErrorType.INVALID_INPUT: "Input parameters are malformed or invalid",
            ErrorType.SECURITY_VIOLATION: "Operation violates security policies",
            ErrorType.RESOURCE_NOT_FOUND: "Required resource does not exist",
            ErrorType.QUOTA_EXCEEDED: "Resource quota or rate limit exceeded",
            ErrorType.OUT_OF_MEMORY: "System has insufficient memory to complete operation",
            ErrorType.DISK_FULL: "Insufficient disk space available",
            ErrorType.SYSTEM_FAILURE: "Critical system component failure",
            ErrorType.NETWORK_TIMEOUT: "Network operation timed out",
            ErrorType.CONNECTION_REFUSED: "Connection to remote service was refused",
            ErrorType.TEMPORARY_FAILURE: "Temporary service or resource failure",
            ErrorType.RATE_LIMITED: "Request rate limit exceeded",
            ErrorType.DATABASE_LOCKED: "Database is locked by another process",
            ErrorType.BROWSER_CRASH: "Browser process crashed or became unresponsive",
            ErrorType.COMMAND_TIMEOUT: "Command execution exceeded timeout limit"
        }
        
        return failure_reasons.get(error_type, "Unknown error condition")


# Global error recovery service instance
_error_recovery_service: Optional[ErrorRecoveryService] = None


def get_error_recovery_service() -> ErrorRecoveryService:
    """Get or create global error recovery service instance."""
    global _error_recovery_service
    if _error_recovery_service is None:
        _error_recovery_service = ErrorRecoveryService()
    return _error_recovery_service


async def emit_unrecoverable_error(
    session_id: str,
    operation_name: str,
    error: Exception,
    error_type: Optional[ErrorType] = None,
    context: Optional[dict[str, Any]] = None,
    correlation_id: Optional[str] = None
) -> None:
    """
    Convenience function to emit unrecoverable error events.
    
    Args:
        session_id: Session identifier
        operation_name: Name of the failed operation
        error: The exception that occurred
        error_type: Optional error type classification (auto-detected if None)
        context: Additional context about the failure
        correlation_id: Optional correlation ID for related events
    """
    recovery_service = get_error_recovery_service()
    
    # Auto-classify error if not provided
    if error_type is None:
        error_type = recovery_service._classify_error(error)
    
    await recovery_service.emit_unrecoverable_error(
        session_id=session_id,
        operation_name=operation_name,
        error=error,
        error_type=error_type,
        context=context,
        correlation_id=correlation_id
    )


# Convenience decorator for adding retry logic to functions
def retry_on_failure(
    operation_name: str = None,
    config: RetryConfig = None,
    session_id_param: str = None,
    correlation_id_param: str = None
):
    """
    Decorator to add retry logic to async functions.
    
    Args:
        operation_name: Name of the operation (defaults to function name)
        config: Retry configuration (uses default if None)
        session_id_param: Name of parameter containing session_id
        correlation_id_param: Name of parameter containing correlation_id
    """
    def decorator(func: Callable) -> Callable:
        async def wrapper(*args, **kwargs):
            nonlocal operation_name
            if operation_name is None:
                operation_name = func.__name__
            
            # Extract session_id and correlation_id from parameters
            session_id = None
            correlation_id = None
            
            if session_id_param and session_id_param in kwargs:
                session_id = kwargs[session_id_param]
            
            if correlation_id_param and correlation_id_param in kwargs:
                correlation_id = kwargs[correlation_id_param]
            
            # Create operation callable
            async def operation():
                return await func(*args, **kwargs)
            
            # Execute with retry logic
            recovery_service = get_error_recovery_service()
            result = await recovery_service.retry_with_backoff(
                operation=operation,
                operation_name=operation_name,
                config=config,
                session_id=session_id,
                correlation_id=correlation_id
            )
            
            if result.success:
                return result.result
            else:
                raise result.error
        
        return wrapper
    return decorator