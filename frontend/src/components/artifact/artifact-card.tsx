"use client";

import { FileText, Globe } from "lucide-react";

import type { Artifact } from "@/lib/artifacts-api";
import { DownloadMenu } from "@/components/artifact/download-menu";

// ── Shared helper ─────────────────────────────────────────────────────────────

type ArtifactCardProps = {
  artifact: Artifact;
  onOpen: (id: string) => void;
};

type ArtifactMeta = { label: string; badge: string };

function artifactMeta(type: string): ArtifactMeta {
  switch (type.toLowerCase()) {
    case "html":
      return { label: "Web page · HTML", badge: "HTML" };
    case "code":
      return { label: "Code", badge: "CODE" };
    default:
      return { label: "Markdown document", badge: "MD" };
  }
}

// ── ArtifactCard: shown in chat after artifact is complete ────────────────────

export function ArtifactCard({ artifact, onOpen }: ArtifactCardProps) {
  const meta = artifactMeta(artifact.type);
  const isHtml = artifact.type.toLowerCase() === "html";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(artifact.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(artifact.id);
        }
      }}
      className="artifact-chat-card group"
      aria-label={`Open artifact: ${artifact.title}`}
    >
      {/* Icon */}
      <div className="artifact-chat-card-icon" aria-hidden="true">
        {isHtml ? <Globe size={16} /> : <FileText size={16} />}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-text-1">
          {artifact.title}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="artifact-type-badge">{meta.badge}</span>
          <span className="text-[11px] text-text-3">{meta.label}</span>
        </div>
      </div>

      {/* Download menu */}
      <DownloadMenu
        variant="card"
        artifactId={artifact.id}
        title={artifact.title}
        content={artifact.content}
        artifactType={artifact.type}
      />
    </div>
  );
}

// ── StreamingArtifactCard: shown in chat WHILE artifact is being written ──────

type StreamingArtifactCardProps = {
  /** Title extracted from the opening <artifact> tag (may be "Artifact" briefly) */
  title: string;
  /** Type from opening tag: "html" | "markdown" | "code" */
  type: string;
  /** Click handler — focuses / opens the artifact panel */
  onOpen: () => void;
};

export function StreamingArtifactCard({
  title,
  type,
  onOpen,
}: StreamingArtifactCardProps) {
  const meta = artifactMeta(type);
  const isHtml = type.toLowerCase() === "html";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="artifact-chat-card group"
      aria-label={`Writing artifact: ${title}`}
    >
      {/* Icon */}
      <div className="artifact-chat-card-icon" aria-hidden="true">
        {isHtml ? <Globe size={16} /> : <FileText size={16} />}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-text-1">
          {title && title !== "Artifact" ? (
            title
          ) : (
            <span className="text-text-3 italic">Initializing…</span>
          )}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="artifact-type-badge">{meta.badge}</span>
          <span className="text-[11px] text-text-3">{meta.label}</span>
        </div>
      </div>

      {/* Animated writing indicator */}
      <div className="flex shrink-0 items-center gap-1.5 px-1">
        <span className="thinking-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className="text-[11px] text-text-3 whitespace-nowrap">Writing…</span>
      </div>
    </div>
  );
}
