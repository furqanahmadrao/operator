"""LangGraph tool definitions for the agent runtime.

Each tool is a thin, typed wrapper around an existing app service.
The app services (web_search, artifact_service) remain unchanged;
these wrappers simply adapt them to the LangGraph @tool interface.

Tool design notes
-----------------
* ``web_search``            — calls Tavily, returns structured JSON so the
                              event mapper can extract UI data from on_tool_end.
* ``create_artifact``       — creates an artifact row in the app DB immediately.
                              session_id is injected from RunnableConfig.
* ``get_current_datetime``  — returns precise UTC date/time; the agent calls
                              this when the user needs exact temporal context.
* ``list_session_artifacts``— lets the agent see what artifacts already exist
                              in the session so it can reference or build on them.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

from app.services import artifact_service
from app.services.web_search import (
    SearchAPIKeyMissing,
    SearchError,
    SearchTimeout,
    web_search_service,
)
from app.services.web_fetch import (
    FetchError,
    FetchHTTPError,
    FetchInvalidURL,
    FetchTimeout,
    web_fetch_service,
)

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Web search
# ---------------------------------------------------------------------------


@tool
async def web_search(query: str) -> str:
    """Search the web for current, real-time information.

    Call this tool when the user asks about:
    - Current events, breaking news, or recent developments
    - Live prices, stock data, exchange rates, or sports scores
    - Latest software releases, product updates, or changelogs
    - Anything explicitly time-sensitive or requiring up-to-date facts

    Do NOT call for:
    - General knowledge, stable facts, mathematics, or coding help
    - Creative writing, brainstorming, or opinion generation
    - Casual conversation or greetings
    """
    try:
        result = await web_search_service.search(query)
        results_list = [
            {
                "title": r.title,
                "url": r.url,
                "snippet": r.snippet,
                "domain": r.domain,
            }
            for r in result.results
        ]
        # Build a human-readable context block for the LLM
        context_lines = [f'[WEB SEARCH RESULTS for: "{query}"]', ""]
        for i, r in enumerate(result.results, 1):
            context_lines.append(f"{i}. {r.title} — {r.domain}")
            if r.snippet:
                context_lines.append(f"   {r.snippet}")
        context_lines.extend(
            [
                "",
                "Use these results to inform your answer. Attribute sources inline.",
                "Do not fabricate citations or URLs not listed above.",
            ]
        )
        return json.dumps(
            {
                "status": "completed",
                "query": query,
                "result_count": result.result_count,
                "results": results_list,
                "context": "\n".join(context_lines),
            }
        )
    except SearchAPIKeyMissing:
        log.warning("web_search: API key missing")
        return json.dumps(
            {"status": "error", "message": "Web search API key not configured."}
        )
    except SearchTimeout:
        log.warning("web_search: timeout for query=%r", query)
        return json.dumps({"status": "error", "message": "Web search timed out."})
    except SearchError as exc:
        log.warning("web_search: provider error: %s", exc)
        return json.dumps(
            {"status": "error", "message": "Web search temporarily unavailable."}
        )


# ---------------------------------------------------------------------------
# Web fetch
# ---------------------------------------------------------------------------


@tool
async def web_fetch(url: str) -> str:
    """Fetch and extract content from a specific web page URL.

    Use this tool when you need to:
    - Read the full content of a specific web page or article
    - Extract text from documentation pages or blog posts
    - Get detailed information from a URL the user provided
    - Follow up on search results to get complete content

    Do NOT use for:
    - General web searches (use web_search instead)
    - Multiple pages at once (call this tool multiple times if needed)
    - Non-HTTP/HTTPS URLs

    Args:
        url: The complete URL to fetch (must start with http:// or https://)

    Returns:
        JSON with status, url, title, domain, content_type, and text_content
    """
    try:
        result = await web_fetch_service.fetch(url)
        return json.dumps(
            {
                "status": "success",
                "url": result.url,
                "title": result.title,
                "domain": result.domain,
                "content_type": result.content_type,
                "text_content": result.text_content,
                "message": f"Successfully fetched content from {result.domain}",
            }
        )
    except FetchInvalidURL as exc:
        log.warning("web_fetch: invalid URL: %s", exc)
        return json.dumps(
            {
                "status": "error",
                "message": f"Invalid URL: {exc}",
            }
        )
    except FetchTimeout as exc:
        log.warning("web_fetch: timeout for url=%r", url)
        return json.dumps(
            {
                "status": "error",
                "message": f"Request timed out: {exc}",
            }
        )
    except FetchHTTPError as exc:
        log.warning("web_fetch: HTTP error: %s", exc)
        return json.dumps(
            {
                "status": "error",
                "message": f"HTTP error: {exc}",
            }
        )
    except FetchError as exc:
        log.warning("web_fetch: fetch error: %s", exc)
        return json.dumps(
            {
                "status": "error",
                "message": f"Failed to fetch content: {exc}",
            }
        )


# ---------------------------------------------------------------------------
# Artifact creation
# ---------------------------------------------------------------------------


@tool
async def create_artifact(
    title: str,
    artifact_type: str,
    content: str,
    config: RunnableConfig,
) -> str:
    """Create a standalone artifact document and save it to the user's library.

    Use this tool for long-form documents the user would save, export, or
    refer back to, such as:
    - Reports, analyses, research write-ups (~400+ words of prose)
    - Project plans, roadmaps, or structured proposals
    - Full templates: README, email, contract, resume, cover letter
    - Formal technical specifications or design documents
    - Web pages, dashboards, or interactive HTML experiences

    Do NOT use for:
    - Code snippets, short Q&A replies, or conversational content
    - Prose under ~300 words that fits naturally in the chat

    Before calling this tool write one short intro sentence in the chat
    (e.g. "Here is the report you asked for.").
    Only one artifact per response.

    Args:
        title: 2–6 word title, title-cased and descriptive.
        artifact_type: ``"markdown"`` for prose/documents, or ``"html"`` for
                       self-contained web pages with all CSS/JS inlined.
        content: Full content of the artifact.  For HTML this must be a
                 complete page starting with ``<!DOCTYPE html>``.
    """
    session_id: str = config["configurable"]["session_id"]
    artifact = await artifact_service.create_artifact(
        session_id=session_id,
        title=title,
        content=content,
        artifact_type=artifact_type,
        source_message_id=None,  # linked to message after the turn completes
    )
    log.info(
        "create_artifact: id=%s title=%r type=%s session=%s",
        artifact["id"],
        title,
        artifact_type,
        session_id,
    )
    return json.dumps(
        {
            "status": "created",
            "artifact_id": artifact["id"],
            "title": artifact["title"],
            "type": artifact["type"],
            "session_id": session_id,
        }
    )


# ---------------------------------------------------------------------------
# Date / time helper
# ---------------------------------------------------------------------------


@tool
def get_current_datetime() -> str:
    """Get the current date and time in UTC.

    Call this when the user needs to know the exact current date or time,
    perform date arithmetic (e.g. "3 days from now"), or verify what counts
    as 'recent' in the context of a search or calculation.

    The current date is also available in the system prompt, but calling this
    tool returns the most precise real-time value.
    """
    now = datetime.now(timezone.utc)
    return json.dumps(
        {
            "date": now.strftime("%A, %B %d, %Y"),
            "time": now.strftime("%H:%M:%S UTC"),
            "iso8601": now.isoformat(),
            "unix_timestamp": int(now.timestamp()),
        }
    )


# ---------------------------------------------------------------------------
# Session artifact listing
# ---------------------------------------------------------------------------


@tool
async def list_session_artifacts(config: RunnableConfig) -> str:
    """List all artifacts that have been created in the current session.

    Use this to:
    - Tell the user what documents are in their library for this conversation.
    - Reference a previously created artifact before deciding to create a new one.
    - Avoid creating duplicate documents.

    Returns a list of artifacts with id, title, type, and creation time.
    """
    session_id: str = config["configurable"]["session_id"]
    artifacts = await artifact_service.list_artifacts(session_id)
    if not artifacts:
        return json.dumps(
            {
                "status": "empty",
                "message": "No artifacts have been created in this session yet.",
            }
        )
    return json.dumps(
        {
            "status": "ok",
            "count": len(artifacts),
            "artifacts": [
                {
                    "id": a["id"],
                    "title": a["title"],
                    "type": a["type"],
                    "created_at": a["created_at"],
                }
                for a in artifacts
            ],
        }
    )


# ---------------------------------------------------------------------------
# Artifact update
# ---------------------------------------------------------------------------


@tool
async def update_artifact(
    artifact_id: str,
    content: str,
    title: str | None = None,
    config: RunnableConfig = None,
) -> str:
    """Update an existing artifact with revised content.

    Use this when the user asks to edit, revise, improve, rewrite, or update
    a document that was already created in this session.

    Workflow:
    1. Call list_session_artifacts to get the artifact_id by name.
    2. Call this tool with the full replacement content.

    NEVER call create_artifact when the user wants to modify existing work.
    Always update in place so the user gets a versioned revision, not a duplicate.

    Args:
        artifact_id: The ID of the artifact to update (from list_session_artifacts).
        content: Complete replacement content — fully replaces the previous version.
        title: Optional new title. If omitted, the existing title is preserved.
    """
    session_id: str = config["configurable"]["session_id"]
    artifact = await artifact_service.update_artifact(
        artifact_id=artifact_id,
        content=content,
        title=title,
    )
    if not artifact:
        return json.dumps(
            {"status": "error", "message": f"Artifact {artifact_id!r} not found."}
        )
    log.info(
        "update_artifact: id=%s title=%r version=%s session=%s",
        artifact["id"],
        artifact["title"],
        artifact.get("version"),
        session_id,
    )
    return json.dumps(
        {
            "status": "updated",
            "artifact_id": artifact["id"],
            "title": artifact["title"],
            "type": artifact["type"],
            "version": artifact.get("version", 1),
            "session_id": session_id,
        }
    )


# ---------------------------------------------------------------------------
# Terminal tools
# ---------------------------------------------------------------------------


@tool
async def execute_command(
    command: str,
    timeout: int = 30,
    config: RunnableConfig = None,
) -> str:
    """Execute a shell command in the Alpine Linux workspace.

    Use this tool to:
    - Run shell commands, scripts, or CLI tools
    - Install packages with apk (Alpine package manager)
    - Execute build commands, tests, or automation scripts
    - Process files with standard Unix utilities

    The command runs in the current working directory within the workspace.
    All file operations are sandboxed to the workspace directory.

    Do NOT use for:
    - Long-running servers or daemons (they will timeout)
    - Interactive commands requiring user input
    - Commands that need root privileges

    Args:
        command: Shell command to execute
        timeout: Maximum execution time in seconds (default: 30)

    Returns:
        JSON with status, exit_code, stdout, stderr, and duration
    """
    from app.services.terminal_controller import get_terminal_controller
    from app.services.security import SecurityViolation

    try:
        terminal = get_terminal_controller()
        
        # Extract session_id from config for activity stream events
        session_id = None
        if config and "configurable" in config:
            session_id = config["configurable"].get("session_id")
        
        result = await terminal.execute_command(
            command, 
            timeout=timeout,
            session_id=session_id
        )

        return json.dumps(
            {
                "status": "completed",
                "exit_code": result.exit_code,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "duration_ms": result.duration_ms,
                "timed_out": result.timed_out,
                "working_directory": str(terminal.get_current_directory()),
            }
        )

    except SecurityViolation as exc:
        log.warning("execute_command: security violation: %s", exc)
        return json.dumps(
            {
                "status": "error",
                "message": f"Security violation: {exc}",
            }
        )
    except Exception as exc:
        log.error("execute_command: unexpected error: %s", exc)
        return json.dumps(
            {
                "status": "error",
                "message": f"Command execution failed: {exc}",
            }
        )


@tool
async def change_directory(path: str) -> str:
    """Change the working directory within the workspace.

    Use this to navigate the workspace directory structure before executing
    commands or file operations. The path must be within the workspace boundary.

    Args:
        path: Target directory path (absolute or relative to current directory)

    Returns:
        JSON with status and new working directory path
    """
    from app.services.terminal_controller import get_terminal_controller
    from app.services.security import SecurityViolation

    try:
        terminal = get_terminal_controller()
        new_dir = await terminal.change_directory(path)

        log.info("change_directory: changed to %s", new_dir)
        return json.dumps(
            {
                "status": "success",
                "working_directory": str(new_dir),
                "message": f"Changed directory to {new_dir}",
            }
        )

    except SecurityViolation as exc:
        log.warning("change_directory: security violation: %s", exc)
        return json.dumps(
            {
                "status": "error",
                "message": f"Security violation: {exc}",
            }
        )
    except FileNotFoundError as exc:
        log.warning("change_directory: directory not found: %s", exc)
        return json.dumps(
            {
                "status": "error",
                "message": f"Directory not found: {exc}",
            }
        )
    except NotADirectoryError as exc:
        log.warning("change_directory: not a directory: %s", exc)
        return json.dumps(
            {
                "status": "error",
                "message": f"Not a directory: {exc}",
            }
        )
    except Exception as exc:
        log.error("change_directory: unexpected error: %s", exc)
        return json.dumps(
            {
                "status": "error",
                "message": f"Failed to change directory: {exc}",
            }
        )


@tool
async def list_directory(path: str = ".") -> str:
    """List files and directories at the specified path.

    Use this to explore the workspace directory structure, see what files
    exist, and get file metadata (size, type, modification time).

    Args:
        path: Directory path to list (default: current directory)

    Returns:
        JSON with status and list of entries with name, type, size, and modified time
    """
    from app.services.terminal_controller import get_terminal_controller
    from app.services.security import SecurityViolation

    try:
        terminal = get_terminal_controller()
        entries = await terminal.list_directory(path)

        return json.dumps(
            {
                "status": "success",
                "path": path,
                "entry_count": len(entries),
                "entries": entries,
            }
        )

    except SecurityViolation as exc:
        log.warning("list_directory: security violation: %s", exc)
        return json.dumps(
            {
                "status": "error",
                "message": f"Security violation: {exc}",
            }
        )
    except FileNotFoundError as exc:
        log.warning("list_directory: path not found: %s", exc)
        return json.dumps(
            {
                "status": "error",
                "message": f"Path not found: {exc}",
            }
        )
    except NotADirectoryError as exc:
        log.warning("list_directory: not a directory: %s", exc)
        return json.dumps(
            {
                "status": "error",
                "message": f"Not a directory: {exc}",
            }
        )
    except Exception as exc:
        log.error("list_directory: unexpected error: %s", exc)
        return json.dumps(
            {
                "status": "error",
                "message": f"Failed to list directory: {exc}",
            }
        )


@tool
async def read_file(path: str) -> str:
    """Read the contents of a file from the workspace.

    Use this to read text files, configuration files, code files, or any
    other file content within the workspace.

    Args:
        path: File path to read (relative to current directory or absolute within workspace)

    Returns:
        JSON with status, file content, size, and metadata
    """
    from app.services.security import SecurityViolation, get_security_boundary

    try:
        security = get_security_boundary()
        file_path = security.validate_path(path)

        if not file_path.exists():
            return json.dumps(
                {
                    "status": "error",
                    "message": f"File not found: {path}",
                }
            )

        if not file_path.is_file():
            return json.dumps(
                {
                    "status": "error",
                    "message": f"Not a file: {path}",
                }
            )

        # Check file size
        file_size = file_path.stat().st_size
        security.check_file_size(file_size)

        # Read file content
        content = file_path.read_text(encoding="utf-8", errors="replace")

        log.info("read_file: read %s (%d bytes)", path, file_size)
        return json.dumps(
            {
                "status": "success",
                "path": str(file_path),
                "content": content,
                "size_bytes": file_size,
            }
        )

    except SecurityViolation as exc:
        log.warning("read_file: security violation: %s", exc)
        return json.dumps(
            {
                "status": "error",
                "message": f"Security violation: {exc}",
            }
        )
    except UnicodeDecodeError as exc:
        log.warning("read_file: binary file: %s", exc)
        return json.dumps(
            {
                "status": "error",
                "message": f"Cannot read binary file: {path}",
            }
        )
    except Exception as exc:
        log.error("read_file: unexpected error: %s", exc)
        return json.dumps(
            {
                "status": "error",
                "message": f"Failed to read file: {exc}",
            }
        )


@tool
async def write_file(path: str, content: str, config: RunnableConfig = None) -> str:
    """Write content to a file in the workspace.

    Use this to create new files or overwrite existing files with new content.
    The file will be created with UTF-8 encoding.

    Args:
        path: File path to write (relative to current directory or absolute within workspace)
        content: Content to write to the file

    Returns:
        JSON with status, file path, and size
    """
    from app.services.security import SecurityViolation, get_security_boundary

    try:
        security = get_security_boundary()
        file_path = security.validate_path(path)

        # Check content size
        content_bytes = content.encode("utf-8")
        security.check_file_size(len(content_bytes))

        # Create parent directories if needed
        file_path.parent.mkdir(parents=True, exist_ok=True)

        # Check if file exists (for determining create vs modify event)
        file_exists = file_path.exists()

        # Write file
        file_path.write_text(content, encoding="utf-8")

        file_size = file_path.stat().st_size
        
        # Emit file operation event
        session_id = None
        if config and "configurable" in config:
            session_id = config["configurable"].get("session_id")
        
        if session_id:
            from app.services.activity_stream import get_activity_stream, ActivityEventType
            activity_stream = get_activity_stream()
            
            event_type = ActivityEventType.FILE_MODIFIED if file_exists else ActivityEventType.FILE_CREATED
            await activity_stream.emit(
                session_id=session_id,
                event_type=event_type,
                payload={
                    "path": str(file_path),
                    "size_bytes": file_size,
                    "file_type": "text"
                }
            )
        
        log.info("write_file: wrote %s (%d bytes)", path, file_size)

        return json.dumps(
            {
                "status": "success",
                "path": str(file_path),
                "size_bytes": file_size,
                "message": f"Successfully wrote {file_size} bytes to {path}",
            }
        )

    except SecurityViolation as exc:
        log.warning("write_file: security violation: %s", exc)
        return json.dumps(
            {
                "status": "error",
                "message": f"Security violation: {exc}",
            }
        )
    except Exception as exc:
        log.error("write_file: unexpected error: %s", exc)
        return json.dumps(
            {
                "status": "error",
                "message": f"Failed to write file: {exc}",
            }
        )


@tool
async def delete_file(path: str, config: RunnableConfig = None) -> str:
    """Delete a file from the workspace.

    Use this to remove files that are no longer needed. This operation
    cannot be undone.

    Args:
        path: File path to delete (relative to current directory or absolute within workspace)

    Returns:
        JSON with status and confirmation message
    """
    from app.services.security import SecurityViolation, get_security_boundary

    try:
        security = get_security_boundary()
        file_path = security.validate_path(path)

        if not file_path.exists():
            return json.dumps(
                {
                    "status": "error",
                    "message": f"File not found: {path}",
                }
            )

        if not file_path.is_file():
            return json.dumps(
                {
                    "status": "error",
                    "message": f"Not a file (use shell commands to remove directories): {path}",
                }
            )

        # Get file size before deletion
        file_size = file_path.stat().st_size

        # Delete file
        file_path.unlink()

        # Emit file deletion event
        session_id = None
        if config and "configurable" in config:
            session_id = config["configurable"].get("session_id")
        
        if session_id:
            from app.services.activity_stream import get_activity_stream, ActivityEventType
            activity_stream = get_activity_stream()
            
            await activity_stream.emit(
                session_id=session_id,
                event_type=ActivityEventType.FILE_DELETED,
                payload={
                    "path": str(file_path),
                    "size_bytes": file_size,
                    "file_type": "text"
                }
            )

        log.info("delete_file: deleted %s", path)
        return json.dumps(
            {
                "status": "success",
                "path": str(file_path),
                "message": f"Successfully deleted {path}",
            }
        )

    except SecurityViolation as exc:
        log.warning("delete_file: security violation: %s", exc)
        return json.dumps(
            {
                "status": "error",
                "message": f"Security violation: {exc}",
            }
        )
    except Exception as exc:
        log.error("delete_file: unexpected error: %s", exc)
        return json.dumps(
            {
                "status": "error",
                "message": f"Failed to delete file: {exc}",
            }
        )


# ---------------------------------------------------------------------------
# Browser automation tools
# ---------------------------------------------------------------------------


@tool
async def navigate_to_url(url: str, session_name: str = "default", config: RunnableConfig = None) -> str:
    """Navigate browser to a URL and wait for page load.

    Use this tool to:
    - Open web pages in a browser session
    - Navigate to specific URLs for web scraping or automation
    - Load pages before interacting with elements

    The browser runs in headless mode and maintains session state including
    cookies and local storage. Multiple named sessions can be used for
    different browsing contexts.

    Args:
        url: Complete URL to navigate to (must include http:// or https://)
        session_name: Name of the browser session (default: "default")

    Returns:
        JSON with status, url, and any error message
    """
    from app.services.browser_controller import get_browser_controller

    try:
        browser = get_browser_controller()
        
        # Extract session_id from config for activity stream events
        session_id = None
        if config and "configurable" in config:
            session_id = config["configurable"].get("session_id")
        
        result = await browser.navigate(session_name, url, session_id=session_id)

        if result.success:
            log.info("navigate_to_url: navigated to %s in session %s", url, session_name)
            return json.dumps(
                {
                    "status": "success",
                    "url": result.url,
                    "session_name": session_name,
                    "message": f"Successfully navigated to {url}",
                }
            )
        else:
            log.warning("navigate_to_url: failed to navigate to %s: %s", url, result.error)
            return json.dumps(
                {
                    "status": "error",
                    "url": url,
                    "session_name": session_name,
                    "message": result.error or "Navigation failed",
                }
            )

    except ValueError as exc:
        log.warning("navigate_to_url: validation error: %s", exc)
        return json.dumps(
            {
                "status": "error",
                "message": str(exc),
            }
        )
    except Exception as exc:
        log.error("navigate_to_url: unexpected error: %s", exc)
        return json.dumps(
            {
                "status": "error",
                "message": f"Navigation failed: {exc}",
            }
        )


@tool
async def click_element(selector: str, session_name: str = "default", config: RunnableConfig = None) -> str:
    """Click an element on the current page using a CSS selector.

    Use this tool to:
    - Click buttons, links, or other interactive elements
    - Submit forms by clicking submit buttons
    - Trigger JavaScript events on page elements

    The tool waits for the element to be visible and clickable before
    attempting the click. If the element is not found within the timeout,
    an error is returned.

    Args:
        selector: CSS selector for the element to click (e.g., "#submit-btn", ".nav-link")
        session_name: Name of the browser session (default: "default")

    Returns:
        JSON with status, selector, and any error message
    """
    from app.services.browser_controller import get_browser_controller

    try:
        browser = get_browser_controller()
        
        # Extract session_id from config for activity stream events
        session_id = None
        if config and "configurable" in config:
            session_id = config["configurable"].get("session_id")
        
        result = await browser.click_element(session_name, selector, session_id=session_id)

        if result.success:
            log.info("click_element: clicked %s in session %s", selector, session_name)
            return json.dumps(
                {
                    "status": "success",
                    "selector": selector,
                    "session_name": session_name,
                    "message": f"Successfully clicked element: {selector}",
                }
            )
        else:
            log.warning("click_element: failed to click %s: %s", selector, result.error)
            return json.dumps(
                {
                    "status": "error",
                    "selector": selector,
                    "session_name": session_name,
                    "message": result.error or "Click failed",
                }
            )

    except ValueError as exc:
        log.warning("click_element: validation error: %s", exc)
        return json.dumps(
            {
                "status": "error",
                "message": str(exc),
            }
        )
    except Exception as exc:
        log.error("click_element: unexpected error: %s", exc)
        return json.dumps(
            {
                "status": "error",
                "message": f"Click failed: {exc}",
            }
        )


@tool
async def extract_page_content(session_name: str = "default") -> str:
    """Extract text and HTML content from the current page.

    Use this tool to:
    - Get the visible text content from a web page
    - Extract structured data from HTML
    - Read page content for analysis or processing

    Returns both the visible text (innerText) and the full HTML source,
    along with the page title and current URL.

    Args:
        session_name: Name of the browser session (default: "default")

    Returns:
        JSON with status, text content, HTML, title, and URL
    """
    from app.services.browser_controller import get_browser_controller

    try:
        browser = get_browser_controller()
        content = await browser.extract_content(session_name)

        log.info("extract_page_content: extracted content from %s", content.url)
        return json.dumps(
            {
                "status": "success",
                "url": content.url,
                "title": content.title,
                "text_content": content.text,
                "html_content": content.html,
                "session_name": session_name,
                "text_length": len(content.text),
                "html_length": len(content.html),
            }
        )

    except ValueError as exc:
        log.warning("extract_page_content: validation error: %s", exc)
        return json.dumps(
            {
                "status": "error",
                "message": str(exc),
            }
        )
    except Exception as exc:
        log.error("extract_page_content: unexpected error: %s", exc)
        return json.dumps(
            {
                "status": "error",
                "message": f"Content extraction failed: {exc}",
            }
        )


@tool
async def fill_form_field(selector: str, value: str, session_name: str = "default") -> str:
    """Fill a form input field with a value.

    Use this tool to:
    - Enter text into input fields, textareas, or contenteditable elements
    - Fill out forms for automation or testing
    - Set values in form fields before submission

    The tool waits for the element to be visible before filling. It clears
    any existing value before entering the new value.

    Args:
        selector: CSS selector for the input field (e.g., "#email", "input[name='username']")
        value: Text value to enter into the field
        session_name: Name of the browser session (default: "default")

    Returns:
        JSON with status, selector, and any error message
    """
    from app.services.browser_controller import get_browser_controller

    try:
        browser = get_browser_controller()
        result = await browser.fill_form_field(session_name, selector, value)

        if result.success:
            log.info("fill_form_field: filled %s in session %s", selector, session_name)
            return json.dumps(
                {
                    "status": "success",
                    "selector": selector,
                    "session_name": session_name,
                    "message": f"Successfully filled field: {selector}",
                }
            )
        else:
            log.warning("fill_form_field: failed to fill %s: %s", selector, result.error)
            return json.dumps(
                {
                    "status": "error",
                    "selector": selector,
                    "session_name": session_name,
                    "message": result.error or "Fill failed",
                }
            )

    except ValueError as exc:
        log.warning("fill_form_field: validation error: %s", exc)
        return json.dumps(
            {
                "status": "error",
                "message": str(exc),
            }
        )
    except Exception as exc:
        log.error("fill_form_field: unexpected error: %s", exc)
        return json.dumps(
            {
                "status": "error",
                "message": f"Fill failed: {exc}",
            }
        )


@tool
async def take_screenshot(filename: str, session_name: str = "default", full_page: bool = False, config: RunnableConfig = None) -> str:
    """Capture a screenshot of the current page and save it to the workspace.

    Use this tool to:
    - Capture visual state of web pages
    - Document page appearance for debugging or reporting
    - Save images of rendered content

    The screenshot is saved as a PNG file in the workspace. The filename
    should include the .png extension.

    Args:
        filename: Filename for the screenshot (e.g., "homepage.png")
        session_name: Name of the browser session (default: "default")
        full_page: Whether to capture the full scrollable page (default: False)

    Returns:
        JSON with status, file path, and file size
    """
    from app.services.browser_controller import get_browser_controller
    from app.services.security import SecurityViolation

    try:
        browser = get_browser_controller()
        
        # Extract session_id from config for activity stream events
        session_id = None
        if config and "configurable" in config:
            session_id = config["configurable"].get("session_id")
        
        screenshot_path = await browser.take_screenshot(session_name, filename, full_page, session_id)

        # Get file size
        from pathlib import Path
        file_size = Path(screenshot_path).stat().st_size

        log.info("take_screenshot: saved screenshot to %s (%d bytes)", screenshot_path, file_size)
        return json.dumps(
            {
                "status": "success",
                "path": screenshot_path,
                "filename": filename,
                "session_name": session_name,
                "full_page": full_page,
                "size_bytes": file_size,
                "message": f"Screenshot saved to {filename}",
            }
        )

    except SecurityViolation as exc:
        log.warning("take_screenshot: security violation: %s", exc)
        return json.dumps(
            {
                "status": "error",
                "message": f"Security violation: {exc}",
            }
        )
    except ValueError as exc:
        log.warning("take_screenshot: validation error: %s", exc)
        return json.dumps(
            {
                "status": "error",
                "message": str(exc),
            }
        )
    except Exception as exc:
        log.error("take_screenshot: unexpected error: %s", exc)
        return json.dumps(
            {
                "status": "error",
                "message": f"Screenshot failed: {exc}",
            }
        )


@tool
async def execute_javascript(script: str, session_name: str = "default") -> str:
    """Execute JavaScript code in the context of the current page.

    Use this tool to:
    - Run custom JavaScript for page manipulation or data extraction
    - Access browser APIs and page objects
    - Perform complex interactions not covered by other tools

    The script runs in the page context and has access to the DOM and all
    page JavaScript. The return value is serialized to JSON.

    Args:
        script: JavaScript code to execute (e.g., "document.title", "window.location.href")
        session_name: Name of the browser session (default: "default")

    Returns:
        JSON with status and the result of the JavaScript execution
    """
    from app.services.browser_controller import get_browser_controller

    try:
        browser = get_browser_controller()
        result = await browser.execute_javascript(session_name, script)

        log.info("execute_javascript: executed script in session %s", session_name)
        return json.dumps(
            {
                "status": "success",
                "result": result,
                "session_name": session_name,
                "message": "JavaScript executed successfully",
            }
        )

    except ValueError as exc:
        log.warning("execute_javascript: execution error: %s", exc)
        return json.dumps(
            {
                "status": "error",
                "message": str(exc),
            }
        )
    except Exception as exc:
        log.error("execute_javascript: unexpected error: %s", exc)
        return json.dumps(
            {
                "status": "error",
                "message": f"JavaScript execution failed: {exc}",
            }
        )
