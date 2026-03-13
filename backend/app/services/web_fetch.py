"""Web content fetching service — retrieves and extracts text from URLs.

Provides a simple interface for the agent to fetch web page content.
Uses httpx for async HTTP requests with proper timeout and error handling.
"""
from __future__ import annotations

import logging
from urllib.parse import urlparse

import httpx
from pydantic import BaseModel

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Error hierarchy
# ---------------------------------------------------------------------------


class FetchError(Exception):
    """Base error for all web fetch failures."""


class FetchTimeout(FetchError):
    """The HTTP request timed out."""


class FetchHTTPError(FetchError):
    """HTTP error response (4xx, 5xx)."""


class FetchInvalidURL(FetchError):
    """URL is malformed or uses an unsupported scheme."""


# ---------------------------------------------------------------------------
# Response schema
# ---------------------------------------------------------------------------


class FetchResponse(BaseModel):
    url: str
    status_code: int
    content_type: str
    text_content: str
    title: str | None = None
    domain: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _extract_domain(url: str) -> str:
    """Return clean domain (www. stripped) from any URL."""
    try:
        netloc = urlparse(url).netloc
        return netloc.removeprefix("www.")
    except Exception:  # noqa: BLE001
        return url


def _extract_title(html: str) -> str | None:
    """Extract <title> tag content from HTML (simple regex approach)."""
    import re
    match = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
    if match:
        return match.group(1).strip()
    return None


def _strip_html_tags(html: str) -> str:
    """Remove HTML tags and return plain text (basic cleanup)."""
    import re
    # Remove script and style elements
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", html, flags=re.DOTALL | re.IGNORECASE)
    # Remove HTML tags
    text = re.sub(r"<[^>]+>", " ", text)
    # Clean up whitespace
    text = re.sub(r"\s+", " ", text)
    return text.strip()


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class WebFetchService:
    """
    HTTP-based web content fetcher.  Call `fetch(url)` — returns FetchResponse.

    Raises:
        FetchInvalidURL   — URL is malformed or unsupported
        FetchTimeout      — request timed out
        FetchHTTPError    — HTTP error status (4xx, 5xx)
        FetchError        — any other network/parsing error
    """

    _DEFAULT_TIMEOUT = 10.0  # seconds
    _MAX_CONTENT_LENGTH = 1_000_000  # 1 MB limit for safety

    async def fetch(
        self,
        url: str,
        *,
        timeout: float = _DEFAULT_TIMEOUT,
        extract_text: bool = True,
        verify_ssl: bool = True,
    ) -> FetchResponse:
        """Fetch content from a URL and return structured response.

        Args:
            url: The URL to fetch
            timeout: Request timeout in seconds
            extract_text: If True, strip HTML tags and return plain text
            verify_ssl: If True, verify SSL certificates (default: True)

        Returns:
            FetchResponse with content and metadata

        Raises:
            FetchInvalidURL: URL is malformed or uses unsupported scheme
            FetchTimeout: Request timed out
            FetchHTTPError: HTTP error status
            FetchError: Other network or parsing errors
        """
        # Validate URL scheme
        try:
            parsed = urlparse(url)
            if parsed.scheme not in ("http", "https"):
                raise FetchInvalidURL(
                    f"Unsupported URL scheme: {parsed.scheme}. Only http/https allowed."
                )
        except Exception as exc:
            raise FetchInvalidURL(f"Invalid URL: {exc}") from exc

        try:
            async with httpx.AsyncClient(
                timeout=timeout,
                follow_redirects=True,
                limits=httpx.Limits(max_connections=10),
                verify=verify_ssl,
            ) as client:
                response = await client.get(
                    url,
                    headers={
                        "User-Agent": "Mozilla/5.0 (compatible; AgentBot/1.0)",
                        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    },
                )
                response.raise_for_status()

                # Check content length
                content_length = len(response.content)
                if content_length > self._MAX_CONTENT_LENGTH:
                    raise FetchError(
                        f"Content too large: {content_length} bytes "
                        f"(max {self._MAX_CONTENT_LENGTH})"
                    )

                content_type = response.headers.get("content-type", "").split(";")[0].strip()
                raw_text = response.text

                # Extract title and clean text for HTML content
                title = None
                text_content = raw_text

                if "html" in content_type.lower() and extract_text:
                    title = _extract_title(raw_text)
                    text_content = _strip_html_tags(raw_text)

                return FetchResponse(
                    url=str(response.url),  # Final URL after redirects
                    status_code=response.status_code,
                    content_type=content_type,
                    text_content=text_content[:50000],  # Limit to 50k chars
                    title=title,
                    domain=_extract_domain(str(response.url)),
                )

        except httpx.TimeoutException as exc:
            raise FetchTimeout(f"Request timed out after {timeout}s: {url}") from exc
        except httpx.HTTPStatusError as exc:
            raise FetchHTTPError(
                f"HTTP {exc.response.status_code} error for {url}"
            ) from exc
        except Exception as exc:
            low = str(exc).lower()
            if "timeout" in low or "timed out" in low:
                raise FetchTimeout(str(exc)) from exc
            raise FetchError(f"Failed to fetch {url}: {exc}") from exc


# Module-level singleton
web_fetch_service = WebFetchService()
