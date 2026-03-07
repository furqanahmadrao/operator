"use client";

import { Globe, X } from "lucide-react";

import type { SearchResultItem } from "@/lib/chat-api";

type SourcesSidebarProps = {
  open: boolean;
  query: string;
  results: SearchResultItem[];
  onClose: () => void;
};

/**
 * A sliding right-side panel that shows web search source results.
 * Triggered by clicking the "Searched the web · N sources" tool chip.
 */
export function SourcesSidebar({
  open,
  query,
  results,
  onClose,
}: SourcesSidebarProps) {
  return (
    <aside
      aria-label="Search sources"
      aria-hidden={!open}
      className={`sources-sidebar ${open ? "sources-sidebar-open" : ""}`}
    >
      {/* Header */}
      <div className="sources-sidebar-header">
        <div className="sources-sidebar-title">
          <Globe size={12} aria-hidden="true" />
          <span>Sources</span>
          {results.length > 0 && (
            <span className="sources-sidebar-count">{results.length}</span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="icon-btn h-7 w-7 shrink-0"
          aria-label="Close sources panel"
        >
          <X size={13} />
        </button>
      </div>

      {/* Query label */}
      {query && (
        <div className="sources-sidebar-query">
          &ldquo;{query}&rdquo;
        </div>
      )}

      {/* Source list */}
      <nav className="sources-sidebar-list" aria-label="Search results">
        {results.length === 0 ? (
          <p className="sources-sidebar-empty">No sources found.</p>
        ) : (
          results.map((result, idx) => (
            <a
              key={`${result.url}-${idx}`}
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
              className="source-item"
              title={result.title}
            >
              {/* Domain row */}
              <div className="source-item-domain-row">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(result.domain)}&sz=16`}
                  width={12}
                  height={12}
                  alt=""
                  aria-hidden="true"
                  className="source-item-favicon"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
                <span className="source-item-domain">{result.domain}</span>
              </div>

              {/* Title */}
              <p className="source-item-title">{result.title}</p>

              {/* Snippet */}
              {result.snippet && (
                <p className="source-item-snippet">{result.snippet}</p>
              )}
            </a>
          ))
        )}
      </nav>
    </aside>
  );
}
