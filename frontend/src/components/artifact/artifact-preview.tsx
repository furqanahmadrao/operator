"use client";

import { useState } from "react";
import { Check, Code2, Copy, Download, FileText } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { Artifact } from "@/lib/artifacts-api";
import { downloadArtifact } from "@/lib/artifacts-api";
import { CodeBlock } from "@/components/chat/code-block";

type ArtifactPreviewProps = {
  artifact: Artifact;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ArtifactTypeIcon({ type }: { type: string }) {
  const t = type.toLowerCase();
  if (t === "code" || t.startsWith("code/") || t === "script") {
    return <Code2 size={14} className="text-text-3" />;
  }
  return <FileText size={14} className="text-text-3" />;
}

export function ArtifactPreview({ artifact }: ArtifactPreviewProps) {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(artifact.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fail silently
    }
  };

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadArtifact(artifact.id, artifact.title);
    } catch {
      // fail silently
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="artifact-preview">
      {/* Header */}
      <div className="artifact-preview-header">
        <ArtifactTypeIcon type={artifact.type} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13px] font-semibold leading-tight text-text-1">
            {artifact.title}
          </h3>
          <p className="mt-0.5 flex items-center gap-2 text-[11px] text-text-3">
            <span className="uppercase tracking-wider">{artifact.type}</span>
            <span className="h-1 w-1 shrink-0 bg-text-3 opacity-50" />
            <span>{formatDate(artifact.created_at)}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={handleCopy}
            className="artifact-action-btn"
            aria-label={copied ? "Copied!" : "Copy markdown"}
            title="Copy markdown"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="artifact-action-btn"
            aria-label="Download as .md"
            title="Download .md"
            disabled={downloading}
          >
            <Download size={13} />
          </button>
        </div>
      </div>

      {/* Markdown content */}
      <div className="artifact-preview-body">
        <div className="markdown-content">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              // Suppress <pre> wrapper — CodeBlock renders its own
              pre: ({ children }) => <>{children}</>,
              code: CodeBlock,
              a: ({ ...props }) => (
                <a {...props} target="_blank" rel="noopener noreferrer" />
              ),
            }}
          >
            {artifact.content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
