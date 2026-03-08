"use client";

import { useState } from "react";
import { Check, Code2, Copy, Eye, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { Artifact } from "@/lib/artifacts-api";
import { CodeBlock } from "@/components/chat/code-block";
import { DownloadMenu } from "@/components/artifact/download-menu";

type ArtifactPanelProps = {
  artifact: Artifact | null;
  /** Partial artifact being streamed — shown when artifact is not yet complete */
  streamingArtifact?: { title: string; type: string; content: string } | null;
  onClose: () => void;
};

type ViewMode = "preview" | "code";

export function ArtifactPanel({ artifact, streamingArtifact, onClose }: ArtifactPanelProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const [copied, setCopied] = useState(false);

  // Determine what to display — prefer real artifact, fall back to streaming preview
  const displayArtifact = artifact ?? (
    streamingArtifact
      ? { id: "", title: streamingArtifact.title, type: streamingArtifact.type, content: streamingArtifact.content, session_id: "", source_message_id: null, created_at: "", updated_at: "" }
      : null
  );
  const isStreaming = !artifact && !!streamingArtifact;

  const handleCopy = async () => {
    if (!displayArtifact) return;
    try {
      await navigator.clipboard.writeText(displayArtifact.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fail silently
    }
  };

  return (
    <div className="artifact-panel">
      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-bg px-0">

        {/* LEFT: Tab buttons (border-b-2 underline style) */}
        <div className="flex h-full items-stretch">
          <button
            type="button"
            onClick={() => setViewMode("preview")}
            className={`flex h-full items-center gap-1.5 px-4 text-xs font-bold uppercase tracking-wide transition-colors hover:bg-black/5 ${
              viewMode === "preview"
                ? "border-b-2 border-accent text-accent"
                : "border-b-2 border-transparent text-text-3 hover:text-text-1"
            }`}
            aria-pressed={viewMode === "preview"}
          >
            <Eye size={12} />
            Preview
          </button>
          <button
            type="button"
            onClick={() => setViewMode("code")}
            className={`flex h-full items-center gap-1.5 px-4 text-xs font-bold uppercase tracking-wide transition-colors hover:bg-black/5 ${
              viewMode === "code"
                ? "border-b-2 border-accent text-accent"
                : "border-b-2 border-transparent text-text-3 hover:text-text-1"
            }`}
            aria-pressed={viewMode === "code"}
          >
            <Code2 size={12} />
            Code
          </button>
        </div>

        {/* RIGHT: Writing indicator / Copy / Download / Close */}
        <div className="flex shrink-0 items-center gap-1 pr-3">
          {isStreaming ? (
            <div className="flex items-center gap-1.5 px-2">
              <span className="thinking-dots">
                <span />
                <span />
                <span />
              </span>
              <span className="text-[10px] font-mono uppercase tracking-widest text-text-3">Writing…</span>
            </div>
          ) : (
            <>
              {/* Version badge */}
              {artifact && artifact.version > 1 && (
                <span className="mr-1 text-[10px] font-mono text-text-3 opacity-50">v{artifact.version}</span>
              )}
              <button
                type="button"
                onClick={handleCopy}
                disabled={!displayArtifact}
                className="flex items-center gap-1.5 border border-border bg-bg px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-text-2 transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={copied ? "Copied!" : "Copy content"}
              >
                {copied ? <Check size={11} /> : <Copy size={11} />}
                {copied ? "Copied!" : "Copy"}
              </button>
              <DownloadMenu
                variant="icon"
                artifactId={artifact?.id ?? ""}
                title={artifact?.title ?? ""}
                content={artifact?.content ?? ""}
                artifactType={artifact?.type ?? "markdown"}
              />
            </>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center text-text-3 transition-colors hover:bg-surface-3 hover:text-text-1"
            aria-label="Close artifact panel"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* ── Canvas / Viewport ──────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-auto bg-bg">
        {displayArtifact ? (
          <div className="flex h-full min-h-[400px] w-full flex-col bg-surface-1">
            {/* Content area — no browser chrome, content fills directly */}
            <div className="min-h-0 flex-1 overflow-auto">
              {viewMode === "preview" ? (
                displayArtifact.type.toLowerCase() === "html" ? (
                  /* HTML: live sandboxed iframe */
                  <iframe
                    key={`${displayArtifact.id || "streaming"}-${displayArtifact.updated_at || ""}`}
                    srcDoc={displayArtifact.content}
                    sandbox="allow-scripts allow-modals allow-forms allow-popups"
                    className="artifact-panel-iframe"
                    title={displayArtifact.title}
                  />
                ) : (
                  /* Markdown: rendered prose */
                  <div className="markdown-content p-6">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        pre: ({ children }) => <>{children}</>,
                        code: CodeBlock,
                        a: ({ ...props }) => (
                          <a {...props} target="_blank" rel="noopener noreferrer" />
                        ),
                      }}
                    >
                      {displayArtifact.content}
                    </ReactMarkdown>
                  </div>
                )
              ) : (
                /* Raw source */
                <pre className="artifact-panel-raw p-4">
                  <code>{displayArtifact.content}</code>
                </pre>
              )}
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-[12px] font-mono uppercase tracking-widest text-text-3">No_Artifact_Selected</p>
          </div>
        )}
      </div>
    </div>
  );
}
