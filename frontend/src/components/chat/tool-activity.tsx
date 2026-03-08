"use client";

import { useState } from "react";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Globe,
} from "lucide-react";

import type { SearchResultItem } from "@/lib/chat-api";

// ─────────────────────────────────────────────────────────────────────────────
//  GENERIC TOOL BLOCK
//  Used for ALL tools: web search, date check, and future capabilities
//  (sandbox, computer use, research, etc.) — same consistent UI pattern.
// ─────────────────────────────────────────────────────────────────────────────

interface ToolBlockProps {
  status: "running" | "completed" | "error";
  /** Leading icon element */
  icon: React.ReactNode;
  /** Primary label text */
  title: string;
  /** Optional pill badge — source count, date/time, etc. */
  badge?: React.ReactNode;
  /** Italic subordinate text — shows search query while running */
  subtitle?: string;
  /** Expandable body content — makes the header a toggle button */
  children?: React.ReactNode;
  /** Start expanded? Default: false (collapsed) */
  defaultExpanded?: boolean;
}

export function ToolBlock({
  status,
  icon,
  title,
  badge,
  subtitle,
  children,
  defaultExpanded = false,
}: ToolBlockProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const isExpandable = status === "completed" && !!children;

  const headerContent = (
    <>
      {/* Status indicator */}
      {status === "running" ? (
        <span className="tb-spinner" aria-hidden="true" />
      ) : status === "completed" ? (
        <CheckCircle2 size={11} className="tb-check" aria-hidden="true" />
      ) : (
        <AlertCircle size={11} className="tb-error-icon" aria-hidden="true" />
      )}

      {/* Tool icon */}
      <span className="tb-icon" aria-hidden="true">
        {icon}
      </span>

      {/* Title */}
      <span className="tb-title">{title}</span>

      {/* Badge pill */}
      {badge !== undefined && <span className="tb-badge">{badge}</span>}

      {/* Italic query / subtitle */}
      {subtitle && (
        <span className="tb-subtitle">&ldquo;{subtitle}&rdquo;</span>
      )}

      {/* Chevron — only on expandable blocks */}
      {isExpandable && (
        <span className="tb-chevron" aria-hidden="true">
          {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </span>
      )}
    </>
  );

  return (
    <div className="tool-block">
      {isExpandable ? (
        <button
          type="button"
          className="tb-header tb-header-clickable"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {headerContent}
        </button>
      ) : (
        <div className="tb-header">{headerContent}</div>
      )}

      {/* Expandable body */}
      {isExpandable && expanded && (
        <div className="tb-body">{children}</div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  DATE CHECK BLOCK
// ─────────────────────────────────────────────────────────────────────────────

interface DateCheckBlockProps {
  date: string;
  time: string;
}

export function DateCheckBlock({ date, time }: DateCheckBlockProps) {
  return (
    <ToolBlock
      status="completed"
      icon={<Calendar size={11} />}
      title={`Today is ${date}`}
      badge={time}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  WEB SEARCH BLOCK  (running / completed with sources / error)
// ─────────────────────────────────────────────────────────────────────────────

interface WebSearchBlockProps {
  status: "running" | "completed" | "error";
  query: string;
  results?: SearchResultItem[];
  resultCount?: number;
  errorMessage?: string;
}

export function WebSearchBlock({
  status,
  query,
  results = [],
  resultCount = 0,
  errorMessage,
}: WebSearchBlockProps) {
  const hasResults = status === "completed" && results.length > 0;

  return (
    <ToolBlock
      status={status}
      icon={<Globe size={11} />}
      title={
        status === "running"
          ? "Searching the web"
          : status === "error"
            ? (errorMessage ?? "Search failed")
            : "Searched the web"
      }
      badge={
        status === "completed" && resultCount > 0
          ? `${resultCount} ${resultCount === 1 ? "source" : "sources"}`
          : undefined
      }
      subtitle={query || undefined}
      defaultExpanded={false}
    >
              {hasResults ? (
        <div className="tb-sources">
          {results.map((result, idx) => (
            <a
              key={`${result.url}-${idx}`}
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
              className="tb-source-item"
              title={result.title}
            >
              <div className="tb-source-domain-row">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(result.domain)}&sz=16`}
                  width={12}
                  height={12}
                  alt=""
                  aria-hidden="true"
                  className="tb-source-favicon"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
                <span className="tb-source-domain">{result.domain}</span>
              </div>
              <p className="tb-source-title">{result.title}</p>
              {result.snippet && (
                <p className="tb-source-snippet">{result.snippet}</p>
              )}
            </a>
          ))}
        </div>
      ) : null}

    </ToolBlock>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Legacy named exports for backward compatibility
// ─────────────────────────────────────────────────────────────────────────────

export const DateCheckChip = DateCheckBlock;

export function SearchRunningChip({ query }: { query: string }) {
  return <WebSearchBlock status="running" query={query} />;
}

export function SearchDoneChip({
  query,
  resultCount,
  results,
}: {
  query: string;
  resultCount: number;
  results?: SearchResultItem[];
  onOpenSources?: () => void;
}) {
  return (
    <WebSearchBlock
      status="completed"
      query={query}
      resultCount={resultCount}
      results={results}
    />
  );
}

export function SearchErrorChip({ message }: { message?: string }) {
  return <WebSearchBlock status="error" query="" errorMessage={message} />;
}

// Legacy ToolActivity — still accepted by some older render paths
interface ToolActivityProps {
  status: "running" | "completed" | "error";
  query: string;
  result_count?: number;
  message?: string;
}

export function ToolActivity({
  status,
  query,
  result_count,
  message,
}: ToolActivityProps) {
  return (
    <WebSearchBlock
      status={status}
      query={query}
      resultCount={result_count}
      errorMessage={message}
    />
  );
}

