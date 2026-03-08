"use client";

import {
  ChangeEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowUp,
  Check,
  ChevronRight,
  Code2,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Lock,
  Mic,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  Square,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { PageShell } from "@/components/shell/page-shell";
import { useVoiceInput } from "@/lib/use-voice-input";

import type { Project, ProjectArtifact } from "@/lib/projects-api";
import {
  deleteProject,
  getProject,
  listProjectArtifacts,
  listProjectSessions,
  pinProject,
  updateProject,
} from "@/lib/projects-api";
import { createSession } from "@/lib/sessions-api";

// ── helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatDateFull(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

type ProjectSession = {
  id: string;
  title: string;
  pinned: boolean;
  project_id: string | null;
  created_at: string;
  updated_at: string;
};

function getArtifactIcon(type: string) {
  if (type === "code" || type.startsWith("application/")) return <Code2 size={13} className="text-text-3" />;
  if (type === "image") return <ImageIcon size={13} className="text-text-3" />;
  return <FileText size={13} className="text-text-3" />;
}

// ── Instructions Modal ────────────────────────────────────────────────────────

function InstructionsModal({
  initial,
  onSave,
  onClose,
  isSaving,
}: {
  initial: string;
  onSave: (value: string) => void;
  onClose: () => void;
  isSaving: boolean;
}) {
  const [value, setValue] = useState(initial);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    const len = textareaRef.current?.value.length ?? 0;
    textareaRef.current?.setSelectionRange(len, len);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") onSave(value);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose, onSave, value]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-[680px] border border-border bg-surface-1 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-[14px] font-semibold text-text-1">Project Instructions</h2>
            <p className="mt-0.5 text-[12px] text-text-3">
              These instructions guide the AI in every chat in this project.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="icon-btn h-8 w-8 shrink-0"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Textarea */}
        <div className="p-5">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="You are a helpful assistant specialised in…"
            rows={12}
            className="w-full resize-none border border-border bg-surface-2 px-4 py-3 font-mono text-[13px] leading-relaxed text-text-1 placeholder:text-text-3 focus:border-[#1111d4] focus:outline-none"
          />
          <p className="mt-2 text-right text-[11px] text-text-3 opacity-60">
            ⌘ Enter to save · Esc to cancel
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 border-t border-border px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(value)}
            disabled={isSaving}
            className="btn-primary"
          >
            {isSaving ? "Saving…" : "Save instructions"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [project, setProject] = useState<Project | null>(null);
  const [sessions, setSessions] = useState<ProjectSession[]>([]);
  const [artifacts, setArtifacts] = useState<ProjectArtifact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);

  // Editing state
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState("");
  const [savedField, setSavedField] = useState<string | null>(null);

  // Instructions modal
  const [isInstructionsModalOpen, setIsInstructionsModalOpen] = useState(false);
  const [isSavingInstructions, setIsSavingInstructions] = useState(false);

  // Delete confirmation
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // More options menu
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuBtnRef = useRef<HTMLButtonElement>(null);

  // ── Composer state (mirrors chat-shell.tsx renderComposer) ───────────────
  const [prompt, setPrompt] = useState("");
  const [isStartingChat, setIsStartingChat] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<
    { id: string; file: File; url: string }[]
  >([]);
  const [isPlusMenuOpen, setIsPlusMenuOpen] = useState(false);
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const plusMenuBtnRef = useRef<HTMLButtonElement>(null);
  const [thinkEnabled, setThinkEnabled] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(true);
  const [deepResearchEnabled, setDeepResearchEnabled] = useState(false);

  // Voice input for composer
  const preVoicePromptRef = useRef("");
  const voice = useVoiceInput({
    onTranscript: (text, isFinal) => {
      const base = preVoicePromptRef.current;
      const sep = base.length > 0 && !base.endsWith(" ") ? " " : "";
      if (isFinal) {
        setPrompt(base + sep + text.trim() + " ");
      } else {
        setPrompt(base + sep + text);
      }
    },
  });
  const handleVoiceToggle = useCallback(() => {
    if (voice.state === "listening") {
      voice.stopListening();
    } else {
      preVoicePromptRef.current = prompt;
      voice.startListening();
    }
  }, [voice, prompt]);

  // Files card
  const projectFileInputRef = useRef<HTMLInputElement>(null);
  const [projectFiles, setProjectFiles] = useState<
    { id: string; name: string; size: number }[]
  >([]);

  // Library expand
  const [showAllArtifacts, setShowAllArtifacts] = useState(false);
  // Switch between chats and artifacts in the left column
  const [viewMode, setViewMode] = useState<"chats" | "artifacts">("chats");

  useEffect(() => {
    void (async () => {
      try {
        const [proj, sessList, artifactList] = await Promise.all([
          getProject(projectId),
          listProjectSessions(projectId),
          listProjectArtifacts(projectId),
        ]);
        setProject(proj);
        setSessions(sessList);
        setArtifacts(artifactList);
        setEditName(proj.name);
      } catch {
        router.push("/projects");
      } finally {
        setIsLoading(false);
        setIsLoadingSessions(false);
      }
    })();
  }, [projectId, router]);

  const flashSaved = (field: string) => {
    setSavedField(field);
    setTimeout(() => setSavedField(null), 2000);
  };

  const saveField = useCallback(
    async (
      field: "name" | "description" | "system_prompt",
      value: string,
    ) => {
      if (!project) return;
      try {
        const updated = await updateProject(projectId, { [field]: value });
        setProject(updated);
        flashSaved(field);
        if (field === "name") setIsEditingName(false);
      } catch {
        /* fail silently */
      }
    },
    [project, projectId],
  );

  const handleSaveInstructions = async (value: string) => {
    setIsSavingInstructions(true);
    try {
      const updated = await updateProject(projectId, { system_prompt: value });
      setProject(updated);
      setIsInstructionsModalOpen(false);
      flashSaved("system_prompt");
    } catch {
      /* fail silently */
    } finally {
      setIsSavingInstructions(false);
    }
  };

  const handleTogglePin = async () => {
    if (!project) return;
    try {
      const updated = await pinProject(projectId, !project.pinned);
      setProject(updated);
    } catch {
      /* fail silently */
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteProject(projectId);
      router.push("/projects");
    } catch {
      setIsDeleting(false);
      setConfirmDelete(false);
    }
  };

  // ── Composer helpers ─────────────────────────────────────────────────────

  const handleStartChat = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || isStartingChat) return;
    setIsStartingChat(true);
    try {
      const session = await createSession("New Chat", projectId);
      // If deep research is enabled, signal chat-shell via URL so it sets the
      // mode before auto-sending the message (Call 1 = generate clarifying questions)
      const deepParam = deepResearchEnabled ? "&deepResearch=true" : "";
      router.push(
        `/?session=${session.id}&message=${encodeURIComponent(trimmed)}&project=${projectId}${deepParam}`,
      );
    } catch {
      setIsStartingChat(false);
    }
  };

  const handleFilesSelected = (
    e: ChangeEvent<HTMLInputElement>,
  ) => {
    const files = e.target.files;
    if (!files) return;
    const items: typeof attachments = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const url = URL.createObjectURL(file);
      items.push({ id: crypto.randomUUID(), file, url });
    }
    setAttachments((prev) => [...prev, ...items]);
    e.target.value = "";
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      const item = prev.find((a) => a.id === id);
      if (item) URL.revokeObjectURL(item.url);
      return prev.filter((a) => a.id !== id);
    });
  };

  const handleProjectFileSelected = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setProjectFiles((prev) => [
        ...prev,
        { id: crypto.randomUUID(), name: file.name, size: file.size },
      ]);
    }
    e.target.value = "";
  };

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [prompt]);

  // Close menus on outside click
  useEffect(() => {
    if (!isMoreMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        !moreMenuRef.current?.contains(e.target as Node) &&
        !moreMenuBtnRef.current?.contains(e.target as Node)
      ) {
        setIsMoreMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isMoreMenuOpen]);

  useEffect(() => {
    if (!isPlusMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        !plusMenuRef.current?.contains(e.target as Node) &&
        !plusMenuBtnRef.current?.contains(e.target as Node)
      ) {
        setIsPlusMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isPlusMenuOpen]);

  // ── Loading ───────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg">
        <div className="thinking-indicator">
          <span className="thinking-dots">
            <span />
            <span />
            <span />
          </span>
          <span className="thinking-label">Loading…</span>
        </div>
      </div>
    );
  }

  if (!project) return null;

  const visibleArtifacts = showAllArtifacts ? artifacts : artifacts.slice(0, 4);

  return (
    <PageShell>
    <>
      {/* Instructions Modal */}
      {isInstructionsModalOpen && (
        <InstructionsModal
          initial={project.system_prompt}
          onSave={(v) => void handleSaveInstructions(v)}
          onClose={() => setIsInstructionsModalOpen(false)}
          isSaving={isSavingInstructions}
        />
      )}

      <div className="min-h-full bg-bg font-sans text-text-1">
        {/* ── Header ── */}
        <header className="sticky top-0 z-20 border-b border-border bg-bg">
          <div className="flex h-12 items-center gap-3 px-5">
            <div className="flex items-center gap-1.5 text-[12.5px] text-text-3">
              <Link href="/projects" className="hover:text-text-2 transition-colors">
                Projects
              </Link>
              <ChevronRight size={11} className="opacity-40" />
              <span className="truncate text-text-2">{project.name}</span>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1100px] px-5 pb-20 pt-8">
          {/* ── Title row ── */}
          <div className="mb-8 flex items-start justify-between gap-3">
            {isEditingName ? (
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={() => void saveField("name", editName)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveField("name", editName);
                  if (e.key === "Escape") {
                    setIsEditingName(false);
                    setEditName(project.name);
                  }
                }}
                className="min-w-0 flex-1 bg-transparent text-[2rem] font-bold tracking-[-0.02em] text-text-1 focus:outline-none"
                autoFocus
              />
            ) : (
              <h1
                className="flex-1 cursor-text text-[2rem] font-bold tracking-[-0.02em] text-text-1 hover:opacity-80 transition-opacity"
                onClick={() => setIsEditingName(true)}
                title="Click to rename"
              >
                {project.name}
              </h1>
            )}

            <div className="flex shrink-0 items-center gap-1 pt-2">
              {/* Star / Pin */}
              <button
                type="button"
                onClick={() => void handleTogglePin()}
                className={`icon-btn h-8 w-8 transition-colors ${project.pinned ? "text-text-1" : "text-text-3 opacity-50 hover:opacity-100"}`}
                aria-label={project.pinned ? "Unpin project" : "Pin project"}
                title={project.pinned ? "Unpin project" : "Pin project"}
              >
                <Star
                  size={15}
                  fill={project.pinned ? "currentColor" : "none"}
                  strokeWidth={project.pinned ? 0 : 1.5}
                />
              </button>

              {/* ⋯ more menu */}
              <div className="relative">
                <button
                  ref={moreMenuBtnRef}
                  type="button"
                  onClick={() => {
                    setIsMoreMenuOpen((v) => !v);
                    setConfirmDelete(false);
                  }}
                  className="icon-btn h-8 w-8"
                  aria-label="More options"
                >
                  <MoreHorizontal size={15} />
                </button>
                {isMoreMenuOpen && (
                  <div
                    ref={moreMenuRef}
                    className="absolute right-0 top-full mt-1 w-48 border border-border bg-surface-1 py-1 shadow-xl"
                    style={{ zIndex: 50 }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setIsMoreMenuOpen(false);
                        setIsEditingName(true);
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12.5px] text-text-2 transition-colors hover:bg-surface-3 hover:text-text-1"
                    >
                      <Pencil size={12} />
                      Rename project
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsMoreMenuOpen(false);
                        void handleTogglePin();
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12.5px] text-text-2 transition-colors hover:bg-surface-3 hover:text-text-1"
                    >
                      <Star size={12} />
                      {project.pinned ? "Unpin project" : "Pin project"}
                    </button>
                    <div className="mx-2 my-1 border-t border-border" />
                    {!confirmDelete ? (
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(true)}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12.5px] text-danger transition-colors hover:bg-surface-3"
                      >
                        <Trash2 size={12} />
                        Delete project
                      </button>
                    ) : (
                      <div className="px-3 py-2.5">
                        <p className="mb-2 text-[11.5px] text-text-2">
                          Delete this project?
                        </p>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={handleDelete}
                            disabled={isDeleting}
                            className="flex-1 border border-danger-border bg-danger-soft px-2 py-1.5 text-[11px] text-danger hover:bg-[rgba(180,100,100,0.14)] focus:outline-none"
                          >
                            {isDeleting ? "…" : "Delete"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(false)}
                            className="flex-1 border border-border px-2 py-1.5 text-[11px] text-text-3 hover:text-text-1 focus:outline-none"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Two-column layout ── */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_300px]">
            {/* ── LEFT column ── */}
            <div className="space-y-4">

              {/* ── Composer (identical to main app) ── */}
              <form
                className="composer-card"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleStartChat();
                }}
              >
                {/* ── Tool checkboxes row ─────────────────────────────── */}
                <div className="mb-2 flex flex-wrap items-center gap-3">
                  {/* Think */}
                  <label className="group flex cursor-pointer items-center gap-1.5">
                    <div
                      onClick={() => setThinkEnabled((v) => !v)}
                      className={`flex h-3 w-3 items-center justify-center border transition-colors ${
                        thinkEnabled ? "border-accent bg-accent" : "border-text-1 group-hover:bg-black/10"
                      }`}
                    >
                      {thinkEnabled && <Check size={8} className="text-white" strokeWidth={3} />}
                    </div>
                    <span className={`select-none text-[10px] font-bold uppercase tracking-widest ${
                      thinkEnabled ? "text-accent" : "text-text-3 group-hover:text-text-1"
                    }`}>Think</span>
                  </label>
                  {/* Search */}
                  <label className="group flex cursor-pointer items-center gap-1.5">
                    <div
                      onClick={() => setWebSearchEnabled((v) => !v)}
                      className={`flex h-3 w-3 items-center justify-center border transition-colors ${
                        webSearchEnabled ? "border-accent bg-accent" : "border-text-1 group-hover:bg-black/10"
                      }`}
                    >
                      {webSearchEnabled && <Check size={8} className="text-white" strokeWidth={3} />}
                    </div>
                    <span className={`select-none text-[10px] font-bold uppercase tracking-widest ${
                      webSearchEnabled ? "text-accent" : "text-text-3 group-hover:text-text-1"
                    }`}>Search</span>
                  </label>
                  {/* Research */}
                  <label className="group flex cursor-pointer items-center gap-1.5">
                    <div
                      onClick={() => setDeepResearchEnabled((v) => !v)}
                      className={`flex h-3 w-3 items-center justify-center border transition-colors ${
                        deepResearchEnabled ? "border-accent bg-accent" : "border-text-1 group-hover:bg-black/10"
                      }`}
                    >
                      {deepResearchEnabled && <Check size={8} className="text-white" strokeWidth={3} />}
                    </div>
                    <span className={`select-none text-[10px] font-bold uppercase tracking-widest ${
                      deepResearchEnabled ? "text-accent" : "text-text-3 group-hover:text-text-1"
                    }`}>Research</span>
                  </label>
                </div>

                {/* ── Inner white box: textarea + action row ───────────────── */}
                <div className="composer-input-box">
                  <textarea
                    ref={textareaRef}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        void handleStartChat();
                      }
                    }}
                    placeholder="Message Operator…"
                    aria-label="Message input"
                    className="composer-textarea"
                    rows={1}
                  />

                  {/* Attachment pills inside white box */}
                  {attachments.length > 0 && (
                    <div className="px-3 pt-1 flex flex-wrap gap-1.5">
                      {attachments.map((att) => (
                        <span key={att.id} className="tool-active-pill">
                          {att.file.type.startsWith("image/") ? (
                            <img src={att.url} className="h-3 w-3" alt="" />
                          ) : (
                            <Paperclip size={10} />
                          )}
                          <span className="truncate max-w-[60px]">{att.file.name}</span>
                          <button
                            type="button"
                            onClick={() => removeAttachment(att.id)}
                            className="ml-0.5 flex h-3 w-3 items-center justify-center opacity-50 hover:opacity-100 focus:outline-none"
                            aria-label="Remove"
                          >
                            <X size={8} strokeWidth={2.5} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Action row — Attach on left | Mic + Send on right */}
                  <div className="flex items-center justify-between px-2 pb-2 pt-1">
                    <div className="flex items-center gap-1">
                      {/* Attach trigger */}
                      <div className="relative">
                        <button
                          ref={plusMenuBtnRef}
                          type="button"
                          onClick={() => setIsPlusMenuOpen((v) => !v)}
                          className={`composer-action-btn${isPlusMenuOpen ? " border-text-3 text-text-2" : " text-text-3 hover:text-text-2"}`}
                          aria-label="Add attachments"
                          aria-haspopup="menu"
                          aria-expanded={isPlusMenuOpen}
                        >
                          <Paperclip size={13} />
                        </button>
                        {isPlusMenuOpen && (
                          <div
                            ref={plusMenuRef}
                            role="menu"
                            className="composer-dropdown composer-dropdown-up"
                          >
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setIsPlusMenuOpen(false);
                                imageInputRef.current?.click();
                              }}
                              className="composer-dropdown-item w-full text-left"
                            >
                              <ImageIcon size={13} className="shrink-0 text-text-3" />
                              <span>Add images</span>
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setIsPlusMenuOpen(false);
                                fileInputRef.current?.click();
                              }}
                              className="composer-dropdown-item w-full text-left"
                            >
                              <Paperclip size={13} className="shrink-0 text-text-3" />
                              <span>Add files</span>
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Mic on right side now */}
                    </div>

                    {/* Right: Mic + Send together */}
                    <div className="flex items-center gap-1">
                      {/* Mic / Voice button */}
                      {voice.isSupported && (
                        <button
                          type="button"
                          onClick={handleVoiceToggle}
                          className={`composer-action-btn transition-colors${
                            voice.state === "listening"
                              ? " border-[#2563eb] bg-[#2563eb] text-white"
                              : " text-text-3 hover:text-text-2"
                          }`}
                          aria-label={voice.state === "listening" ? "Stop recording" : "Voice input"}
                        >
                          <Mic size={13} />
                        </button>
                      )}

                      {/* Send / Stop */}
                      {isStartingChat ? (
                        <button
                          type="button"
                          className="composer-action-btn border-text-2 text-text-2"
                          aria-label="Starting chat"
                        >
                          <Square size={12} fill="currentColor" strokeWidth={0} />
                        </button>
                      ) : (
                        <button
                          type="submit"
                          disabled={!prompt.trim()}
                          className={`composer-action-btn transition-colors${
                            prompt.trim()
                              ? " border-[#2563eb] bg-[#2563eb] text-white hover:bg-[#1d4ed8] hover:border-[#1d4ed8]"
                              : " text-text-3 hover:text-text-2"
                          }`}
                          aria-label="Start chat"
                        >
                          <ArrowUp size={15} strokeWidth={2.5} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </form>

              {/* Hidden file inputs */}
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: "none" }}
                onChange={handleFilesSelected}
              />
              <input
                ref={fileInputRef}
                type="file"
                multiple
                style={{ display: "none" }}
                onChange={handleFilesSelected}
              />

              {/* ── Chat / Artifact switcher ── */}
              <div className="overflow-hidden border border-border bg-surface-1">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <div className="flex gap-4">
                    <button
                      type="button"
                      onClick={() => setViewMode("chats")}
                      className={`text-[12px] font-semibold ${viewMode === "chats" ? "text-text-1" : "text-text-3"}`}
                    >
                      Chats{sessions.length > 0 ? ` (${sessions.length})` : ""}
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("artifacts")}
                      className={`text-[12px] font-semibold ${viewMode === "artifacts" ? "text-text-1" : "text-text-3"}`}
                    >
                      Artifacts{artifacts.length > 0 ? ` (${artifacts.length})` : ""}
                    </button>
                  </div>
                  {viewMode === "chats" && (
                    <button
                      type="button"
                      onClick={() => void handleStartChat()}
                      className="icon-btn h-7 w-7"
                      aria-label="New chat"
                      title="New chat"
                      disabled={isStartingChat}
                    >
                      <Plus size={13} />
                    </button>
                  )}
                </div>

                {viewMode === "chats" ? (
                  <> 
                    {isLoadingSessions ? (
                      <div className="px-5 py-6 text-center">
                        <p className="text-[13px] text-text-3">Loading chats…</p>
                      </div>
                    ) : sessions.length === 0 ? (
                      <div className="px-6 py-8 text-center">
                        <p className="text-[13px] text-text-3">
                          No chats yet. Start typing above to begin.
                        </p>
                      </div>
                    ) : (
                      <ul className="divide-y divide-border">
                        {sessions.map((s) => (
                          <li key={s.id}>
                            <Link
                              href={`/?session=${s.id}&project=${projectId}`}
                              className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-surface-2"
                            >
                              <div className="flex min-w-0 items-center gap-2.5">
                                {s.pinned && (
                                  <Star
                                    size={10}
                                    fill="currentColor"
                                    strokeWidth={0}
                                    className="shrink-0 text-text-3"
                                  />
                                )}
                                <span className="truncate text-[13px] text-text-2 group-hover:text-text-1">
                                  {s.title}
                                </span>
                              </div>
                              <span className="ml-4 flex shrink-0 items-center gap-1 text-[11px] text-text-3">
                                {formatDate(s.updated_at)}
                                <ExternalLink size={9} className="opacity-40" />
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <> 
                    {artifacts.length === 0 ? (
                      <div className="px-6 py-8 text-center">
                        <p className="text-[13px] text-text-3">
                          No artifacts yet.
                        </p>
                      </div>
                    ) : (
                      <>
                        <ul className="divide-y divide-border">
                          {visibleArtifacts.map((art) => (
                            <li key={art.id}>
                              <Link
                                href={`/?session=${art.session_id}&artifact=${art.id}&project=${projectId}`}
                                className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-surface-2"
                              >
                                <div className="flex min-w-0 items-center gap-2.5">
                                  {getArtifactIcon(art.type)}
                                  <div className="min-w-0">
                                    <p className="truncate text-[13px] text-text-2">
                                      {art.title}
                                    </p>
                                    <p className="text-[11px] text-text-3 capitalize">
                                      {art.type}
                                    </p>
                                  </div>
                                </div>
                                <span className="ml-4 flex shrink-0 items-center gap-1 text-[11px] text-text-3">
                                  {formatDate(art.created_at)}
                                  <ExternalLink size={9} className="opacity-40" />
                                </span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                        {artifacts.length > 4 && (
                          <div className="border-t border-border px-4 py-3">
                            <button
                              type="button"
                              onClick={() => setShowAllArtifacts((v) => !v)}
                              className="text-[12px] text-text-3 hover:text-text-2 transition-colors"
                            >
                              {showAllArtifacts
                                ? "Show less"
                                : `Show all ${artifacts.length} artifacts`}
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            </div>{/* end LEFT column */}

            {/* ── RIGHT column ── */}
            <div className="space-y-4">

              {/* Memory card */}
              <div className="border border-border bg-surface-1 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-[13px] font-semibold text-text-1">Memory</h3>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-text-3">
                      Project memory builds automatically — key context from chats will appear here.
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 whitespace-nowrap border border-border bg-surface-2 px-2 py-0.5 text-[10.5px] text-text-3">
                    <Lock size={9} className="shrink-0" />
                    Only you
                  </span>
                </div>
              </div>

              {/* Instructions card */}
              <div className="border border-border bg-surface-1 p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-[13px] font-semibold text-text-1">Instructions</h3>
                  <button
                    type="button"
                    onClick={() => setIsInstructionsModalOpen(true)}
                    className="icon-btn h-7 w-7"
                    aria-label="Edit instructions"
                  >
                    <Pencil size={12} />
                  </button>
                </div>
                {project.system_prompt ? (
                  <div>
                    <p className="line-clamp-[8] text-[12px] leading-relaxed text-text-2">
                      {project.system_prompt}
                    </p>
                    {savedField === "system_prompt" && (
                      <p className="mt-2 flex items-center gap-1 text-[11px] text-text-3">
                        <Check size={10} /> Saved
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => setIsInstructionsModalOpen(true)}
                      className="mt-2 text-[12px] text-text-3 underline underline-offset-2 hover:text-text-2 transition-colors"
                    >
                      Edit
                    </button>
                  </div>
                ) : (
                  <p className="text-[12px] italic text-text-3">
                    No instructions yet.{" "}
                    <button
                      type="button"
                      onClick={() => setIsInstructionsModalOpen(true)}
                      className="not-italic text-text-2 underline underline-offset-2 hover:text-text-1 transition-colors"
                    >
                      Add instructions
                    </button>
                  </p>
                )}
              </div>

              {/* Files card */}
              <div className="border border-border bg-surface-1 p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-[13px] font-semibold text-text-1">Files</h3>
                  <button
                    type="button"
                    onClick={() => projectFileInputRef.current?.click()}
                    className="icon-btn h-7 w-7"
                    aria-label="Add file"
                    title="Add file"
                  >
                    <Plus size={13} />
                  </button>
                </div>
                <input
                  ref={projectFileInputRef}
                  type="file"
                  multiple
                  style={{ display: "none" }}
                  onChange={handleProjectFileSelected}
                />

                {projectFiles.length === 0 ? (
                  <div
                    className="flex flex-col items-center border border-dashed border-border py-6 text-center transition-colors hover:border-border-strong cursor-pointer"
                    onClick={() => projectFileInputRef.current?.click()}
                  >
                    <div className="mb-2.5 flex items-end gap-1 opacity-20">
                      <FileText size={24} className="text-text-3" />
                      <FileText size={18} className="mb-0.5 text-text-3" />
                    </div>
                    <p className="text-[12px] text-text-3">
                      Drop files or click to upload
                    </p>
                    <p className="mt-0.5 text-[11px] text-text-3 opacity-60">
                      PDFs, text documents, code files
                    </p>
                  </div>
                ) : (
                  <ul className="space-y-1.5">
                    {projectFiles.map((f) => (
                      <li
                        key={f.id}
                        className="flex items-center gap-2.5 px-2 py-1.5 hover:bg-surface-2"
                      >
                        <FileText size={13} className="shrink-0 text-text-3" />
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-2">
                          {f.name}
                        </span>
                        <span className="shrink-0 text-[11px] text-text-3">
                          {(f.size / 1024).toFixed(0)}K
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setProjectFiles((prev) =>
                              prev.filter((pf) => pf.id !== f.id),
                            )
                          }
                          className="icon-btn h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100"
                          aria-label="Remove file"
                        >
                          <X size={10} />
                        </button>
                      </li>
                    ))}
                    <li>
                      <button
                        type="button"
                        onClick={() => projectFileInputRef.current?.click()}
                        className="flex w-full items-center gap-2 px-2 py-1.5 text-[12px] text-text-3 hover:text-text-2 transition-colors"
                      >
                        <Plus size={12} />
                        Add more files
                      </button>
                    </li>
                  </ul>
                )}
              </div>

              {/* Project meta */}
              <div className="border border-border bg-surface-1 p-5">
                <h3 className="mb-3 text-[13px] font-semibold text-text-1">About</h3>
                <dl className="space-y-2">
                  <div className="flex justify-between gap-2">
                    <dt className="text-[12px] text-text-3">Chats</dt>
                    <dd className="text-[12px] text-text-2">{project.session_count}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-[12px] text-text-3">Artifacts</dt>
                    <dd className="text-[12px] text-text-2">{artifacts.length}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-[12px] text-text-3">Created</dt>
                    <dd className="text-[12px] text-text-2">{formatDateFull(project.created_at)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-[12px] text-text-3">Updated</dt>
                    <dd className="text-[12px] text-text-2">{formatDateFull(project.updated_at)}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>
        </main>
      </div>
    </>
    </PageShell>
  );
}
