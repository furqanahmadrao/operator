"""Serper.dev search service — normalized, provider-agnostic wrapper.

Replaces the old Google Custom Search JSON API (100 queries/day limit).
Serper.dev offers 2500 free queries/month with no per-day cap.

API reference: https://serper.dev/

Setup
-----
1. Sign up at https://serper.dev and copy your API key.
2. Set SERPER_API_KEY=<your_key> in backend/.env.
"""
from __future__ import annotations

import logging
from urllib.parse import urlparse

import httpx
from pydantic import BaseModel

from app.config import settings

log = logging.getLogger(__name__)

_SERPER_SEARCH_URL = "https://google.serper.dev/search"


# ---------------------------------------------------------------------------
# Error hierarchy  (mirrors web_search.py for interchangeability)
# ---------------------------------------------------------------------------


class GoogleSearchError(Exception):
    """Base error for all Serper search failures."""


class GoogleSearchAPIKeyMissing(GoogleSearchError):
    """SERPER_API_KEY is not set in backend/.env."""


class GoogleSearchTimeout(GoogleSearchError):
    """The Serper request timed out."""


class GoogleSearchProviderError(GoogleSearchError):
    """Serper returned an unexpected error."""


# ---------------------------------------------------------------------------
# Normalized internal schema — identical shape to web_search.py
# ---------------------------------------------------------------------------


class SearchResultItem(BaseModel):
    title: str
    url: str
    snippet: str   # Serper's snippet field, trimmed to ~250 chars
    domain: str    # extracted from URL, www. stripped


class SearchResponse(BaseModel):
    query: str
    results: list[SearchResultItem]
    result_count: int


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _extract_domain(url: str) -> str:
    try:
        netloc = urlparse(url).netloc
        return netloc.removeprefix("www.")
    except Exception:  # noqa: BLE001
        return url


def _trim_snippet(text: str, max_chars: int = 250) -> str:
    if len(text) <= max_chars:
        return text
    trimmed = text[:max_chars].rsplit(" ", 1)[0]
    return (trimmed or text[:max_chars]).rstrip(" .,;") + "\u2026"


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class SerperSearchService:
    """
    Serper.dev Google Search API wrapper.

    Endpoint: POST https://google.serper.dev/search
    Auth:     X-API-KEY header
    Body:     {"q": "query", "num": 10}
    Response: {"organic": [{"title", "link", "snippet", "displayLink", ...}]}

    Call ``search(query)`` — returns SearchResponse (same shape as web_search.py).

    Raises:
        GoogleSearchAPIKeyMissing  — SERPER_API_KEY not set
        GoogleSearchTimeout        — request timed out (15 s)
        GoogleSearchProviderError  — any other HTTP / network error
    """

    _DEFAULT_MAX_RESULTS = 10  # Serper max per request

    async def search(
        self,
        query: str,
        *,
        max_results: int = _DEFAULT_MAX_RESULTS,
    ) -> SearchResponse:
        if not settings.serper_api_key:
            raise GoogleSearchAPIKeyMissing(
                "SERPER_API_KEY must be set in backend/.env. "
                "Get a free API key (2 500 queries/month) at https://serper.dev"
            )

        headers = {
            "X-API-KEY": settings.serper_api_key,
            "Content-Type": "application/json",
        }
        payload = {
            "q": query,
            "num": min(max_results, 10),  # Serper max is 10 per request
        }

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(
                    _SERPER_SEARCH_URL,
                    headers=headers,
                    json=payload,
                )
                resp.raise_for_status()
                data = resp.json()
        except httpx.TimeoutException as exc:
            raise GoogleSearchTimeout(
                f"Serper request timed out: {exc}"
            ) from exc
        except httpx.HTTPStatusError as exc:
            status_code = exc.response.status_code
            if status_code in (401, 403):
                raise GoogleSearchAPIKeyMissing(
                    f"Serper returned {status_code}: check SERPER_API_KEY in backend/.env."
                ) from exc
            raise GoogleSearchProviderError(
                f"Serper HTTP error {status_code}: {exc}"
            ) from exc
        except Exception as exc:  # noqa: BLE001
            raise GoogleSearchProviderError(
                f"Serper unexpected error: {exc}"
            ) from exc

        organic = data.get("organic", [])
        normalized: list[SearchResultItem] = []
        for item in organic:
            raw_url = item.get("link", "")
            raw_snippet = item.get("snippet", "") or item.get("description", "")
            # Serper includes displayLink; fall back to parsing the URL
            domain = item.get("displayLink", "") or _extract_domain(raw_url)
            normalized.append(
                SearchResultItem(
                    title=(item.get("title") or "Untitled").strip(),
                    url=raw_url,
                    snippet=_trim_snippet(raw_snippet),
                    domain=domain.removeprefix("www."),
                )
            )

        return SearchResponse(
            query=query,
            results=normalized,
            result_count=len(normalized),
        )


# Module-level singleton — imported as ``google_search_service`` throughout
# the codebase so callers don't need to know which provider is used underneath.
google_search_service = SerperSearchService()
