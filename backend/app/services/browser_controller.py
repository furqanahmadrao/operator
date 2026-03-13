"""
Browser Controller Service

Provides browser automation capabilities using Browser Use library.
Manages browser lifecycle, named sessions with state persistence,
and browser operations with AI-optimized natural language task execution.
"""

import asyncio
import json
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

from .activity_stream import get_activity_stream, ActivityEventType
from .error_recovery import get_error_recovery_service, RecoverableError, ErrorType

try:
    from browser_use import Agent as BrowserAgent, Browser, BrowserConfig
    from browser_use.browser.context import BrowserContext
    BROWSER_USE_AVAILABLE = True
except ImportError:
    BROWSER_USE_AVAILABLE = False
    BrowserAgent = None
    Browser = None
    BrowserConfig = None
    BrowserContext = None

from playwright.async_api import (
    Browser as PlaywrightBrowser,
    BrowserContext as PlaywrightContext,
    Page,
    Playwright,
    async_playwright,
    Error as PlaywrightError,
    TimeoutError as PlaywrightTimeoutError,
)

from .security import SecurityBoundary

logger = logging.getLogger(__name__)


class BrowserSession:
    """Represents a named browser session with persistent state."""
    
    def __init__(
        self,
        session_name: str,
        context: Any,  # BrowserContext or PlaywrightContext
        page: Page,
        state_path: Path,
        use_browser_use: bool = False,
    ):
        self.session_name = session_name
        self.context = context
        self.page = page
        self.state_path = state_path
        self.use_browser_use = use_browser_use
        self.last_activity = datetime.now()
        self.created_at = datetime.now()
    
    def update_activity(self) -> None:
        """Update last activity timestamp."""
        self.last_activity = datetime.now()
    
    def is_idle(self, timeout_minutes: int = 10) -> bool:
        """Check if session has been idle for longer than timeout."""
        idle_duration = datetime.now() - self.last_activity
        return idle_duration > timedelta(minutes=timeout_minutes)
    
    async def save_state(self) -> None:
        """Save browser context state to disk."""
        try:
            if hasattr(self.context, 'storage_state'):
                await self.context.storage_state(path=str(self.state_path / "state.json"))
                logger.info(f"Saved state for session: {self.session_name}")
        except Exception as e:
            logger.error(f"Failed to save state for session {self.session_name}: {e}")
    
    async def close(self) -> None:
        """Close browser context and save state."""
        try:
            await self.save_state()
            await self.context.close()
            logger.info(f"Closed session: {self.session_name}")
        except Exception as e:
            logger.error(f"Error closing session {self.session_name}: {e}")


class NavigationResult:
    """Result of a navigation operation."""
    
    def __init__(self, success: bool, url: str, error: Optional[str] = None):
        self.success = success
        self.url = url
        self.error = error
        self.timestamp = datetime.now().isoformat()


class ClickResult:
    """Result of a click operation."""
    
    def __init__(self, success: bool, selector: str, error: Optional[str] = None):
        self.success = success
        self.selector = selector
        self.error = error


class PageContent:
    """Extracted page content."""
    
    def __init__(self, text: str, html: str, title: str, url: str):
        self.text = text
        self.html = html
        self.title = title
        self.url = url


class TaskResult:
    """Result of a Browser Use task execution."""
    
    def __init__(
        self,
        success: bool,
        result: Any,
        screenshot_path: Optional[str] = None,
        error: Optional[str] = None
    ):
        self.success = success
        self.result = result
        self.screenshot_path = screenshot_path
        self.error = error
        self.timestamp = datetime.now().isoformat()


