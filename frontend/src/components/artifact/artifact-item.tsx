"use client";

import { useState } from "react";
import { Code2, FileText, Table, Trash2 } from "lucide-react";

import type { Artifact } from "@/lib/artifacts-api";

type ArtifactItemProps = {
  artifact: Artifact;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: (id: string) => void;
};

/** Relative date label — e.g. "just now", "2h ago", "Mar 5" */
function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Pick an icon based on the artifact's type string */
function ArtifactIcon({ type }: { type: string }) {
  const t = type.toLowerCase();
  if (t === "code" || t.startsWith("code/") || t === "script") {
    return <Code2 size={13} className="shrink-0 text-text-3" />;
  }
  if (t === "data" || t === "table" || t === "csv") {
    return <Table size={13} className="shrink-0 text-text-3" />;
  }
  return <FileText size={13} className="shrink-0 text-text-3" />;
}

export function ArtifactItem({ artifact, isSelected, onSelect, onDelete }: ArtifactItemProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(true);
  };

  const handleConfirmDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(artifact.id);
  };

  const handleCancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
  };

  return (
    /* Outer wrapper is a div (not button) to avoid invalid button-in-button nesting */
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`artifact-item group ${isSelected ? "artifact-item-active" : ""}`}
      aria-current={isSelected ? "true" : undefined}
      aria-pressed={isSelected}
    >
      {confirmDelete ? (
        /* Confirm delete inline — stopPropagation so the row click doesn't fire */
        <div className="flex w-full items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <span className="flex-1 truncate text-[12px] text-danger">Delete this file?</span>
          <button
            type="button"
            onClick={handleConfirmDelete}
            className="text-[11px] font-medium text-danger hover:text-red-400 focus:outline-none"
            aria-label="Confirm delete"
          >
            Yes
          </button>
          <button
            type="button"
            onClick={handleCancelDelete}
            className="text-[11px] font-medium text-text-3 hover:text-text-2 focus:outline-none"
            aria-label="Cancel delete"
          >
            No
          </button>
        </div>
      ) : (
        <>
          <ArtifactIcon type={artifact.type} />
          <span className="min-w-0 flex-1 truncate text-left text-[13px] text-text-2">
            {artifact.title}
          </span>
          <span className="shrink-0 text-[11px] text-text-3 opacity-0 transition-opacity group-hover:opacity-100">
            {relativeDate(artifact.created_at)}
          </span>
          {/* Delete button — nested button is fine inside div; visible on hover */}
          <button
            type="button"
            onClick={handleDeleteClick}
            className="shrink-0 rounded p-0.5 text-text-3 opacity-0 transition-all hover:text-text-1 group-hover:opacity-100 focus:outline-none"
            aria-label={`Delete ${artifact.title}`}
          >
            <Trash2 size={12} />
          </button>
        </>
      )}
    </div>
  );
}
