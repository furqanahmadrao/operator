"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Globe } from "lucide-react";
import type { SearchResultItem } from "@/lib/chat-api";

interface SearchResultsGroupProps {
  query: string;
  results: SearchResultItem[];
  resultCount: number;
  /** Whether the results list starts expanded (default: true) */
  defaultExpanded?: boolean;
}

/**
 * A collapsible card showing grouped web search results.
 * Displayed both live during streaming and when loading from a persisted session.
 */
export function SearchResultsGroup({
  query,
  results,
  resultCount,
  defaultExpanded = true,
}: SearchResultsGroupProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="search-results-group">
      {/* ── Header row (always visible) ──────────────────────────────── */}
      <button
        type="button"
        className="search-results-header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={`${expanded ? "Collapse" : "Expand"} search results for: ${query}`}
      >
        <Globe size={12} className="search-results-icon" aria-hidden="true" />

        <span className="search-results-query" title={query}>
          {query}
        </span>

        {resultCount > 0 && (
          <span className="search-results-badge" aria-label={`${resultCount} sources`}>
            {resultCount} {resultCount === 1 ? "source" : "sources"}
          </span>
        )}

        {expanded ? (
          <ChevronUp size={12} className="search-results-chevron" aria-hidden="true" />
        ) : (
          <ChevronDown size={12} className="search-results-chevron" aria-hidden="true" />
        )}
      </button>

      {/* ── Results list ─────────────────────────────────────────────── */}
      {expanded && (
        <div className="search-results-list">
          {results.length === 0 ? (
            <p className="search-results-empty">No results found.</p>
          ) : (
            results.map((result, idx) => (
              <a
                key={`${result.url}-${idx}`}
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="search-result-item"
                title={result.title}
              >
                {/* Domain row */}
                <div className="search-result-domain-row">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(result.domain)}&sz=16`}
                    width={12}
                    height={12}
                    alt=""
                    aria-hidden="true"
                    className="search-result-favicon"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                  <span className="search-result-domain">{result.domain}</span>
                </div>

                {/* Title */}
                <p className="search-result-title">{result.title}</p>

                {/* Snippet */}
                {result.snippet && (
                  <p className="search-result-snippet">{result.snippet}</p>
                )}
              </a>
            ))
          )}
        </div>
      )}
    </div>
  );
}
