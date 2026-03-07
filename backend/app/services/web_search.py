"""Tavily web search service — normalized, provider-agnostic wrapper.

Only our internal schema crosses the service boundary.
No Tavily-specific fields ever leave this module.
"""
from __future__ import annotations

import logging
from urllib.parse import urlparse

from pydantic import BaseModel

from app.config import settings

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Error hierarchy
# ---------------------------------------------------------------------------


class SearchError(Exception):
    """Base error for all web search failures."""


class SearchAPIKeyMissing(SearchError):
    """TAVILY_API_KEY is not set in backend/.env."""


class SearchTimeout(SearchError):
    """The Tavily request timed out."""


class SearchProviderError(SearchError):
    """Tavily returned an unexpected error."""


# ---------------------------------------------------------------------------
# Normalized internal schema
# ---------------------------------------------------------------------------


class SearchResultItem(BaseModel):
    title: str
    url: str
    snippet: str   # Tavily's "content" field, trimmed to ~250 chars
    domain: str    # extracted from URL, www. stripped


class SearchResponse(BaseModel):
    query: str
    results: list[SearchResultItem]
    result_count: int


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


def _trim_snippet(text: str, max_chars: int = 250) -> str:
    """Trim to max_chars at a word boundary, appending ellipsis if needed."""
    if len(text) <= max_chars:
        return text
    trimmed = text[:max_chars].rsplit(" ", 1)[0]
    return (trimmed or text[:max_chars]).rstrip(" .,;") + "…"


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class WebSearchService:
    """
    Tavily-backed web search.  Call `search(query)` — returns SearchResponse.

    Raises:
        SearchAPIKeyMissing  — TAVILY_API_KEY not configured
        SearchTimeout        — request timed out
        SearchProviderError  — any other Tavily / network error
    """

    _DEFAULT_MAX_RESULTS = 5
    _DEFAULT_DEPTH = "basic"
    _DEFAULT_TOPIC = "general"

    async def search(
        self,
        query: str,
        *,
        max_results: int = _DEFAULT_MAX_RESULTS,
        search_depth: str = _DEFAULT_DEPTH,
        topic: str = _DEFAULT_TOPIC,
    ) -> SearchResponse:
        if not settings.tavily_api_key:
            raise SearchAPIKeyMissing(
                "TAVILY_API_KEY is not set. Add it to backend/.env."
            )

        try:
            from tavily import AsyncTavilyClient  # noqa: PLC0415
        except ImportError as exc:
            raise SearchProviderError(
                "tavily-python is not installed. Run: pip install tavily-python"
            ) from exc

        try:
            client = AsyncTavilyClient(api_key=settings.tavily_api_key)
            raw = await client.search(
                query=query,
                search_depth=search_depth,
                max_results=max_results,
                topic=topic,
                include_answer=False,
                include_raw_content=False,
            )
        except TimeoutError as exc:
            raise SearchTimeout(f"Tavily request timed out: {exc}") from exc
        except Exception as exc:
            low = str(exc).lower()
            if "timeout" in low or "timed out" in low:
                raise SearchTimeout(str(exc)) from exc
            raise SearchProviderError(str(exc)) from exc

        # Normalize — discard all provider-specific noise
        items: list[SearchResultItem] = []
        for r in raw.get("results", []):
            raw_url = r.get("url", "")
            raw_snippet = r.get("content") or r.get("snippet") or ""
            items.append(
                SearchResultItem(
                    title=r.get("title") or "Untitled",
                    url=raw_url,
                    snippet=_trim_snippet(raw_snippet),
                    domain=_extract_domain(raw_url),
                )
            )

        return SearchResponse(
            query=query,
            results=items,
            result_count=len(items),
        )


# Module-level singleton
web_search_service = WebSearchService()