class BrowserController:
    """
    Manages browser automation using Browser Use library with Playwright fallback.
    
    Provides:
    - AI-optimized browser automation with natural language tasks
    - Browser lifecycle management (launch, close)
    - Named session management with state persistence
    - Navigation with timeout and retry
    - Element interaction (click, fill form)
    - Content extraction
    - Screenshot capture
    - JavaScript execution
    - Session cleanup and idle timeout
    """
    
    def __init__(
        self,
        workspace_root: str = "/workspace",
        max_sessions: int = 5,
        idle_timeout_minutes: int = 10,
        default_timeout_seconds: int = 30,
        use_browser_use: bool = True,
        llm = None,
    ):
        self.workspace_root = Path(workspace_root)
        self.sessions_dir = self.workspace_root / ".browser_sessions"
        self.screenshots_dir = self.workspace_root / ".screenshots"
        self.max_sessions = max_sessions
        self.idle_timeout_minutes = idle_timeout_minutes
        self.default_timeout_seconds = default_timeout_seconds * 1000  # Convert to ms
        self.use_browser_use = use_browser_use and BROWSER_USE_AVAILABLE
        self.llm = llm
        
        self.security = SecurityBoundary(workspace_root)
        self.playwright: Optional[Playwright] = None
        self.browser: Optional[PlaywrightBrowser] = None
        self.browser_use_browser: Optional[Browser] = None
        self.sessions: Dict[str, BrowserSession] = {}
        
        # Ensure directories exist
        self.sessions_dir.mkdir(parents=True, exist_ok=True)
        self.screenshots_dir.mkdir(parents=True, exist_ok=True)
        
        if self.use_browser_use and not BROWSER_USE_AVAILABLE:
            logger.warning("Browser Use library not available, falling back to Playwright")
            self.use_browser_use = False
    
    async def _ensure_browser(self) -> None:
        """Ensure browser is launched with crash recovery."""
        if self.use_browser_use:
            if self.browser_use_browser is None or not await self._is_browser_use_healthy():
                logger.info("Launching Browser Use browser...")
                try:
                    config = BrowserConfig(
                        headless=True,
                        disable_security=False,
                    )
                    self.browser_use_browser = Browser(config=config)
                    logger.info("Browser Use browser launched successfully")
                except Exception as e:
                    logger.error(f"Failed to launch Browser Use browser: {e}")
                    raise RecoverableError(
                        f"Browser Use launch failed: {e}",
                        ErrorType.BROWSER_CRASH,
                        e
                    )
        else:
            if self.browser is None or not self.browser.is_connected():
                logger.info("Launching Playwright browser...")
                try:
                    self.playwright = await async_playwright().start()
                    self.browser = await self.playwright.chromium.launch(
                        headless=True,
                        args=[
                            "--no-sandbox",
                            "--disable-setuid-sandbox",
                            "--disable-dev-shm-usage",
                        ]
                    )
                    logger.info("Playwright browser launched successfully")
                except Exception as e:
                    logger.error(f"Failed to launch Playwright browser: {e}")
                    raise RecoverableError(
                        f"Playwright browser launch failed: {e}",
                        ErrorType.BROWSER_CRASH,
                        e
                    )
    
    async def _is_browser_use_healthy(self) -> bool:
        """Check if Browser Use browser is healthy."""
        if not self.browser_use_browser:
            return False
        
        try:
            # Try to create a test context to verify browser is working
            test_context = await self.browser_use_browser.new_context()
            await test_context.close()
            return True
        except Exception as e:
            logger.warning(f"Browser Use health check failed: {e}")
            return False
    
    async def _recover_browser_session(self, session: BrowserSession) -> BrowserSession:
        """
        Recover a browser session after a crash.
        
        Args:
            session: The crashed session to recover
            
        Returns:
            New recovered session with restored state
        """
        logger.info(f"Recovering browser session: {session.session_name}")
        
        try:
            # Save current state if possible
            try:
                await session.save_state()
            except Exception as e:
                logger.warning(f"Could not save state before recovery: {e}")
            
            # Close crashed session
            try:
                await session.close()
            except Exception as e:
                logger.warning(f"Error closing crashed session: {e}")
            
            # Remove from sessions dict
            if session.session_name in self.sessions:
                del self.sessions[session.session_name]
            
            # Ensure browser is healthy
            await self._ensure_browser()
            
            # Create new session with same name (will restore state)
            recovered_session = await self.create_session(session.session_name)
            
            logger.info(f"Successfully recovered browser session: {session.session_name}")
            return recovered_session
            
        except Exception as e:
            logger.error(f"Failed to recover browser session {session.session_name}: {e}")
            raise RecoverableError(
                f"Browser session recovery failed: {e}",
                ErrorType.BROWSER_CRASH,
                e
            )
    
    async def create_session(self, session_name: str) -> BrowserSession:
        """
        Create or restore a named browser session.
        
        Args:
            session_name: Unique name for the session
            
        Returns:
            BrowserSession instance
            
        Raises:
            ValueError: If max sessions limit reached
        """
        # Check if session already exists
        if session_name in self.sessions:
            session = self.sessions[session_name]
            session.update_activity()
            logger.info(f"Reusing existing session: {session_name}")
            return session
        
        # Check session limit
        if len(self.sessions) >= self.max_sessions:
            # Try to cleanup idle sessions
            await self.cleanup_idle_sessions()
            
            if len(self.sessions) >= self.max_sessions:
                raise ValueError(
                    f"Maximum browser sessions ({self.max_sessions}) reached. "
                    "Close existing sessions or wait for idle timeout."
                )
        
        await self._ensure_browser()
        
        # Create session state directory
        state_path = self.sessions_dir / session_name
        state_path.mkdir(parents=True, exist_ok=True)
        
        # Check if saved state exists
        state_file = state_path / "state.json"
        storage_state = None
        if state_file.exists():
            try:
                storage_state = str(state_file)
                logger.info(f"Restoring state for session: {session_name}")
            except Exception as e:
                logger.warning(f"Failed to load state for {session_name}: {e}")
        
        if self.use_browser_use:
            # Create Browser Use context
            context = await self.browser_use_browser.new_context(
                storage_state=storage_state,
            )
            page = await context.new_page()
        else:
            # Create Playwright context
            context = await self.browser.new_context(
                storage_state=storage_state,
                viewport={"width": 1920, "height": 1080},
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            )
            context.set_default_timeout(self.default_timeout_seconds)
            page = await context.new_page()
        
        # Create session object
        session = BrowserSession(
            session_name,
            context,
            page,
            state_path,
            use_browser_use=self.use_browser_use
        )
        self.sessions[session_name] = session
        
        logger.info(f"Created new session: {session_name} (Browser Use: {self.use_browser_use})")
        return session
    
    async def execute_task(
        self,
        task: str,
        session_name: str = "default",
        llm = None,
        session_id: Optional[str] = None,
    ) -> TaskResult:
        """
        Execute a browser task using natural language (Browser Use).
        
        Args:
            task: Natural language description of the task
            session_name: Name of the browser session
            llm: Language model for Browser Use agent (optional)
            session_id: Optional session ID for activity stream events
            
        Returns:
            TaskResult with success status, result, and screenshot path
        """
        if not self.use_browser_use:
            return TaskResult(
                success=False,
                result=None,
                error="Browser Use not available. Use navigate/click methods instead."
            )
        
        try:
            session = await self.create_session(session_name)
            session.update_activity()
            
            # Use provided LLM or fallback to instance LLM
            agent_llm = llm or self.llm
            if agent_llm is None:
                return TaskResult(
                    success=False,
                    result=None,
                    error="No LLM provided for Browser Use agent"
                )
            
            logger.info(f"Executing Browser Use task: {task}")
            
            # Create Browser Use agent
            agent = BrowserAgent(
                task=task,
                llm=agent_llm,
                browser=self.browser_use_browser,
            )
            
            # Execute task
            result = await agent.run()
            
            # Capture screenshot
            screenshot_path = await self._capture_screenshot_internal(session, session_id)
            
            logger.info(f"Browser Use task completed successfully")
            
            return TaskResult(
                success=True,
                result=result,
                screenshot_path=screenshot_path
            )
            
        except Exception as e:
            error_msg = f"Browser Use task failed: {str(e)}"
            logger.error(error_msg)
            return TaskResult(
                success=False,
                result=None,
                error=error_msg
            )
    
    async def navigate(
        self,
        session_name: str,
        url: str,
        timeout_seconds: Optional[int] = None,
        max_retries: int = 3,
        session_id: Optional[str] = None,
    ) -> NavigationResult:
        """
        Navigate to URL with timeout, retry, and crash recovery.
        
        Args:
            session_name: Name of the browser session
            url: URL to navigate to
            timeout_seconds: Navigation timeout (uses default if None)
            max_retries: Maximum retry attempts on failure
            session_id: Optional session ID for activity stream events
            
        Returns:
            NavigationResult with success status and error if any
        """
        # Use error recovery service for retry logic
        recovery_service = get_error_recovery_service()
        
        async def navigate_operation():
            session = await self.create_session(session_name)
            session.update_activity()
            
            # Get activity stream for event emission
            activity_stream = get_activity_stream()
            
            timeout_ms = (
                timeout_seconds * 1000 if timeout_seconds
                else self.default_timeout_seconds
            )
            
            # Emit navigation start event
            if session_id:
                await activity_stream.emit(
                    session_id=session_id,
                    event_type=ActivityEventType.BROWSER_NAVIGATE,
                    payload={
                        "url": url,
                        "session_name": session_name,
                        "status": "started"
                    }
                )
            
            try:
                logger.info(f"Navigating to {url}")
                await session.page.goto(url, timeout=timeout_ms, wait_until="load")
                
                # Auto-capture screenshot after navigation
                await self._capture_screenshot_internal(session, session_id)
                
                # Emit navigation success event
                if session_id:
                    await activity_stream.emit(
                        session_id=session_id,
                        event_type=ActivityEventType.BROWSER_NAVIGATE,
                        payload={
                            "url": url,
                            "session_name": session_name,
                            "status": "completed"
                        }
                    )
                
                logger.info(f"Successfully navigated to {url}")
                return NavigationResult(success=True, url=url)
                
            except PlaywrightTimeoutError as e:
                error_msg = f"Navigation timeout after {timeout_ms}ms"
                logger.warning(f"{error_msg}: {e}")
                raise RecoverableError(error_msg, ErrorType.NETWORK_TIMEOUT, e)
                
            except PlaywrightError as e:
                error_str = str(e).lower()
                
                # Check for browser crash indicators
                if any(term in error_str for term in [
                    "target closed", "browser closed", "connection closed",
                    "session closed", "context closed", "page closed"
                ]):
                    logger.error(f"Browser crash detected during navigation: {e}")
                    
                    # Attempt session recovery
                    try:
                        session = await self._recover_browser_session(session)
                        # Retry navigation with recovered session
                        await session.page.goto(url, timeout=timeout_ms, wait_until="load")
                        await self._capture_screenshot_internal(session, session_id)
                        
                        if session_id:
                            await activity_stream.emit(
                                session_id=session_id,
                                event_type=ActivityEventType.BROWSER_NAVIGATE,
                                payload={
                                    "url": url,
                                    "session_name": session_name,
                                    "status": "completed_after_recovery"
                                }
                            )
                        
                        logger.info(f"Successfully navigated to {url} after recovery")
                        return NavigationResult(success=True, url=url)
                        
                    except Exception as recovery_error:
                        logger.error(f"Recovery failed: {recovery_error}")
                        raise RecoverableError(
                            f"Browser crash during navigation, recovery failed: {recovery_error}",
                            ErrorType.BROWSER_CRASH,
                            e
                        )
                else:
                    # Other Playwright errors
                    raise RecoverableError(f"Navigation failed: {e}", ErrorType.TEMPORARY_FAILURE, e)
                
            except Exception as e:
                error_msg = f"Unexpected error during navigation: {str(e)}"
                logger.error(error_msg)
                raise RecoverableError(error_msg, ErrorType.TEMPORARY_FAILURE, e)
        
        # Execute with retry logic
        try:
            result = await recovery_service.retry_with_backoff(
                operation=navigate_operation,
                operation_name="browser_navigate",
                session_id=session_id
            )
            
            if result.success:
                return result.result
            else:
                # Emit navigation failure event
                if session_id:
                    activity_stream = get_activity_stream()
                    await activity_stream.emit(
                        session_id=session_id,
                        event_type=ActivityEventType.BROWSER_NAVIGATE,
                        payload={
                            "url": url,
                            "session_name": session_name,
                            "status": "failed",
                            "error": str(result.error)
                        }
                    )
                
                return NavigationResult(success=False, url=url, error=str(result.error))
                
        except Exception as e:
            # Final fallback
            return NavigationResult(success=False, url=url, error=str(e))
    
    async def _capture_screenshot_internal(self, session: BrowserSession, session_id: Optional[str] = None) -> str:
        """Internal method to capture screenshot."""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        filename = f"{session.session_name}_{timestamp}.png"
        screenshot_path = self.screenshots_dir / filename
        
        await session.page.screenshot(path=str(screenshot_path))
        
        # Emit screenshot event
        if session_id:
            activity_stream = get_activity_stream()
            await activity_stream.emit(
                session_id=session_id,
                event_type=ActivityEventType.BROWSER_SCREENSHOT,
                payload={
                    "screenshot_path": str(screenshot_path),
                    "session_name": session.session_name,
                    "full_page": False,
                    "auto_captured": True
                }
            )
        
        logger.info(f"Screenshot captured: {screenshot_path}")
        
        return str(screenshot_path)
    
    async def click_element(
        self,
        session_name: str,
        selector: str,
        timeout_seconds: Optional[int] = None,
        session_id: Optional[str] = None,
    ) -> ClickResult:
        """
        Click element matching CSS selector with crash recovery.
        
        Args:
            session_name: Name of the browser session
            selector: CSS selector for the element
            timeout_seconds: Click timeout (uses default if None)
            session_id: Optional session ID for activity stream events
            
        Returns:
            ClickResult with success status and error if any
        """
        recovery_service = get_error_recovery_service()
        
        async def click_operation():
            session = await self.create_session(session_name)
            session.update_activity()
            
            # Get activity stream for event emission
            activity_stream = get_activity_stream()
            
            timeout_ms = (
                timeout_seconds * 1000 if timeout_seconds
                else self.default_timeout_seconds
            )
            
            try:
                logger.info(f"Clicking element: {selector}")
                await session.page.click(selector, timeout=timeout_ms)
                
                # Auto-capture screenshot after click
                await self._capture_screenshot_internal(session, session_id)
                
                # Emit click success event
                if session_id:
                    await activity_stream.emit(
                        session_id=session_id,
                        event_type=ActivityEventType.BROWSER_CLICK,
                        payload={
                            "selector": selector,
                            "session_name": session_name,
                            "success": True
                        }
                    )
                
                logger.info(f"Successfully clicked: {selector}")
                return ClickResult(success=True, selector=selector)
                
            except PlaywrightTimeoutError as e:
                error_msg = f"Element not found or not clickable: {selector}"
                logger.warning(f"{error_msg}: {e}")
                raise RecoverableError(error_msg, ErrorType.NETWORK_TIMEOUT, e)
                
            except PlaywrightError as e:
                error_str = str(e).lower()
                
                # Check for browser crash indicators
                if any(term in error_str for term in [
                    "target closed", "browser closed", "connection closed",
                    "session closed", "context closed", "page closed"
                ]):
                    logger.error(f"Browser crash detected during click: {e}")
                    
                    # Attempt session recovery
                    try:
                        session = await self._recover_browser_session(session)
                        # Retry click with recovered session
                        await session.page.click(selector, timeout=timeout_ms)
                        await self._capture_screenshot_internal(session, session_id)
                        
                        if session_id:
                            await activity_stream.emit(
                                session_id=session_id,
                                event_type=ActivityEventType.BROWSER_CLICK,
                                payload={
                                    "selector": selector,
                                    "session_name": session_name,
                                    "success": True,
                                    "recovered": True
                                }
                            )
                        
                        logger.info(f"Successfully clicked {selector} after recovery")
                        return ClickResult(success=True, selector=selector)
                        
                    except Exception as recovery_error:
                        logger.error(f"Recovery failed: {recovery_error}")
                        raise RecoverableError(
                            f"Browser crash during click, recovery failed: {recovery_error}",
                            ErrorType.BROWSER_CRASH,
                            e
                        )
                else:
                    # Other Playwright errors
                    raise RecoverableError(f"Click failed: {e}", ErrorType.TEMPORARY_FAILURE, e)
                
            except Exception as e:
                error_msg = f"Unexpected error during click: {str(e)}"
                logger.error(error_msg)
                raise RecoverableError(error_msg, ErrorType.TEMPORARY_FAILURE, e)
        
        # Execute with retry logic
        try:
            result = await recovery_service.retry_with_backoff(
                operation=click_operation,
                operation_name="browser_click",
                session_id=session_id
            )
            
            if result.success:
                return result.result
            else:
                # Emit click failure event
                if session_id:
                    activity_stream = get_activity_stream()
                    await activity_stream.emit(
                        session_id=session_id,
                        event_type=ActivityEventType.BROWSER_CLICK,
                        payload={
                            "selector": selector,
                            "session_name": session_name,
                            "success": False,
                            "error": str(result.error)
                        }
                    )
                
                return ClickResult(success=False, selector=selector, error=str(result.error))
                
        except Exception as e:
            # Final fallback
            return ClickResult(success=False, selector=selector, error=str(e))
    
    async def fill_form_field(
        self,
        session_name: str,
        selector: str,
        value: str,
        timeout_seconds: Optional[int] = None,
    ) -> ClickResult:
        """
        Fill form input field with value.
        
        Args:
            session_name: Name of the browser session
            selector: CSS selector for the input field
            value: Value to fill
            timeout_seconds: Fill timeout (uses default if None)
            
        Returns:
            ClickResult with success status and error if any
        """
        try:
            session = await self.create_session(session_name)
            session.update_activity()
            
            timeout_ms = (
                timeout_seconds * 1000 if timeout_seconds
                else self.default_timeout_seconds
            )
            
            logger.info(f"Filling form field: {selector}")
            await session.page.fill(selector, value, timeout=timeout_ms)
            logger.info(f"Successfully filled: {selector}")
            
            return ClickResult(success=True, selector=selector)
            
        except PlaywrightTimeoutError as e:
            error_msg = f"Form field not found: {selector}"
            logger.warning(f"{error_msg}: {e}")
            return ClickResult(success=False, selector=selector, error=error_msg)
            
        except PlaywrightError as e:
            error_msg = f"Fill failed: {str(e)}"
            logger.error(error_msg)
            return ClickResult(success=False, selector=selector, error=error_msg)
            
        except Exception as e:
            error_msg = f"Unexpected error during fill: {str(e)}"
            logger.error(error_msg)
            return ClickResult(success=False, selector=selector, error=error_msg)
    
    async def extract_content(self, session_name: str) -> PageContent:
        """
        Extract content from current page.
        
        Args:
            session_name: Name of the browser session
            
        Returns:
            PageContent with text, HTML, title, and URL
        """
        session = await self.create_session(session_name)
        session.update_activity()
        
        logger.info("Extracting page content")
        
        # Extract text content
        text = await session.page.evaluate("() => document.body.innerText")
        
        # Extract HTML
        html = await session.page.content()
        
        # Get title
        title = await session.page.title()
        
        # Get URL
        url = session.page.url
        
        logger.info(f"Extracted content from: {url}")
        
        return PageContent(text=text, html=html, title=title, url=url)
    
    async def take_screenshot(
        self,
        session_name: str,
        filename: str,
        full_page: bool = False,
        session_id: Optional[str] = None,
    ) -> str:
        """
        Capture screenshot and save to workspace.
        
        Args:
            session_name: Name of the browser session
            filename: Filename for the screenshot (relative to workspace)
            full_page: Whether to capture full scrollable page
            session_id: Optional session ID for activity stream events
            
        Returns:
            Absolute path to the saved screenshot
            
        Raises:
            ValueError: If filename path is outside workspace
        """
        session = await self.create_session(session_name)
        session.update_activity()
        
        # Validate and resolve path
        screenshot_path = self.security.validate_path(filename)
        
        # Ensure parent directory exists
        screenshot_path.parent.mkdir(parents=True, exist_ok=True)
        
        logger.info(f"Taking screenshot: {filename}")
        
        await session.page.screenshot(
            path=str(screenshot_path),
            full_page=full_page,
        )
        
        # Emit screenshot event
        if session_id:
            activity_stream = get_activity_stream()
            await activity_stream.emit(
                session_id=session_id,
                event_type=ActivityEventType.BROWSER_SCREENSHOT,
                payload={
                    "screenshot_path": str(screenshot_path),
                    "session_name": session_name,
                    "full_page": full_page
                }
            )
        
        logger.info(f"Screenshot saved: {screenshot_path}")
        
        return str(screenshot_path)
    
    async def execute_javascript(
        self,
        session_name: str,
        script: str,
    ) -> Any:
        """
        Execute JavaScript in page context.
        
        Args:
            session_name: Name of the browser session
            script: JavaScript code to execute
            
        Returns:
            Result of the JavaScript execution
        """
        session = await self.create_session(session_name)
        session.update_activity()
        
        logger.info("Executing JavaScript")
        
        try:
            result = await session.page.evaluate(script)
            logger.info("JavaScript executed successfully")
            return result
            
        except PlaywrightError as e:
            error_msg = f"JavaScript execution failed: {str(e)}"
            logger.error(error_msg)
            raise ValueError(error_msg) from e
    
    async def close_session(self, session_name: str) -> None:
        """
        Close and cleanup a browser session.
        
        Args:
            session_name: Name of the session to close
        """
        if session_name not in self.sessions:
            logger.warning(f"Session not found: {session_name}")
            return
        
        session = self.sessions[session_name]
        await session.close()
        del self.sessions[session_name]
        
        logger.info(f"Session closed and removed: {session_name}")
    
    async def cleanup_idle_sessions(self) -> None:
        """Cleanup sessions that have been idle for longer than timeout."""
        idle_sessions = [
            name for name, session in self.sessions.items()
            if session.is_idle(self.idle_timeout_minutes)
        ]
        
        for session_name in idle_sessions:
            logger.info(f"Cleaning up idle session: {session_name}")
            await self.close_session(session_name)
        
        if idle_sessions:
            logger.info(f"Cleaned up {len(idle_sessions)} idle sessions")
    
    async def close_all_sessions(self) -> None:
        """Close all browser sessions."""
        session_names = list(self.sessions.keys())
        
        for session_name in session_names:
            await self.close_session(session_name)
        
        logger.info(f"Closed all {len(session_names)} sessions")
    
    async def close(self) -> None:
        """Close all sessions and browser."""
        await self.close_all_sessions()
        
        if self.browser_use_browser:
            try:
                await self.browser_use_browser.close()
            except Exception as e:
                logger.warning(f"Error closing Browser Use browser: {e}")
            self.browser_use_browser = None
            logger.info("Browser Use browser closed")
        
        if self.browser:
            try:
                await self.browser.close()
            except Exception as e:
                logger.warning(f"Error closing Playwright browser: {e}")
            self.browser = None
            logger.info("Playwright browser closed")
        
        if self.playwright:
            try:
                await self.playwright.stop()
            except Exception as e:
                logger.warning(f"Error stopping Playwright: {e}")
            self.playwright = None
            logger.info("Playwright stopped")
    
    async def health_check(self) -> dict[str, Any]:
        """
        Perform health check on browser instances and sessions.
        
        Returns:
            Dictionary with health status information
        """
        health_info = {
            "browser_type": "browser_use" if self.use_browser_use else "playwright",
            "browser_healthy": False,
            "active_sessions": len(self.sessions),
            "session_details": [],
            "errors": []
        }
        
        try:
            # Check browser health
            if self.use_browser_use:
                health_info["browser_healthy"] = await self._is_browser_use_healthy()
            else:
                health_info["browser_healthy"] = (
                    self.browser is not None and self.browser.is_connected()
                )
            
            # Check session health
            unhealthy_sessions = []
            for session_name, session in self.sessions.items():
                try:
                    # Try to get current URL to test session health
                    current_url = session.page.url
                    health_info["session_details"].append({
                        "name": session_name,
                        "healthy": True,
                        "current_url": current_url,
                        "last_activity": session.last_activity.isoformat(),
                        "is_idle": session.is_idle(self.idle_timeout_minutes)
                    })
                except Exception as e:
                    health_info["session_details"].append({
                        "name": session_name,
                        "healthy": False,
                        "error": str(e),
                        "last_activity": session.last_activity.isoformat(),
                        "is_idle": session.is_idle(self.idle_timeout_minutes)
                    })
                    unhealthy_sessions.append(session_name)
                    health_info["errors"].append(f"Session {session_name}: {e}")
            
            # Attempt to recover unhealthy sessions
            for session_name in unhealthy_sessions:
                try:
                    logger.info(f"Attempting to recover unhealthy session: {session_name}")
                    session = self.sessions[session_name]
                    await self._recover_browser_session(session)
                    logger.info(f"Successfully recovered session: {session_name}")
                except Exception as e:
                    logger.error(f"Failed to recover session {session_name}: {e}")
                    health_info["errors"].append(f"Recovery failed for {session_name}: {e}")
            
        except Exception as e:
            health_info["errors"].append(f"Health check error: {e}")
            logger.error(f"Browser health check failed: {e}")
        
        return health_info
    
    async def restart_browser(self) -> bool:
        """
        Restart the browser instance and recover all sessions.
        
        Returns:
            True if restart was successful, False otherwise
        """
        logger.info("Restarting browser instance...")
        
        try:
            # Save all session states
            session_states = {}
            for session_name, session in self.sessions.items():
                try:
                    await session.save_state()
                    session_states[session_name] = {
                        "state_path": session.state_path,
                        "use_browser_use": session.use_browser_use
                    }
                except Exception as e:
                    logger.warning(f"Could not save state for session {session_name}: {e}")
            
            # Close all sessions and browser
            await self.close()
            
            # Wait a moment for cleanup
            await asyncio.sleep(1)
            
            # Restart browser
            await self._ensure_browser()
            
            # Recreate sessions
            recovered_sessions = 0
            for session_name, state_info in session_states.items():
                try:
                    await self.create_session(session_name)
                    recovered_sessions += 1
                    logger.info(f"Recovered session: {session_name}")
                except Exception as e:
                    logger.error(f"Failed to recover session {session_name}: {e}")
            
            logger.info(
                f"Browser restart completed. Recovered {recovered_sessions}/{len(session_states)} sessions"
            )
            return True
            
        except Exception as e:
            logger.error(f"Browser restart failed: {e}")
            return False
    
    def get_session_info(self) -> List[Dict[str, Any]]:
        """
        Get information about all active sessions.
        
        Returns:
            List of session info dictionaries
        """
        return [
            {
                "session_name": session.session_name,
                "created_at": session.created_at.isoformat(),
                "last_activity": session.last_activity.isoformat(),
                "is_idle": session.is_idle(self.idle_timeout_minutes),
                "current_url": session.page.url,
                "use_browser_use": session.use_browser_use,
            }
            for session in self.sessions.values()
        ]


