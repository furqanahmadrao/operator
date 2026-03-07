"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
  Code2,
  FileText,
  Globe,
  Search,
  X,
} from "lucide-react";

import type { ArtifactWithSession } from "@/lib/artifacts-api";
import { listAllArtifacts } from "@/lib/artifacts-api";

// ── Types ─────────────────────────────────────────────────────────────────────

type TypeFilter = "all" | "html" | "markdown" | "code";

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeType(type: string): Exclude<TypeFilter, "all"> {
  const t = type.toLowerCase();
  if (t === "html") return "html";
  if (t === "code" || t === "script" || t.startsWith("code")) return "code";
  return "markdown";
}

function typeLabel(type: string): string {
  switch (normalizeType(type)) {
    case "html":
      return "HTML";
    case "code":
      return "Code";
    default:
      return "Markdown";
  }
}

function ArtifactTypeIcon({ type }: { type: string }) {
  const t = normalizeType(type);
  if (t === "html") return <Globe size={14} className="text-text-3" />;
  if (t === "code") return <Code2 size={14} className="text-text-3" />;
  return <FileText size={14} className="text-text-3" />;
}

function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) {
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: days > 365 ? "numeric" : undefined,
  });
}

function getDateGroup(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "This week";
  if (days < 30) return "This month";
  const date = new Date(iso);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// ── Type filter config ────────────────────────────────────────────────────────

const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "html", label: "HTML" },
  { value: "markdown", label: "Markdown" },
  { value: "code", label: "Code" },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LibraryPage() {
  const [artifacts, setArtifacts] = useState<ArtifactWithSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  useEffect(() => {
    void (async () => {
      try {
        const list = await listAllArtifacts();
        // Sort newest-first
        list.sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );
        setArtifacts(list);
      } catch {
        /* fail silently */
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // ── Counts for filter tabs ────────────────────────────────────────────────
  const counts: Record<TypeFilter, number> = {
    all: artifacts.length,
    html: artifacts.filter((a) => normalizeType(a.type) === "html").length,
    markdown: artifacts.filter((a) => normalizeType(a.type) === "markdown").length,
    code: artifacts.filter((a) => normalizeType(a.type) === "code").length,
  };

  // ── Apply search + type filter ────────────────────────────────────────────
  const q = search.trim().toLowerCase();
  const filtered = artifacts.filter((a) => {
    const matchesType =
      typeFilter === "all" || normalizeType(a.type) === typeFilter;
    const matchesSearch =
      !q ||
      a.title.toLowerCase().includes(q) ||
      a.session_title.toLowerCase().includes(q);
    return matchesType && matchesSearch;
  });

  // ── Group by relative date ────────────────────────────────────────────────
  const dateGroups: Array<{ label: string; items: ArtifactWithSession[] }> = [];
  for (const artifact of filtered) {
    const label = getDateGroup(artifact.created_at);
    const last = dateGroups[dateGroups.length - 1];
    if (last && last.label === label) {
      last.items.push(artifact);
    } else {
      dateGroups.push({ label, items: [artifact] });
    }
  }

  return (
    <div className="min-h-dvh bg-bg font-sans text-text-1">
      {/* ── Sticky header ─────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 border-b border-[rgba(255,255,255,0.06)] bg-bg/95 backdrop-blur-md">
        <div className="mx-auto max-w-[960px] px-5">

          {/* Top row: back, title, search */}
          <div className="flex items-center gap-4 py-3.5">
            <Link href="/" className="icon-btn h-8 w-8" aria-label="Back to chat">
              <ArrowLeft size={15} />
            </Link>

            <div className="flex items-center gap-2">
              <BookOpen size={15} className="shrink-0 text-text-3" />
              <h1 className="text-[14px] font-semibold text-text-1">Library</h1>
              {!isLoading && artifacts.length > 0 && (
                <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-text-3">
                  {artifacts.length}
                </span>
              )}
            </div>

            {/* Search */}
            <div className="ml-auto flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-1.5 focus-within:border-border-strong">
              <Search size={12} className="shrink-0 text-text-3" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search artifacts..."
                className="w-44 bg-transparent text-[13px] text-text-1 placeholder:text-text-3 focus:outline-none"
                aria-label="Search artifacts"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="flex items-center text-text-3 hover:text-text-2 transition-colors"
                  aria-label="Clear search"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          </div>

          {/* Type filter tabs */}
          {!isLoading && artifacts.length > 0 && (
            <div className="flex items-center gap-1 pb-3">
              {TYPE_FILTERS.map(({ value, label }) => {
                if (value !== "all" && counts[value] === 0) return null;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTypeFilter(value)}
                    className={`library-filter-tab ${
                      typeFilter === value ? "library-filter-tab-active" : ""
                    }`}
                    aria-pressed={typeFilter === value}
                  >
                    {label}
                    <span className="library-filter-count">{counts[value]}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </header>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-[960px] px-5 py-8">

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-28">
            <div className="thinking-indicator">
              <span className="thinking-dots">
                <span />
                <span />
                <span />
              </span>
              <span className="thinking-label">Loading...</span>
            </div>
          </div>
        )}

        {/* Empty: no artifacts at all */}
        {!isLoading && artifacts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-28 text-center">
            <BookOpen size={36} className="mb-5 text-text-3 opacity-30" />
            <p className="text-[15px] font-semibold text-text-2">No artifacts yet</p>
            <p className="mt-1.5 max-w-[320px] text-[13px] text-text-3">
              When the AI generates code, documents, or pages in a chat, they appear
              here for easy access.
            </p>
            <Link href="/" className="mt-6 btn-secondary text-[12.5px]">
              Start a chat
            </Link>
          </div>
        )}

        {/* No results after filtering */}
        {!isLoading && artifacts.length > 0 && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-[14px] text-text-3">
              No{typeFilter !== "all" ? ` ${typeFilter.toUpperCase()}` : ""} artifacts
              {q ? ` matching "${search}"` : ""}
            </p>
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setTypeFilter("all");
              }}
              className="mt-3 text-[13px] text-text-3 underline underline-offset-2 hover:text-text-2"
            >
              Clear filters
            </button>
          </div>
        )}

        {/* Date-grouped results */}
        {!isLoading && filtered.length > 0 && (
          <div className="space-y-8">
            {dateGroups.map(({ label, items }) => (
              <section key={label}>
                {/* Date group header */}
                <h2 className="mb-3 flex items-center gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-text-3">
                    {label}
                  </span>
                  <span className="flex-1 border-t border-border opacity-40" />
                  <span className="shrink-0 text-[11px] text-text-3 opacity-50">
                    {items.length} {items.length === 1 ? "artifact" : "artifacts"}
                  </span>
                </h2>

                {/* Artifact list */}
                <div className="library-list">
                  {items.map((artifact) => (
                    <Link
                      key={artifact.id}
                      href={`/?session=${artifact.session_id}&artifact=${artifact.id}`}
                      className="library-card group"
                    >
                      {/* Type icon */}
                      <div className="library-card-icon">
                        <ArtifactTypeIcon type={artifact.type} />
                      </div>

                      {/* Title + session */}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-text-1 transition-colors group-hover:text-text-1">
                          {artifact.title}
                        </p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-text-3">
                          <span className="library-type-badge">{typeLabel(artifact.type)}</span>
                          <span className="opacity-40">·</span>
                          <span className="truncate">{artifact.session_title}</span>
                        </p>
                      </div>

                      {/* Date */}
                      <span className="shrink-0 text-[11px] text-text-3 tabular-nums pl-4">
                        {formatRelativeDate(artifact.created_at)}
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
