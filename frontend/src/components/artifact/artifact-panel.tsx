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
      {/* Header */}
      <div className="artifact-panel-header">

        {/* LEFT: Preview / Code toggle */}
        <div className="flex shrink-0 items-center gap-1">
          <div className="artifact-panel-toggle" role="group" aria-label="View mode">
            <button
              type="button"
              onClick={() => setViewMode("preview")}
              className={`artifact-panel-toggle-btn ${
                viewMode === "preview" ? "artifact-panel-toggle-btn-active" : ""
              }`}
              aria-pressed={viewMode === "preview"}
              title="Preview"
            >
              <Eye size={13} />
              <span>Preview</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("code")}
              className={`artifact-panel-toggle-btn ${
                viewMode === "code" ? "artifact-panel-toggle-btn-active" : ""
              }`}
              aria-pressed={viewMode === "code"}
              title="Code"
            >
              <Code2 size={13} />
              <span>Code</span>
            </button>
          </div>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* RIGHT: Writing indicator (streaming) or Copy + Download + Close */}
        <div className="flex shrink-0 items-center gap-1">
          {isStreaming ? (
            <div className="flex items-center gap-1.5 px-1">
              <span className="thinking-dots">
                <span />
                <span />
                <span />
              </span>
              <span className="text-[11px] text-text-3">Writing…</span>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={handleCopy}
                disabled={!displayArtifact}
                className="artifact-panel-action-btn"
                aria-label={copied ? "Copied!" : "Copy content"}
                title={copied ? "Copied!" : "Copy"}
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
                <span>{copied ? "Copied!" : "Copy"}</span>
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
            className="artifact-action-btn"
            aria-label="Close artifact panel"
            title="Close"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="artifact-panel-body">
        {displayArtifact ? (
          viewMode === "preview" ? (
            displayArtifact.type.toLowerCase() === "html" ? (
              /* ── HTML: live sandboxed iframe ── */
              <iframe
                key={displayArtifact.id || "streaming"}
                srcDoc={displayArtifact.content}
                sandbox="allow-scripts allow-modals allow-forms allow-popups"
                className="artifact-panel-iframe"
                title={displayArtifact.title}
              />
            ) : (
              /* ── Markdown: rendered prose ── */
              <div className="markdown-content">
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
            /* Raw source view (both types) */
            <pre className="artifact-panel-raw">
              <code>{displayArtifact.content}</code>
            </pre>
          )
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-[13px] text-text-3">No artifact selected</p>
          </div>
        )}
      </div>
    </div>
  );
}