# ---------------------------------------------------------------------------
# Singleton instance
# ---------------------------------------------------------------------------

_browser_controller_instance: Optional[BrowserController] = None


def get_browser_controller(
    workspace_root: str = "/workspace",
    max_sessions: int = 5,
    idle_timeout_minutes: int = 10,
    default_timeout_seconds: int = 30,
    use_browser_use: bool = True,
    llm = None,
) -> BrowserController:
    """
    Get or create the singleton BrowserController instance.
    
    Args:
        workspace_root: Root directory for workspace (default: "/workspace")
        max_sessions: Maximum concurrent browser sessions (default: 5)
        idle_timeout_minutes: Idle timeout for sessions (default: 10)
        default_timeout_seconds: Default timeout for operations (default: 30)
        use_browser_use: Whether to use Browser Use library (default: True)
        llm: Language model for Browser Use agent (optional)
        
    Returns:
        BrowserController singleton instance
    """
    global _browser_controller_instance
    
    if _browser_controller_instance is None:
        _browser_controller_instance = BrowserController(
            workspace_root=workspace_root,
            max_sessions=max_sessions,
            idle_timeout_minutes=idle_timeout_minutes,
            default_timeout_seconds=default_timeout_seconds,
            use_browser_use=use_browser_use,
            llm=llm,
        )
        logger.info("Created BrowserController singleton instance")
    
    return _browser_controller_instance
