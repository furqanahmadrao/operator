"use client";

import {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowUp, Check, ChevronLeft, ChevronRight, Copy, Files, FolderOpen, Image as ImageIcon, Lightbulb, Menu, Microscope, Paperclip, Pencil, Plus, Search as SearchIcon, SlidersHorizontal, Square, SquarePen, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { ChatErrorBanner } from "@/components/chat/chat-error-banner";
import { CodeBlock } from "@/components/chat/code-block";
import { WebSearchBlock } from "@/components/chat/tool-activity";
import { SessionSidebar } from "@/components/shell/session-sidebar";
import { FilesPanel } from "@/components/shell/files-panel";
import { ArtifactPanel } from "@/components/artifact/artifact-panel";
import { ArtifactCard, StreamingArtifactCard } from "@/components/artifact/artifact-card";
import type {
  ChatMessage,
  ToolActivityPayload,
  SearchResultsPayload,
  ToolEvent,
  SearchResultItem,
} from "@/lib/chat-api";
import { streamSessionChat } from "@/lib/chat-api";
import type { Session } from "@/lib/sessions-api";
import {
  createSession,
  deleteSession,
  getSession,
  listSessions,
  pinSession,
  renameSession,
} from "@/lib/sessions-api";
import type { Artifact } from "@/lib/artifacts-api";
import { deleteArtifact, listArtifacts } from "@/lib/artifacts-api";
import type { Project } from "@/lib/projects-api";
import { listProjects } from "@/lib/projects-api";

// ── Constants ─────────────────────────────────────────────────────────────────

const SUGGESTIONS = [
  "Explain how large language models work",
  "Write a Python script to read and process a CSV file",
  "What are the best practices for designing a REST API?",
];

const USER_INITIALS = "FA";
const USER_NAME = "Furqan";

// Matches <artifact ...>...</artifact> regardless of attribute order
const ARTIFACT_BLOCK_RE =
  /<artifact\b[^>]*>[\s\S]*?<\/artifact>/g;

const ARTIFACT_OPEN_RE = /<artifact\b/;

function stripArtifactBlock(content: string): string {
  return content.replace(ARTIFACT_BLOCK_RE, "").replace(/\x00/g, "").trim();
}

/** Sentinel placed at the artifact's position so the card renders inline. */
const ARTIFACT_SENTINEL = "\x00";

/**
 * Replaces a completed <artifact>…</artifact> block with the sentinel,
 * preserving any text that comes before or after it.
 */
function injectArtifactSentinel(content: string): string {
  return content.replace(ARTIFACT_BLOCK_RE, ARTIFACT_SENTINEL);
}

/**
 * Splits content around the artifact position so the ArtifactCard can be
 * rendered inline. Handles both:
 *   - sentinel (messages modified during current session)
 *   - raw <artifact> block (messages restored from the DB)
 */
function splitAroundArtifact(content: string): [string, string] {
  const sentinelIdx = content.indexOf(ARTIFACT_SENTINEL);
  if (sentinelIdx !== -1) {
    return [
      content.substring(0, sentinelIdx).trim(),
      content.substring(sentinelIdx + 1).trim(),
    ];
  }
  // DB-loaded messages still have the raw <artifact> block
  const startIdx = content.search(/<artifact\b/);
  if (startIdx !== -1) {
    const closeTag = content.indexOf("</artifact>", startIdx);
    const endIdx = closeTag !== -1 ? closeTag + "</artifact>".length : startIdx;
    return [
      content.substring(0, startIdx).trim(),
      content.substring(endIdx).trim(),
    ];
  }
  return [content.trim(), ""];
}

/** Strips both complete and in-progress (unclosed) artifact blocks. */
function stripPartialArtifactBlock(content: string): string {
  // First remove any fully completed blocks
  let result = content.replace(ARTIFACT_BLOCK_RE, "").trim();
  // Then truncate at any opening <artifact that hasn't been closed yet
  const idx = result.search(ARTIFACT_OPEN_RE);
  if (idx !== -1) {
    result = result.substring(0, idx).trim();
  }
  return result;
}

/** Parse partial streaming artifact metadata + content from raw message content. */
function parseStreamingArtifact(
  content: string,
): { title: string; type: string; content: string } | null {
  const startIdx = content.indexOf("<artifact");
  if (startIdx === -1) return null;
  const tagEnd = content.indexOf(">", startIdx);
  if (tagEnd === -1) return null;
  const tag = content.substring(startIdx, tagEnd + 1);
  const titleMatch = tag.match(/title="([^"]*)"/);
  const typeMatch = tag.match(/type="([^"]*)"/);
  const bodyStart = tagEnd + 1;
  const closeTag = content.indexOf("</artifact>", bodyStart);
  const partialContent =
    closeTag !== -1
      ? content.substring(bodyStart, closeTag)
      : content.substring(bodyStart);
  return {
    title: titleMatch?.[1] ?? "Artifact",
    type: typeMatch?.[1] ?? "markdown",
    content: partialContent,
  };
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ChatShell() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Session state
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(false);

  // Deep-link: artifact to auto-open after session loads
  const pendingArtifactIdRef = useRef<string | null>(null);
  const deepLinkProcessedRef = useRef(false);
  // Auto-send: message to send once a linked session finishes loading
  const pendingMessageRef = useRef<string | null>(null);

  // Artifact / Files panel state
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [isFilesPanelOpen, setIsFilesPanelOpen] = useState(false);
  // Inline split-pane artifact viewer
  const [isArtifactPanelOpen, setIsArtifactPanelOpen] = useState(false);
  // Artifact panel width in px (right side). Min ~200, max controlled by CSS.
  const [artifactPanelWidth, setArtifactPanelWidth] = useState(() =>
    typeof window !== "undefined" ? Math.floor(window.innerWidth / 2) : 560,
  );
  const isResizingRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(0);

  // Chat state
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [lastPrompt, setLastPrompt] = useState("");

  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const [thinkingSeconds, setThinkingSeconds] = useState(0);
  const [thoughtForSeconds, setThoughtForSeconds] = useState<number | null>(null);
  const [streamPaused, setStreamPaused] = useState(false);
  const thinkingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const thinkingSecondsRef = useRef(0);
  const hasReceivedFirstTokenRef = useRef(false);
  /** Set to true when the user manually closes the artifact panel during streaming.
   *  Prevents auto-open from fighting the user's intent. Reset at each new message. */
  const userClosedPanelRef = useRef(false);

  // ── Projects + composer project mode ───────────────────────────────────────
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [isPlusMenuOpen, setIsPlusMenuOpen] = useState(false);
  const [plusMenuPage, setPlusMenuPage] = useState<"main" | "projects">("main");
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const plusMenuBtnRef = useRef<HTMLButtonElement>(null);

  // ── Attachments (images/files) ───────────────────────────────────────────
  const [attachments, setAttachments] = useState<
    { id: string; file: File; url: string }[]
  >([]);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Tools menu ──────────────────────────────────────────────────────────────
  const [isToolsMenuOpen, setIsToolsMenuOpen] = useState(false);
  const toolsMenuRef = useRef<HTMLDivElement>(null);
  const toolsMenuBtnRef = useRef<HTMLButtonElement>(null);
  const [thinkEnabled, setThinkEnabled] = useState(false);
  const [deepResearchEnabled, setDeepResearchEnabled] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(true);
  // Ref that always holds the current value — used inside the sendMessage
  // useCallback to avoid a stale closure (webSearchEnabled is NOT in the dep array).
  const webSearchEnabledRef = useRef(webSearchEnabled);
  useEffect(() => { webSearchEnabledRef.current = webSearchEnabled; }, [webSearchEnabled]);


  // ── Web search tool state ─────────────────────────────────────────────────
  const [activeToolActivity, setActiveToolActivity] =
    useState<ToolActivityPayload | null>(null);
  const [activeSearchResults, setActiveSearchResults] =
    useState<SearchResultsPayload | null>(null);
  /** Accumulates tool events during streaming; baked into the message on completion */
  const pendingToolEventsRef = useRef<ToolEvent[]>([]);
  const lastTokenTimeRef = useRef<number>(0);
  /** Date/time from the most recent date_check tool event (shown live during streaming) */
  const [pendingDateCheck, setPendingDateCheck] = useState<{ date: string; time: string } | null>(null);

  // ── Streaming artifact state (live preview while artifact streams) ─────────
  const [streamingArtifact, setStreamingArtifact] = useState<{
    title: string;
    type: string;
    content: string;
  } | null>(null);

  const streamingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamGenRef = useRef(0);

  // When we create a brand-new session mid-stream we must NOT trigger the
  // session-load effect (it would wipe messages and discard live tokens).
  const skipNextSessionLoadRef = useRef(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLElement>(null);
  const isNearBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  const greeting = useMemo(() => getGreeting(), []);

  const showEmptyState = useMemo(
    () => messages.length === 0 && !isStreaming && !isLoadingSession,
    [isStreaming, isLoadingSession, messages.length],
  );

  // ── Bootstrap sessions + handle deep-link URL params ─────────────────────
  useEffect(() => {
    void listSessions().then(setSessions).catch(() => {});
    void listProjects().then(setProjects).catch(() => {});

    // Process ?session=<id>&artifact=<id>&message=<msg>&project=<id> deep-link once on mount
    if (deepLinkProcessedRef.current) return;
    deepLinkProcessedRef.current = true;
    const sessionId = searchParams.get("session");
    const artifactId = searchParams.get("artifact");
    const messageParam = searchParams.get("message");
    const projectParam = searchParams.get("project");
    if (sessionId) {
      if (artifactId) pendingArtifactIdRef.current = artifactId;
      if (messageParam) {
        // Store as pending so it auto-sends once the session finishes loading
        pendingMessageRef.current = decodeURIComponent(messageParam);
      }
      if (projectParam) setActiveProjectId(projectParam);
      setCurrentSessionId(sessionId);
      // Clean the URL without triggering a navigation
      router.replace("/", { scroll: false });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load session when currentSessionId changes ────────────────────────────
  useEffect(() => {
    if (!currentSessionId) return;

    // Skip loading when the session was just created during an active stream;
    // the caller already seeded messages and will stream into them.
    if (skipNextSessionLoadRef.current) {
      skipNextSessionLoadRef.current = false;
      return;
    }

    let cancelled = false;

    void (async () => {
      setIsLoadingSession(true);
      setMessages([]);
      setArtifacts([]);
      setSelectedArtifactId(null);
      try {
        const [sessionData, artifactList] = await Promise.all([
          getSession(currentSessionId),
          listArtifacts(currentSessionId),
        ]);
        if (cancelled) return;
        const chatMessages: ChatMessage[] = sessionData.messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => {
            // Restore persisted tool events from metadata_json
            let toolEvents: ToolEvent[] | undefined;
            if (m.role === "assistant" && m.metadata_json) {
              try {
                const meta = JSON.parse(m.metadata_json) as {
                  tool_events?: ToolEvent[];
                };
                if (Array.isArray(meta.tool_events) && meta.tool_events.length > 0) {
                  toolEvents = meta.tool_events;
                }
              } catch {
                /* malformed metadata — ignore */
              }
            }
            return {
              role: m.role as ChatMessage["role"],
              content:
                m.role === "assistant" ? stripArtifactBlock(m.content) : m.content,
              artifactId: m.artifact_id ?? undefined,
              toolEvents,
            };
          });
        setMessages(chatMessages);
        setArtifacts(artifactList);

        // Auto-open artifact from deep-link
        const pendingId = pendingArtifactIdRef.current;
        if (pendingId) {
          pendingArtifactIdRef.current = null;
          if (artifactList.some((a) => a.id === pendingId)) {
            setSelectedArtifactId(pendingId);
            setIsArtifactPanelOpen(true);
            setArtifactPanelWidth(
              typeof window !== "undefined" ? Math.floor(window.innerWidth / 2) : 560,
            );
          }
        }
      } catch {
        // Graceful degradation
      } finally {
        if (!cancelled) setIsLoadingSession(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-send pending message once session finishes loading ───────────────
  const pendingSendRef = useRef(false);
  useEffect(() => {
    if (isLoadingSession) return;
    if (!pendingMessageRef.current) return;
    if (pendingSendRef.current) return;
    const msg = pendingMessageRef.current;
    pendingMessageRef.current = null;
    pendingSendRef.current = true;
    void sendMessage(msg).finally(() => {
      pendingSendRef.current = false;
    });
  }, [isLoadingSession]);

  // ── Smart scroll ──────────────────────────────────────────────────────────
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    isNearBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  useEffect(() => {
    if (!isNearBottomRef.current) return;
    messagesEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (isStreaming) {
      isNearBottomRef.current = true;
      messagesEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    }
  }, [isStreaming]);

  // ── Auto-resize textareas ─────────────────────────────────────────────────
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [prompt]);

  useEffect(() => {
    const el = editTextareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 300)}px`;
  }, [editValue]);

  // ── Mid-stream pause detection ────────────────────────────────────────────
  // If we've received at least one token but no new token arrives for 4s,
  // show a "Still generating…" indicator to keep the user informed.
  useEffect(() => {
    if (!isStreaming) {
      setStreamPaused(false);
      return;
    }
    const intervalId = setInterval(() => {
      if (
        hasReceivedFirstTokenRef.current &&
        Date.now() - lastTokenTimeRef.current > 4000
      ) {
        setStreamPaused(true);
      }
    }, 1000);
    return () => clearInterval(intervalId);
  }, [isStreaming]);

  // ── Close files panel automatically when there are no artifacts ─────────
  useEffect(() => {
    if (artifacts.length === 0) {
      setIsFilesPanelOpen(false);
      setIsArtifactPanelOpen(false);
      setSelectedArtifactId(null);
    }
  }, [artifacts.length]);

  // ── Close panels on Escape ────────────────────────────────────────────────
  useEffect(() => {
    if (!isSidebarOpen && !isFilesPanelOpen && !isArtifactPanelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsSidebarOpen(false);
        setIsFilesPanelOpen(false);
        // Don't close artifact panel on Escape — user can click X
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isSidebarOpen, isFilesPanelOpen, isArtifactPanelOpen]);

  // ── Track streaming artifact to give live preview in the panel ───────────
  useEffect(() => {
    if (!isStreaming) {
      setStreamingArtifact(null);
      return;
    }
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant" || lastMsg.artifactId) return;
    if (!lastMsg.content.includes("<artifact")) return;

    const parsed = parseStreamingArtifact(lastMsg.content);
    if (parsed) {
      setStreamingArtifact(parsed);
      // Auto-open artifact panel when artifact starts streaming,
      // but only if the user hasn't manually closed it this turn
      if (!isArtifactPanelOpen && !userClosedPanelRef.current) {
        setIsArtifactPanelOpen(true);
        setIsFilesPanelOpen(false);
        setArtifactPanelWidth(
          typeof window !== "undefined" ? Math.floor(window.innerWidth / 2) : 560,
        );
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, isStreaming]);

  // ── Resizable divider mouse handling ─────────────────────────────────────
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = artifactPanelWidth;

    const onMove = (ev: MouseEvent) => {
      if (!isResizingRef.current) return;
      // Dragging left increases artifact width, right decreases it
      const delta = resizeStartXRef.current - ev.clientX;
      const newWidth = Math.max(320, Math.min(900, resizeStartWidthRef.current + delta));
      setArtifactPanelWidth(newWidth);
    };
    const onUp = () => {
      isResizingRef.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [artifactPanelWidth]);

  // ── Stream helpers ────────────────────────────────────────────────────────
  const appendAssistantPlaceholder = () => {
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
  };

  const appendAssistantToken = (token: string) => {
    lastTokenTimeRef.current = Date.now();
    setStreamPaused(false);
    if (!hasReceivedFirstTokenRef.current) {
      hasReceivedFirstTokenRef.current = true;
      if (thinkingTimerRef.current) {
        clearInterval(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }
      setThoughtForSeconds(thinkingSecondsRef.current);
    }
    setMessages((prev) => {
      if (!prev.length) return prev;
      const next = [...prev];
      const last = next[next.length - 1];
      if (last.role !== "assistant") return next;
      next[next.length - 1] = { ...last, content: `${last.content}${token}` };
      return next;
    });
  };

  const stopStreaming = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  // ── Attachment helpers ───────────────────────────────────────────────────

  const handleFilesSelected = (
    e: ChangeEvent<HTMLInputElement>,
    type: "image" | "file",
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
    // reset input so same file can be selected again if needed
    e.target.value = "";
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  // Clear attachments when starting a new chat or sending
  const clearAttachments = () => {
    setAttachments((prev) => {
      prev.forEach((a) => URL.revokeObjectURL(a.url));
      return [];
    });
  };

  // ── Session helpers ───────────────────────────────────────────────────────

  const refreshSessions = useCallback(async () => {
    try {
      const list = await listSessions();
      setSessions(list);
    } catch {
      /* silent */
    }
  }, []);

  const ensureSession = useCallback(async (): Promise<string> => {
    if (currentSessionId) return currentSessionId;
    const session = await createSession("New Chat", activeProjectId ?? undefined);
    setSessions((prev) => [session, ...prev]);
    // Signal the session-load effect to skip — we're already streaming into
    // the message list; loading from the (empty) DB would wipe it.
    skipNextSessionLoadRef.current = true;
    setCurrentSessionId(session.id);
    return session.id;
  }, [currentSessionId, activeProjectId]);

  // ── Send message ──────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (value: string, priorMessages?: ChatMessage[]) => {
      const trimmed = value.trim();
      if (!trimmed || streamingRef.current) return;

      const myGen = ++streamGenRef.current;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      streamingRef.current = true;
      setErrorMessage("");
      setLastPrompt(trimmed);
      setPrompt("");
      clearAttachments();
      setIsStreaming(true);
      userClosedPanelRef.current = false; // reset so new artifact can auto-open panel

      const base = priorMessages ?? messages;
      setMessages([...base, { role: "user", content: trimmed }]);
      appendAssistantPlaceholder();

      hasReceivedFirstTokenRef.current = false;
      lastTokenTimeRef.current = Date.now();
      setStreamPaused(false);
      thinkingSecondsRef.current = 0;
      setThinkingSeconds(0);
      setThoughtForSeconds(null);
      thinkingTimerRef.current = setInterval(() => {
        thinkingSecondsRef.current += 1;
        setThinkingSeconds(thinkingSecondsRef.current);
      }, 1000);

      try {
        const sessionId = await ensureSession();

        // Reset search state for this turn
        pendingToolEventsRef.current = [];
        setActiveToolActivity(null);
        setActiveSearchResults(null);

        await streamSessionChat(
          sessionId,
          trimmed,
          appendAssistantToken,
          (artifact) => {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role !== "assistant") return prev;
              return [
                ...prev.slice(0, -1),
                // Sentinel preserves the artifact's position for inline card rendering
                { ...last, content: injectArtifactSentinel(last.content), artifactId: artifact.id },
              ];
            });
            setArtifacts((prev) =>
              prev.some((a) => a.id === artifact.id) ? prev : [...prev, artifact],
            );
            setSelectedArtifactId(artifact.id);
            // Only open panel if the user hasn't manually closed it during this turn
            if (!userClosedPanelRef.current) {
              setIsArtifactPanelOpen(true);
              setIsFilesPanelOpen(false);
              setArtifactPanelWidth(
                typeof window !== "undefined" ? Math.floor(window.innerWidth / 2) : 560,
              );
            }
            void refreshSessions();
          },
          // onToolActivity — update live status row
          (activity) => {
            if (activity.tool === "date_check") {
              // Show date check reactively + record as pending tool event
              setPendingDateCheck({ date: activity.date, time: activity.time });
              pendingToolEventsRef.current = [
                ...pendingToolEventsRef.current.filter((e) => e.type !== "date_check"),
                {
                  type: "date_check" as const,
                  date: activity.date,
                  time: activity.time,
                  timestamp: new Date().toISOString(),
                },
              ];
            } else {
              // web_search running or error
              setActiveToolActivity(activity);
              if (activity.status === "running") {
                setActiveSearchResults(null);
              } else if (activity.status === "error") {
                pendingToolEventsRef.current = [
                  ...pendingToolEventsRef.current,
                  {
                    type: "web_search" as const,
                    status: "error" as const,
                    query: activity.query,
                    result_count: 0,
                    results: [],
                    search_id: crypto.randomUUID(),
                    timestamp: new Date().toISOString(),
                    message: activity.message,
                  },
                ];
              }
            }
          },
          // onSearchResults — update live results card
          (results) => {
            setActiveSearchResults(results);
            setActiveToolActivity(null);
            // Stage for baking into the message on stream completion
            pendingToolEventsRef.current = [
              {
                type: "web_search",
                status: "completed",
                query: results.query,
                result_count: results.result_count,
                results: results.results,
                search_id: results.search_id,
                timestamp: new Date().toISOString(),
              },
            ];
          },
          controller.signal,
          webSearchEnabledRef.current,
        );

        void refreshSessions();
      } catch (error) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && !last.content) return prev.slice(0, -1);
          return prev;
        });
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Something went wrong while streaming.",
          );
        }
      } finally {
        if (thinkingTimerRef.current) {
          clearInterval(thinkingTimerRef.current);
          thinkingTimerRef.current = null;
        }
        if (streamGenRef.current === myGen) {
          // Bake any pending tool events into the last assistant message
          if (pendingToolEventsRef.current.length > 0) {
            const baked = pendingToolEventsRef.current;
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (!last || last.role !== "assistant") return prev;
              return [...prev.slice(0, -1), { ...last, toolEvents: baked }];
            });
            pendingToolEventsRef.current = [];
          }
          setActiveToolActivity(null);
          setActiveSearchResults(null);
          setStreamingArtifact(null);
          abortControllerRef.current = null;
          streamingRef.current = false;
          setIsStreaming(false);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages, currentSessionId, ensureSession, refreshSessions],
  );

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await sendMessage(prompt);
  };

  const onTextareaKeyDown = async (
    e: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      await sendMessage(prompt);
    }
  };

  const retryLastPrompt = async () => {
    if (!lastPrompt || isStreaming) return;
    await sendMessage(lastPrompt);
  };

  // ── Session management ────────────────────────────────────────────────────

  const startNewChat = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    if (thinkingTimerRef.current) {
      clearInterval(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }
    streamGenRef.current++;
    streamingRef.current = false;
    setCurrentSessionId(null);
    setMessages([]);
    setArtifacts([]);
    setSelectedArtifactId(null);
    setIsArtifactPanelOpen(false);
    setIsStreaming(false);
    setErrorMessage("");
    setPrompt("");
    setEditingIndex(null);
    setThoughtForSeconds(null);
    setThinkingSeconds(0);
    setActiveToolActivity(null);
    setActiveSearchResults(null);
    setPendingDateCheck(null);
    pendingToolEventsRef.current = [];
    pendingMessageRef.current = null;
    pendingSendRef.current = false;
    setIsSidebarOpen(false);
    setStreamingArtifact(null);
    setActiveProjectId(null);
    setIsPlusMenuOpen(false);
    setIsToolsMenuOpen(false);
  }, []);

  const handleSelectSession = useCallback(
    (id: string) => {
      if (id === currentSessionId) return;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      streamGenRef.current++;
      streamingRef.current = false;
      setIsStreaming(false);
      setIsArtifactPanelOpen(false);
      setErrorMessage("");
      setEditingIndex(null);
      setThoughtForSeconds(null);
      setThinkingSeconds(0);
      setCurrentSessionId(id);
    },
    [currentSessionId],
  );

  const handleRenameSession = async (id: string, title: string) => {
    await renameSession(id, title);
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, title } : s)),
    );
  };

  const handleDeleteSession = async (id: string) => {
    await deleteSession(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (currentSessionId === id) startNewChat();
  };

  const handlePinSession = async (id: string, pinned: boolean) => {
    const updated = await pinSession(id, pinned);
    setSessions((prev) =>
      prev
        .map((s) => (s.id === id ? { ...s, pinned: updated.pinned } : s))
        .sort((a, b) => {
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
        }),
    );
  };

  // ── Artifact management ───────────────────────────────────────────────────

  const handleDeleteArtifact = async (id: string) => {
    await deleteArtifact(id);
    setArtifacts((prev) => prev.filter((a) => a.id !== id));
    if (selectedArtifactId === id) {
      setSelectedArtifactId(null);
      setIsArtifactPanelOpen(false);
    }
  };

  // Open artifact in split panel
  const handleSelectArtifact = useCallback((id: string) => {
    setSelectedArtifactId(id);
    setIsArtifactPanelOpen(true);
    setIsFilesPanelOpen(false); // files panel hides when artifact opens
  }, []);

  // ── Copy to clipboard ─────────────────────────────────────────────────────
  const copyToClipboard = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch {
      /* fail silently */
    }
  };

  // ── Edit + regenerate ─────────────────────────────────────────────────────
  const startEdit = (index: number, content: string) => {
    setEditingIndex(index);
    setEditValue(content);
    setTimeout(() => editTextareaRef.current?.focus(), 0);
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setEditValue("");
  };

  const saveEdit = async () => {
    if (editingIndex === null || !editValue.trim()) return;
    const messagesBeforeEdit = messages.slice(0, editingIndex);
    const content = editValue;
    setEditingIndex(null);
    setEditValue("");
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    streamingRef.current = false;
    await sendMessage(content, messagesBeforeEdit);
  };

  const onEditKeyDown = async (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      await saveEdit();
    }
    if (e.key === "Escape") cancelEdit();
  };

  // ── ReactMarkdown shared components ───────────────────────────────────────
  const mdComponents = useMemo(
    () => ({
      pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
      code: CodeBlock,
      a: ({ ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
        <a {...props} target="_blank" rel="noopener noreferrer" />
      ),
    }),
    [],
  );

  // ── Composer ──────────────────────────────────────────────────────────────
  const renderComposer = (dropUp = false) => {
    const activeProject = activeProjectId ? projects.find((p) => p.id === activeProjectId) : null;

    // Collect enabled tools for pill display
    const enabledTools: { key: string; label: string; icon: React.ReactNode; toggle: () => void }[] = [
      thinkEnabled && { key: "think", label: "Think", icon: <Lightbulb size={10} />, toggle: () => setThinkEnabled(false) },
      webSearchEnabled && { key: "search", label: "Search", icon: <SearchIcon size={10} />, toggle: () => setWebSearchEnabled(false) },
      deepResearchEnabled && { key: "deep-research", label: "Deep Research", icon: <Microscope size={10} />, toggle: () => setDeepResearchEnabled(false) },
    ].filter(Boolean) as { key: string; label: string; icon: React.ReactNode; toggle: () => void }[];

    // if project active, treat it like a tool pill too
    if (activeProject) {
      enabledTools.push({
        key: "project",
        label: activeProject.name,
        icon: <FolderOpen size={10} className="shrink-0 text-text-3" />,
        toggle: () => setActiveProjectId(null),
      });
    }

    // Attachment pills
    const attachmentPills = attachments.map((att) => (
      <span key={att.id} className="tool-active-pill">
        {att.file.type.startsWith("image/") ? (
          <img src={att.url} className="h-3 w-3 rounded" alt="" />
        ) : (
          <Paperclip size={10} />
        )}
        <span className="truncate max-w-[60px]">{att.file.name}</span>
        <button
          type="button"
          onClick={() => removeAttachment(att.id)}
          className="ml-0.5 flex h-3 w-3 items-center justify-center rounded-full opacity-50 hover:opacity-100 focus:outline-none"
          aria-label="Remove attachment"
        >
          <X size={8} strokeWidth={2.5} />
        </button>
      </span>
    ));

    // Shared Projects list renderer (used in + menu submenu)
    const renderProjectsList = (onSelect: () => void) =>
      projects.length === 0 ? (
        <div className="px-3 py-3 text-center" style={{ whiteSpace: "nowrap" }}>
          <p className="text-[12px] text-text-3">No projects yet.</p>
          <Link
            href="/projects"
            className="mt-1 inline-block text-[12px] text-text-2 underline underline-offset-2"
            onClick={onSelect}
          >
            Create one
          </Link>
        </div>
      ) : (
        <>
          {projects.map((proj) => (
            <button
              key={proj.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setActiveProjectId(proj.id === activeProjectId ? null : proj.id);
                onSelect();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-text-2 transition-colors hover:bg-surface-3"
            >
              <FolderOpen size={12} className="shrink-0 text-text-3" />
              <span className="truncate">{proj.name}</span>
            </button>
          ))}
        </>
      );

    return (
      <form onSubmit={onSubmit} className="composer-card">
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={onTextareaKeyDown}
          placeholder="Ask anything…"
          aria-label="Message input"
          className="composer-textarea"
          rows={1}
        />

        {/* ── Bottom toolbar ───────────────────────────────────────────────── */}
        <div className="mt-2 flex items-center justify-between gap-2">

          {/* Left cluster: action buttons + active tool & attachment pills */}
          <div className="flex min-w-0 items-center gap-1">

            {/* ── + (Attach) button ─────────────────────────────────────── */}
            <div className="relative shrink-0">
              <button
                ref={plusMenuBtnRef}
                type="button"
                onClick={() => {
                  setIsPlusMenuOpen((v) => !v);
                  setPlusMenuPage("main");
                  setIsToolsMenuOpen(false);
                }}
                className={`composer-icon-btn ${isPlusMenuOpen ? "bg-surface-3 text-text-2" : ""}`}
                aria-label="Add attachments"
                aria-haspopup="menu"
                aria-expanded={isPlusMenuOpen}
              >
                <Plus size={14} strokeWidth={2} />
              </button>
              {isPlusMenuOpen && (
                <div
                  ref={plusMenuRef}
                  role="menu"
                  className={`composer-dropdown${dropUp ? " composer-dropdown-up" : ""}`}
                >
                  {plusMenuPage === "main" ? (
                    <>
                      {/* Add images */}
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
                      {/* Add files */}
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
                      <div className="mx-2 my-1 border-t border-border" />
                      {/* Use a Project */}
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => setPlusMenuPage("projects")}
                        className="composer-dropdown-item w-full text-left"
                      >
                        <FolderOpen size={13} className="shrink-0 text-text-3" />
                        <span className="flex-1">Use a Project</span>
                        {activeProjectId && <span className="h-1.5 w-1.5 rounded-full bg-text-2 shrink-0" />}
                        <ChevronRight size={11} className="shrink-0 text-text-3" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setPlusMenuPage("main")}
                        className="flex items-center gap-1.5 px-3 py-2 text-[12px] text-text-3 transition-colors hover:text-text-2 w-full"
                      >
                        <ChevronLeft size={12} />
                        Back
                      </button>
                      <div className="mx-2 my-0.5 border-t border-border" />
                      <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-text-3">
                        Projects
                      </p>
                      {renderProjectsList(() => setIsPlusMenuOpen(false))}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* ── Tools (sliders) button ────────────────────────────────── */}
            <div className="relative shrink-0">
              <button
                ref={toolsMenuBtnRef}
                type="button"
                onClick={() => {
                  setIsToolsMenuOpen((v) => !v);
                  setIsPlusMenuOpen(false);
                }}
                className={`composer-icon-btn ${isToolsMenuOpen ? "bg-surface-3 text-text-2" : ""}`}
                aria-label="Tools"
                aria-haspopup="menu"
                aria-expanded={isToolsMenuOpen}
              >
                <SlidersHorizontal size={14} />
              </button>
              {isToolsMenuOpen && (
                <div
                  ref={toolsMenuRef}
                  role="menu"
                  className={`composer-dropdown${dropUp ? " composer-dropdown-up" : ""}`}
                >
                  <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-text-3">
                    Tools
                  </p>
                  {/* Think */}
                  <div className="composer-tool-row">
                    <Lightbulb size={13} className="shrink-0 text-text-3" />
                    <span className="flex-1 text-[12.5px] text-text-2">Think</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={thinkEnabled}
                      onClick={() => setThinkEnabled((v) => !v)}
                      className={`composer-toggle ${thinkEnabled ? "composer-toggle-on" : "composer-toggle-off"}`}
                    >
                      <span className="composer-toggle-thumb" />
                    </button>
                  </div>
                  {/* Search */}
                  <div className="composer-tool-row">
                    <SearchIcon size={13} className="shrink-0 text-text-3" />
                    <span className="flex-1 text-[12.5px] text-text-2">Search</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={webSearchEnabled}
                      onClick={() => setWebSearchEnabled((v) => !v)}
                      className={`composer-toggle ${webSearchEnabled ? "composer-toggle-on" : "composer-toggle-off"}`}
                    >
                      <span className="composer-toggle-thumb" />
                    </button>
                  </div>
                  {/* Deep Research */}
                  <div className="composer-tool-row">
                    <Microscope size={13} className="shrink-0 text-text-3" />
                    <span className="flex-1 text-[12.5px] text-text-2">Deep Research</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={deepResearchEnabled}
                      onClick={() => setDeepResearchEnabled((v) => !v)}
                      className={`composer-toggle ${deepResearchEnabled ? "composer-toggle-on" : "composer-toggle-off"}`}
                    >
                      <span className="composer-toggle-thumb" />
                    </button>
                  </div>
                </div>
              )}
            </div>



            {/* ── Active tool & project pills ─────────────────────────── */}
            {attachmentPills}
            {enabledTools.map((tool) => (
              <span key={tool.key} className="tool-active-pill">
                <span className="opacity-70">{tool.icon}</span>
                <span>{tool.label}</span>
                <button
                  type="button"
                  onClick={tool.toggle}
                  className="ml-0.5 flex h-3 w-3 items-center justify-center rounded-full opacity-50 hover:opacity-100 focus:outline-none"
                  aria-label={`Disable ${tool.label}`}
                >
                  <X size={8} strokeWidth={2.5} />
                </button>
              </span>
            ))}
          </div>

          {/* ── Send / Stop ──────────────────────────────────────────────── */}
          {isStreaming ? (
            <button
              type="button"
              onClick={stopStreaming}
              className="composer-stop shrink-0"
              aria-label="Stop generating"
            >
              <Square size={9} fill="currentColor" strokeWidth={0} />
            </button>
          ) : (
            <button
              type="submit"
              className="composer-send shrink-0"
              disabled={!prompt.trim()}
              aria-label="Send message"
            >
              <ArrowUp size={14} strokeWidth={2.5} />
            </button>
          )}
        </div>
        {/* hidden inputs used by plus menu */}
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => handleFilesSelected(e, "image")}
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={(e) => handleFilesSelected(e, "file")}
        />
      </form>
    );
  };

  // ── Layout ────────────────────────────────────────────────────────────────

  // Close + menu on outside click
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

  // Close tools menu on outside click
  useEffect(() => {
    if (!isToolsMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        !toolsMenuRef.current?.contains(e.target as Node) &&
        !toolsMenuBtnRef.current?.contains(e.target as Node)
      ) {
        setIsToolsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isToolsMenuOpen]);



  // Derived selected artifact object
  const selectedArtifact =
    artifacts.find((a) => a.id === selectedArtifactId) ?? null;

  // Derive current session title + project for top bar
  const currentSession = sessions.find(s => s.id === currentSessionId) ?? null;
  const currentProject = currentSession?.project_id
    ? (projects.find(p => p.id === currentSession.project_id) ?? null)
    : null;

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-bg font-sans text-text-1">
      {/* Top bar */}
      <header className="relative z-30 flex h-12 shrink-0 items-center justify-between border-b border-border/20 bg-bg px-4">
        <div className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setIsSidebarOpen((v) => !v)}
            className="icon-btn h-8 w-8 shrink-0"
            aria-label="Toggle chat history"
            aria-expanded={isSidebarOpen}
          >
            <Menu size={15} />
          </button>
          <button
            type="button"
            onClick={startNewChat}
            className="icon-btn h-8 w-8 shrink-0"
            aria-label="New chat"
          >
            <SquarePen size={14} />
          </button>
          {/* Session title / project breadcrumb */}
          {currentSessionId && (
            <div className="ml-1 flex min-w-0 items-center gap-1.5 border-l border-border/40 pl-3 text-[12.5px]">
              {currentProject && (
                <>
                  <span className="shrink-0 text-text-3">{currentProject.name}</span>
                  <span className="shrink-0 text-text-3 opacity-50">/</span>
                </>
              )}
              <span className="truncate text-text-2">
                {currentSession?.title ?? "Chat"}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Files button — only visible when this session has artifacts AND artifact panel is NOT open */}
          {artifacts.length > 0 && !isArtifactPanelOpen && (
            <button
              type="button"
              onClick={() => setIsFilesPanelOpen((v) => !v)}
              className="files-btn files-btn-has-items"
              aria-label="Toggle files panel"
              aria-expanded={isFilesPanelOpen}
            >
              <Files size={13} />
              <span>Files</span>
              <span className="files-btn-badge">{artifacts.length}</span>
            </button>
          )}

          <div
            className="flex h-7 w-7 shrink-0 cursor-default select-none items-center justify-center rounded-full border border-border-strong bg-surface-2 text-[11px] font-semibold text-text-2"
            title={USER_NAME}
            aria-label={`Signed in as ${USER_NAME}`}
          >
            {USER_INITIALS}
          </div>
        </div>
      </header>

      {/* Main canvas — horizontal split when artifact panel is open */}
      <div className="flex min-w-0 flex-1 overflow-hidden">
        {/* ── HISTORY SIDEBAR (inline, pushes content) ────────────────── */}
        <SessionSidebar
          open={isSidebarOpen}
          sessions={sessions.filter(s => s.project_id === null)}
          activeSessionId={currentSessionId}
          onSelect={handleSelectSession}
          onRename={handleRenameSession}
          onDelete={handleDeleteSession}
          onPin={handlePinSession}
          onClose={() => setIsSidebarOpen(false)}
        />

        {/* ── LEFT: Chat pane ───────────────────────────────────────────── */}
        <div
          className="flex min-w-0 flex-1 flex-col overflow-hidden"
          style={isArtifactPanelOpen ? { minWidth: 200 } : undefined}
        >
          {isLoadingSession && (
            <div className="flex flex-1 items-center justify-center">
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

          {showEmptyState && (
            <div className="flex flex-1 flex-col items-center justify-center px-4 pb-10">
              <div className="w-full max-w-[680px]">
                <h1 className="mb-5 text-center text-[1.5rem] font-semibold tracking-[-0.02em] text-text-1">
                  {greeting}, {USER_NAME}.
                </h1>
                {renderComposer(false)}
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((item) => (
                    <button
                      type="button"
                      key={item}
                      className="chip-btn"
                      onClick={() => {
                        setPrompt(item);
                        textareaRef.current?.focus();
                      }}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {!showEmptyState && !isLoadingSession && (
            <>
              <section
                ref={scrollContainerRef}
                onScroll={handleScroll}
                className="min-h-0 flex-1 overflow-y-auto"
                role="log"
                aria-live="polite"
                aria-relevant="additions text"
                aria-label="Conversation"
              >
                <div className="mx-auto w-full max-w-[760px] space-y-5 px-4 pt-5 pb-8 md:px-6">
                  {messages.map((message, index) => (
                    <article key={`${message.role}-${index}`} className="msg-enter">
                      {message.role === "user" ? (
                        editingIndex === index ? (
                          <div className="flex justify-end">
                            <div className="w-full max-w-[72%]">
                              <textarea
                                ref={editTextareaRef}
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={onEditKeyDown}
                                className="msg-edit-textarea"
                                rows={1}
                                aria-label="Edit message"
                              />
                              <div className="mt-2 flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={cancelEdit}
                                  className="msg-action-btn text-text-3 hover:text-text-2"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={saveEdit}
                                  disabled={!editValue.trim()}
                                  className="msg-action-btn-primary"
                                >
                                  Send
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="group flex flex-col items-end gap-1.5">
                            <div className="msg-user">
                              <p className="whitespace-pre-wrap">{message.content}</p>
                            </div>
                            <div className="flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                              <button
                                type="button"
                                onClick={() =>
                                  copyToClipboard(message.content, index)
                                }
                                className="msg-tool-btn"
                                aria-label="Copy message"
                                title="Copy"
                              >
                                {copiedIndex === index ? (
                                  <Check size={12} />
                                ) : (
                                  <Copy size={12} />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => startEdit(index, message.content)}
                                className="msg-tool-btn"
                                aria-label="Edit and resend"
                                title="Edit"
                              >
                                <Pencil size={12} />
                              </button>
                            </div>
                          </div>
                        )
                      ) : (
                        <div className="msg-assistant">

                          {/* ── Live tool events (during streaming) ── */}
                          {isStreaming &&
                            index === messages.length - 1 &&
                            (activeToolActivity?.tool === "web_search" || activeSearchResults) && (
                            <div className="tool-events-container">
                              {/* Web search — running state */}
                              {activeToolActivity &&
                                activeToolActivity.tool === "web_search" &&
                                activeToolActivity.status === "running" && (
                                  <WebSearchBlock
                                    status="running"
                                    query={activeToolActivity.query}
                                  />
                                )}

                              {/* Web search — completed (results available, still streaming tokens) */}
                              {activeSearchResults && (
                                <WebSearchBlock
                                  status="completed"
                                  query={activeSearchResults.query}
                                  results={activeSearchResults.results}
                                  resultCount={activeSearchResults.result_count}
                                />
                              )}
                            </div>
                          )}

                          {/* ── Persisted tool events (after streaming / session load) ── */}
                          {(!isStreaming || index < messages.length - 1) &&
                            message.toolEvents &&
                            message.toolEvents.some((e) => e.type === "web_search") && (
                              <div className="tool-events-container">
                                {message.toolEvents.map((event, ei) => {
                                  if (event.type === "date_check") {
                                    // Date check is silent — injected into context but not shown in UI
                                    return null;
                                  }
                                  if (event.type === "web_search") {
                                    if (
                                      event.status === "error" ||
                                      event.results.length === 0
                                    ) {
                                      return (
                                        <WebSearchBlock
                                          key={event.search_id || `err-${ei}`}
                                          status="error"
                                          query={event.query}
                                          errorMessage={event.message}
                                        />
                                      );
                                    }
                                    return (
                                      <WebSearchBlock
                                        key={event.search_id || `search-${ei}`}
                                        status="completed"
                                        query={event.query}
                                        results={event.results}
                                        resultCount={event.result_count}
                                      />
                                    );
                                  }
                                  return null;
                                })}
                              </div>
                            )}

                          {message.content ? (
                            <>
                              {thoughtForSeconds !== null &&
                                index === messages.length - 1 && (
                                  <div
                                    className="thought-badge"
                                    aria-label={`Agent thought for ${thoughtForSeconds} seconds`}
                                  >
                                    <span className="thought-dot" />
                                    Thought for {thoughtForSeconds}s
                                  </div>
                                )}

                              {(() => {
                                const isCurrentMsg = isStreaming && index === messages.length - 1;
                                if (isCurrentMsg) {
                                  // Streaming: hide partial artifact block, StreamingArtifactCard shows below
                                  return (
                                    <div className="markdown-content">
                                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                                        {stripPartialArtifactBlock(message.content)}
                                      </ReactMarkdown>
                                    </div>
                                  );
                                }
                                if (message.artifactId) {
                                  // Completed artifact: split content at sentinel/block for inline card
                                  const [before, after] = splitAroundArtifact(message.content);
                                  const art = artifacts.find((a) => a.id === message.artifactId);
                                  return (
                                    <>
                                      {before && (
                                        <div className="markdown-content">
                                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                                            {before}
                                          </ReactMarkdown>
                                        </div>
                                      )}
                                      {art && (
                                        <div className={before ? "mt-3 artifact-card-enter" : "artifact-card-enter"}>
                                          <ArtifactCard artifact={art} onOpen={handleSelectArtifact} />
                                        </div>
                                      )}
                                      {after && (
                                        <div className="mt-3 markdown-content">
                                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                                            {after}
                                          </ReactMarkdown>
                                        </div>
                                      )}
                                    </>
                                  );
                                }
                                // Regular message (no artifact)
                                return (
                                  <div className="markdown-content">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                                      {stripArtifactBlock(message.content)}
                                    </ReactMarkdown>
                                  </div>
                                );
                              })()}

                              {(!isStreaming || index < messages.length - 1) && (
                                <div className="mt-3 flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      copyToClipboard(
                                        stripArtifactBlock(message.content),
                                        index,
                                      )
                                    }
                                    className="msg-tool-btn"
                                    aria-label="Copy response"
                                    title={
                                      copiedIndex === index ? "Copied!" : "Copy"
                                    }
                                  >
                                    {copiedIndex === index ? (
                                      <Check size={13} />
                                    ) : (
                                      <Copy size={13} />
                                    )}
                                  </button>
                                </div>
                              )}
                              {/* Mid-stream pause indicator */}
                              {isStreaming &&
                                streamPaused &&
                                index === messages.length - 1 && (
                                  <div
                                    className="mt-3 flex items-center gap-2"
                                    aria-live="polite"
                                  >
                                    <span className="thinking-dots">
                                      <span />
                                      <span />
                                      <span />
                                    </span>
                                    <span className="text-[12px] text-text-3">
                                      Still generating…
                                    </span>
                                  </div>
                                )}
                              {/* Streaming card: shown while artifact is being written into the panel */}
                              {isStreaming &&
                                index === messages.length - 1 &&
                                !message.artifactId &&
                                message.content.includes("<artifact") && (
                                  <div className="mt-3 artifact-card-enter">
                                    <StreamingArtifactCard
                                      title={streamingArtifact?.title ?? "Artifact"}
                                      type={streamingArtifact?.type ?? "markdown"}
                                      onOpen={() => {
                                        // User explicitly wants to see the panel — clear the closed flag
                                        userClosedPanelRef.current = false;
                                        // Clear any selected artifact so the panel shows the STREAMING preview,
                                        // not the previously completed artifact
                                        setSelectedArtifactId(null);
                                        setIsArtifactPanelOpen(true);
                                        setIsFilesPanelOpen(false);
                                        if (!isArtifactPanelOpen) {
                                          setArtifactPanelWidth(
                                            typeof window !== "undefined"
                                              ? Math.floor(window.innerWidth / 2)
                                              : 560,
                                          );
                                        }
                                      }}
                                    />
                                  </div>
                                )}
                            </>
                          ) : isStreaming &&
                            index === messages.length - 1 &&
                            !activeToolActivity &&
                            !activeSearchResults ? (
                            <div
                              className="thinking-indicator"
                              aria-live="polite"
                              aria-label={
                                streamPaused
                                  ? "Still generating, please wait"
                                  : "Agent is thinking"
                              }
                            >
                              <span className="thinking-dots">
                                <span />
                                <span />
                                <span />
                              </span>
                              <span className="thinking-label">
                                {streamPaused
                                  ? "Still generating…"
                                  : thinkingSeconds > 0
                                    ? `Thinking… ${thinkingSeconds}s`
                                    : "Thinking…"}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      )}
                    </article>
                  ))}

                  {errorMessage && (
                    <ChatErrorBanner
                      message={errorMessage}
                      onRetry={lastPrompt ? retryLastPrompt : undefined}
                      onDismiss={() => setErrorMessage("")}
                    />
                  )}

                  <div ref={messagesEndRef} className="h-2" />
                </div>
              </section>

              <div className="shrink-0 px-4 pb-5 pt-2 md:px-6">
                <div className="mx-auto w-full max-w-[760px]">
                  {renderComposer(true)}
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── RESIZE HANDLE ────────────────────────────────────────────── */}
        {isArtifactPanelOpen && (
          <div
            className="split-resize-handle"
            onMouseDown={startResize}
            aria-hidden="true"
            title="Drag to resize"
          />
        )}

        {/* ── RIGHT: Artifact panel ────────────────────────────────────── */}
        {isArtifactPanelOpen && (
          <div
            className="artifact-panel-container"
            style={{ width: artifactPanelWidth }}
          >
            <ArtifactPanel
              artifact={selectedArtifact}
              streamingArtifact={streamingArtifact}
              onClose={() => {
                setIsArtifactPanelOpen(false);
                userClosedPanelRef.current = true; // user intention: keep panel closed
              }}
            />
          </div>
        )}

        {/* ── FILES SIDEBAR (far right — only shown when artifact panel is closed) */}
        <FilesPanel
          open={isFilesPanelOpen && !isArtifactPanelOpen}
          artifacts={artifacts}
          selectedArtifactId={selectedArtifactId}
          onSelectArtifact={handleSelectArtifact}
          onDeleteArtifact={handleDeleteArtifact}
          onClose={() => setIsFilesPanelOpen(false)}
        />

      </div>
    </div>
  );
}
