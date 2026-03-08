"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Folder, FolderOpen, Plus, X } from "lucide-react";
import { PageShell } from "@/components/shell/page-shell";

import type { Project } from "@/lib/projects-api";
import { createProject, listProjects } from "@/lib/projects-api";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const list = await listProjects();
        setProjects(list);
      } catch {
        // fail silently
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setIsSaving(true);
    try {
      const project = await createProject({
        name: newName.trim(),
        description: newDesc.trim(),
      });
      setProjects((prev) => [project, ...prev]);
      setNewName("");
      setNewDesc("");
      setIsCreating(false);
    } catch {
      // fail silently
    } finally {
      setIsSaving(false);
    }
  };

  const cancelCreate = () => {
    setIsCreating(false);
    setNewName("");
    setNewDesc("");
  };

  return (
    <PageShell>
    <div className="min-h-full bg-bg font-sans text-text-1">
      {/* Sticky top bar */}
      <header className="sticky top-0 z-10 border-b border-border bg-bg">
        <div className="flex h-12 items-center gap-4 px-5">
          <div className="flex items-center gap-2">
            <FolderOpen size={14} className="shrink-0 text-text-3" />
            <h1 className="text-[13px] font-semibold text-text-1">Projects</h1>
          </div>

          <button
            type="button"
            onClick={() => setIsCreating(true)}
            className="btn-secondary ml-auto"
          >
            <Plus size={13} />
            New project
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[960px] px-5 py-8">
        {/* ── Create form ── */}
        {isCreating && (
          <div className="mb-6 border border-border bg-surface-1 p-5">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-[13px] font-semibold text-text-1">
                New project
              </p>
              <button
                type="button"
                onClick={cancelCreate}
                className="icon-btn h-7 w-7"
                aria-label="Cancel"
              >
                <X size={13} />
              </button>
            </div>

            <div className="space-y-3">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleCreate();
                  if (e.key === "Escape") cancelCreate();
                }}
                placeholder="Project name…"
                className="w-full border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-1 placeholder:text-text-3 focus:border-[#1111d4] focus:outline-none"
                autoFocus
              />
              <textarea
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Short description (optional)…"
                rows={2}
                className="w-full resize-none border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-1 placeholder:text-text-3 focus:border-[#1111d4] focus:outline-none"
              />
            </div>

            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={handleCreate}
                disabled={!newName.trim() || isSaving}
                className="btn-primary"
              >
                {isSaving ? "Creating…" : "Create project"}
              </button>
              <button
                type="button"
                onClick={cancelCreate}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── Loading ── */}
        {isLoading && (
          <div className="flex items-center justify-center py-28">
            <div className="thinking-indicator">
              <span className="thinking-dots">
                <span />
                <span />
                <span />
              </span>
              <span className="thinking-label">Loading…</span>
            </div>
          </div>
        )}

        {/* ── Empty state ── */}
        {!isLoading && projects.length === 0 && (
          <div className="flex flex-col items-center justify-center py-28 text-center">
            <Folder size={36} className="mb-5 text-text-3 opacity-30" />
            <p className="text-[15px] font-semibold text-text-2">
              No projects yet
            </p>
            <p className="mt-1.5 max-w-[340px] text-[13px] text-text-3">
              Projects let you group chats with a shared custom system prompt —
              like Claude&apos;s Projects or ChatGPT&apos;s GPTs.
            </p>
            <button
              type="button"
              onClick={() => setIsCreating(true)}
              className="btn-secondary mt-6 text-[12.5px]"
            >
              <Plus size={13} />
              Create your first project
            </button>
          </div>
        )}

        {/* ── Project grid ── */}
        {!isLoading && projects.length > 0 && (
          <div className="project-grid">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="project-card"
              >
                {/* Icon + name row */}
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-border bg-[rgba(17,17,212,0.05)]">
                    <FolderOpen size={15} className="text-[#1111d4]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-text-1">
                      {project.name}
                    </p>
                    <p className="text-[11px] text-text-3">
                      {project.session_count}{" "}
                      {project.session_count === 1 ? "chat" : "chats"}
                    </p>
                  </div>
                </div>

                {/* Description */}
                {project.description && (
                  <p className="line-clamp-2 text-[12px] leading-relaxed text-text-3">
                    {project.description}
                  </p>
                )}

                {/* Updated date */}
                <p className="text-[11px] text-text-3 opacity-50">
                  Updated {formatDate(project.updated_at)}
                </p>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
    </PageShell>
  );
}
