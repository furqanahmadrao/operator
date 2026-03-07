"use client";

import { Download, FileText } from "lucide-react";

import type { Artifact } from "@/lib/artifacts-api";
import { downloadArtifact } from "@/lib/artifacts-api";

type FilesPanelProps = {
  open: boolean;
  artifacts: Artifact[];
  selectedArtifactId: string | null;
  onSelectArtifact: (id: string) => void;
  onDeleteArtifact: (id: string) => void;
  onClose: () => void;
};

export function FilesPanel({
  open,
  artifacts,
  selectedArtifactId,
  onSelectArtifact,
  onClose,
}: FilesPanelProps) {
  const handleDownload = async (
    e: React.MouseEvent,
    artifact: Artifact,
  ) => {
    e.stopPropagation();
    try {
      await downloadArtifact(artifact.id, artifact.title);
    } catch {
      // fail silently
    }
  };

  return (
    <aside
      aria-label="Session files"
      aria-hidden={!open}
      className={`flex h-full shrink-0 flex-col overflow-hidden border-l transition-[width] duration-200 ease-out ${
        open
          ? "w-[220px] border-[rgba(255,255,255,0.05)]"
          : "w-0 border-transparent"
      }`}
      style={{ background: "#131313" }}
    >
      {/* List — no header label, just the items */}
      <nav className="flex-1 overflow-y-auto py-2" aria-label="Files list">
        {artifacts.length === 0 ? (
          <p className="px-4 py-3 text-[12px] text-text-3">No files yet.</p>
        ) : (
          <ul className="space-y-px px-2">
            {artifacts.map((artifact) => (
              <li key={artifact.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectArtifact(artifact.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectArtifact(artifact.id);
                    }
                  }}
                  className={`group flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors duration-100 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus-ring ${
                    artifact.id === selectedArtifactId
                      ? "bg-surface-2 text-text-1"
                      : "text-text-3 hover:text-text-2"
                  }`}
                >
                  <FileText size={12} className="shrink-0 text-text-3" />
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">
                    {artifact.title}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => void handleDownload(e, artifact)}
                    className="shrink-0 rounded-md p-1 text-text-3 opacity-0 transition-all duration-100 hover:bg-surface-3 hover:text-text-2 focus-visible:outline-none focus-visible:opacity-100 group-hover:opacity-100"
                    aria-label={`Download ${artifact.title}`}
                    title="Download"
                  >
                    <Download size={11} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </nav>
    </aside>
  );
}
