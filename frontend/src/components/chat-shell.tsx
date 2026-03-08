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
import { ArrowUp, Check, ChevronLeft, ChevronRight, Copy, Edit3, Files, FolderOpen, Image as ImageIcon, Mic, Paperclip, Pencil, Square, X } from "lucide-react";
import { LeftRail } from "@/components/shell/left-rail";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { ChatErrorBanner } from "@/components/chat/chat-error-banner";
import { ChatLoadingSkeleton } from "@/components/chat/chat-loading-skeleton";
import { CodeBlock } from "@/components/chat/code-block";
import { WebSearchBlock } from "@/components/chat/tool-activity";
import { ThinkingBlock } from "@/components/chat/thinking-block";
import ClarifyingQuestionsBar from "@/components/chat/clarifying-questions-bar";
import { TodoWidget } from "@/components/chat/todo-widget";
import { SessionSidebar } from "@/components/shell/session-sidebar";
import { FilesPanel } from "@/components/shell/files-panel";
import { ArtifactPanel } from "@/components/artifact/artifact-panel";
import { ArtifactCard, StreamingArtifactCard } from "@/components/artifact/artifact-card";
import type {
  ChatMessage,
  ClarifyingQuestion,
  TodoItem,
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
import { useVoiceInput } from "@/lib/use-voice-input";

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
  // For XML-path: replace the <artifact> block if present
  const replaced = content.replace(ARTIFACT_BLOCK_RE, ARTIFACT_SENTINEL);
  // If a replacement happened, use it; otherwise append sentinel at current end
  // (tool-path: no XML in stream, so we mark the current position)
  if (replaced !== content) return replaced;
  return content + ARTIFACT_SENTINEL;
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

  // ── Tools state ────────────────────────────────────────────────────────────
  const [thinkEnabled, setThinkEnabled] = useState(false);
  const [deepResearchEnabled, setDeepResearchEnabled] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(true);
  // Ref that always holds the current value — used inside the sendMessage
  // useCallback to avoid a stale closure (webSearchEnabled is NOT in the dep array).
  const webSearchEnabledRef = useRef(webSearchEnabled);
  useEffect(() => { webSearchEnabledRef.current = webSearchEnabled; }, [webSearchEnabled]);
  // Stale-closure-safe refs for think and deep research toggles
  const thinkEnabledRef = useRef(thinkEnabled);
  useEffect(() => { thinkEnabledRef.current = thinkEnabled; }, [thinkEnabled]);
  const deepResearchEnabledRef = useRef(deepResearchEnabled);
  useEffect(() => { deepResearchEnabledRef.current = deepResearchEnabled; }, [deepResearchEnabled]);

  // Ref version of thoughtForSeconds — allows reliable reads in finally block
  const thoughtForSecondsRef = useRef<number | null>(null);

  // ── Deep research clarifying questions state ──────────────────────────────
  const [pendingClarifyingQuestions, setPendingClarifyingQuestions] =
    useState<ClarifyingQuestion[] | null>(null);
  const [pendingResearchQuery, setPendingResearchQuery] = useState<string | null>(null);

  // ── Deep research todo-list state ─────────────────────────────────────────
  const [todoItems, setTodoItems] = useState<TodoItem[]>([]);
  const [todoCollapsed, setTodoCollapsed] = useState(false);

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

  // ── Voice input ───────────────────────────────────────────────────────────
  // Snapshot of `prompt` at the moment recording starts, so we can append
  // interim/final text onto any text the user already typed.
  const preVoicePromptRef = useRef("");

  const voice = useVoiceInput({
    onTranscript: (text, isFinal) => {
      const base = preVoicePromptRef.current;
      const separator = base.length > 0 && !base.endsWith(" ") ? " " : "";
      if (isFinal) {
        // Commit final text (trim trailing space from interim, add space for next word)
        setPrompt(base + separator + text.trim() + " ");
      } else {
        // Show interim in-progress text as a live preview
        setPrompt(base + separator + text);
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
    const deepResearchParam = searchParams.get("deepResearch");
    if (sessionId) {
      if (artifactId) pendingArtifactIdRef.current = artifactId;
      if (messageParam) {
        // Store as pending so it auto-sends once the session finishes loading
        pendingMessageRef.current = decodeURIComponent(messageParam);
      }
      if (projectParam) setActiveProjectId(projectParam);
      // If launched from projects page with ?deepResearch=true, pre-enable the mode
      if (deepResearchParam === "true") {
        setDeepResearchEnabled(true);
      }
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
                m.role === "assistant"
                  ? m.artifact_id
                    // Preserve the artifact's inline position: replace <artifact>…</artifact>
                    // block with the sentinel character so splitAroundArtifact works correctly.
                    // For tool-path messages the sentinel (\x00) is already in the stored
                    // content — the replace below is a no-op in that case.
                    ? m.content.replace(ARTIFACT_BLOCK_RE, ARTIFACT_SENTINEL)
                    : stripArtifactBlock(m.content)
                  : m.content,
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
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [prompt]);

  useEffect(() => {
    const el = editTextareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 300)}px`;
  }, [editValue]);

  // ── Mid-stream pause / stall detection ───────────────────────────────────
  // Two-phase detection:
  //   Phase 1 (pre-first-token): If the backend hasn't sent a single token
  //     within 15 s of the request starting, flag as paused.  This surfaces
  //     cold-start delays, LLM API hangs, etc.
  //   Phase 2 (mid-stream):  Once tokens have started flowing, flag if there
  //     is a gap of > 4 s (tool call, long reasoning step, etc.).
  useEffect(() => {
    if (!isStreaming) {
      setStreamPaused(false);
      return;
    }
    const intervalId = setInterval(() => {
      const elapsed = Date.now() - lastTokenTimeRef.current;
      if (hasReceivedFirstTokenRef.current) {
        // Post-first-token: pause after a 4 s gap
        if (elapsed > 4_000) setStreamPaused(true);
      } else {
        // Pre-first-token: warn after 15 s of silence
        if (elapsed > 15_000) setStreamPaused(true);
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
      thoughtForSecondsRef.current = thinkingSecondsRef.current;
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

  const appendThinkingToken = (token: string) => {
    setMessages((prev) => {
      if (!prev.length) return prev;
      const next = [...prev];
      const last = next[next.length - 1];
      if (last.role !== "assistant") return next;
      const existing = last.thinkingContent ?? "";
      next[next.length - 1] = { ...last, thinkingContent: existing + token };
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
      thoughtForSecondsRef.current = null;
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
          // onArtifactUpdated — not handled in this view (artifacts are loaded fresh)
          undefined,
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
          // onThinking — accumulate reasoning tokens into message state
          appendThinkingToken,
          controller.signal,
          webSearchEnabledRef.current,
          thinkEnabledRef.current,
          deepResearchEnabledRef.current,
          undefined,    // clarifications (null = Call 1 — generate questions)
          // onClarifyingQuestions — swap composer for question bar
          (questions) => {
            setPendingClarifyingQuestions(questions);
            setPendingResearchQuery(trimmed);
          },
          // onDeepResearchPlan — seed the todo widget from the research plan
          (sub_questions, iteration) => {
            if (iteration === 0) {
              setTodoItems(
                sub_questions.map((q, i) => ({
                  id: `plan-${i}`,
                  text: q,
                  status: "pending" as const,
                })),
              );
              setTodoCollapsed(false);
            }
          },
          // onDeepResearchProgress — not rendered separately (progress visible via tokens)
          undefined,
          // onTodoUpdate — live todo state updates from run_searches node
          (items) => { setTodoItems(items); },
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
          // Bake pending tool events and thinkingSeconds into the last assistant message
          const bakedToolEvents = pendingToolEventsRef.current;
          const bakedThinkingSeconds =
            thinkEnabledRef.current ? thoughtForSecondsRef.current : null;

          if (bakedToolEvents.length > 0 || bakedThinkingSeconds !== null) {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (!last || last.role !== "assistant") return prev;
              const updates: Partial<typeof last> = {};
              if (bakedToolEvents.length > 0) updates.toolEvents = bakedToolEvents;
              if (bakedThinkingSeconds !== null) updates.thinkingSeconds = bakedThinkingSeconds;
              return [...prev.slice(0, -1), { ...last, ...updates }];
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

  /**
   * Called when the user submits answers from ClarifyingQuestionsBar.
   * Sends Call 2: deep_research_enabled=true + clarifications dict.
   */
  const sendMessageWithClarifications = useCallback(
    async (query: string, clarifications: Record<string, string>) => {
      const trimmed = query.trim();
      if (!trimmed || streamingRef.current) return;

      // Dismiss the questions bar
      setPendingClarifyingQuestions(null);
      setPendingResearchQuery(null);

      const myGen = ++streamGenRef.current;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      streamingRef.current = true;
      setErrorMessage("");
      setIsStreaming(true);
      userClosedPanelRef.current = false;

      // Add the research label message + placeholder assistant message
      setMessages((prev) => [
        ...prev,
        { role: "user" as const, content: `🔬 Starting deep research with your answers…` },
      ]);
      appendAssistantPlaceholder();

      hasReceivedFirstTokenRef.current = false;
      lastTokenTimeRef.current = Date.now();
      setStreamPaused(false);
      thinkingSecondsRef.current = 0;
      setThinkingSeconds(0);
      thoughtForSecondsRef.current = null;

      try {
        const sessionId = await ensureSession();
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
                { ...last, content: injectArtifactSentinel(last.content), artifactId: artifact.id },
              ];
            });
            setArtifacts((prev) =>
              prev.some((a) => a.id === artifact.id) ? prev : [...prev, artifact],
            );
            setSelectedArtifactId(artifact.id);
            if (!userClosedPanelRef.current) {
              setIsArtifactPanelOpen(true);
              setIsFilesPanelOpen(false);
              setArtifactPanelWidth(
                typeof window !== "undefined" ? Math.floor(window.innerWidth / 2) : 560,
              );
            }
            void refreshSessions();
          },
          undefined,           // onArtifactUpdated
          undefined,           // onToolActivity
          undefined,           // onSearchResults
          undefined,           // onThinking
          controller.signal,
          false,               // webSearchEnabled (Google CSE handles search internally)
          false,               // thinkEnabled
          true,                // deepResearchEnabled = true (Call 2)
          clarifications,      // the user's answers
          undefined,           // onClarifyingQuestions (not expected on Call 2)
          // onDeepResearchPlan — seed todo widget for Call 2 (re-plan on 2nd iteration)
          (sub_questions, iteration) => {
            if (iteration === 0) {
              setTodoItems(
                sub_questions.map((q, i) => ({
                  id: `plan-${i}`,
                  text: q,
                  status: "pending" as const,
                })),
              );
              setTodoCollapsed(false);
            }
          },
          undefined,           // onDeepResearchProgress
          // onTodoUpdate — live search-step progress updates
          (items) => { setTodoItems(items); },
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
            error instanceof Error ? error.message : "Deep research failed.",
          );
        }
      } finally {
        if (streamGenRef.current === myGen) {
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
    setPendingClarifyingQuestions(null);
    setPendingResearchQuery(null);
    setTodoItems([]);
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
      setThinkingSeconds(0);
      setPendingClarifyingQuestions(null);
      setPendingResearchQuery(null);
      setTodoItems([]);
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

  // Derived: look up the artifact object for the panel
  const selectedArtifact = artifacts.find((a) => a.id === selectedArtifactId) ?? null;

  // ── Pane header title ─────────────────────────────────────────────────────
  const currentSession = sessions.find((s) => s.id === currentSessionId) ?? null;
  const sessionProject = currentSession?.project_id
    ? projects.find((p) => p.id === currentSession.project_id) ?? null
    : null;
  const paneTitle =
    !currentSession || messages.length === 0
      ? "Operator"
      : sessionProject
        ? `${sessionProject.name} / ${currentSession.title}`
        : currentSession.title;

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
        {/* ── Tool checkboxes row ───────────────────────────────────────────── */}
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
          {/* Web */}
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
            }`}>Web</span>
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

          {/* Active project indicator — removed from here; shown as pill in action row */}

          {/* Attachment pills */}
          {attachments.map((att) => (
            <span key={att.id} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-text-2">
              {att.file.type.startsWith("image/") ? (
                <img src={att.url} className="h-3 w-3" alt="" />
              ) : (
                <Paperclip size={8} />
              )}
              <span className="truncate max-w-[60px]">{att.file.name}</span>
              <button type="button" onClick={() => removeAttachment(att.id)} className="opacity-60 hover:opacity-100 focus:outline-none">
                <X size={8} strokeWidth={2.5} />
              </button>
            </span>
          ))}

        </div>

        {/* ── Research Plan — integrated panel above the input box ─────── */}
        {todoItems.length > 0 && (
          <div className="composer-todo-wrap">
            <TodoWidget
              items={todoItems}
              collapsed={todoCollapsed}
              onToggle={() => setTodoCollapsed((v) => !v)}
            />
          </div>
        )}

        {/* ── Inner white box: textarea + action row ─────────────────────── */}
        <div className="composer-input-box">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onTextareaKeyDown}
            placeholder="Message Operator…"
            aria-label="Message input"
            className="composer-textarea"
            rows={1}
          />
          {/* Action row — Attach + Mic on left | Send/Stop on right */}
          <div className="flex items-center justify-between px-2 pb-2 pt-1">
            {/* Left: Attach + Mic */}
            <div className="flex items-center gap-1">
              {/* Attach / project trigger */}
              {/* NOTE: no `relative` wrapper here — the dropdown is positioned
                  relative to `.composer-input-box` (see CSS) so it spans its
                  full width instead of just this tiny button wrapper. */}
              <div>
                <button
                  ref={plusMenuBtnRef}
                  type="button"
                  onClick={() => {
                    setIsPlusMenuOpen((v) => !v);
                    setPlusMenuPage("main");
                  }}
                  className={`composer-action-btn${isPlusMenuOpen ? " border-text-3 text-text-2" : " text-text-3 hover:text-text-2"}`}
                  aria-label="Attach files or use project"
                  aria-haspopup="menu"
                  aria-expanded={isPlusMenuOpen}
                >
                  <Paperclip size={13} />
                </button>
                {isPlusMenuOpen && (
                  <div
                    ref={plusMenuRef}
                    role="menu"
                    className={`composer-dropdown-full${dropUp ? " composer-dropdown-up" : ""}`}
                  >
                    {plusMenuPage === "main" ? (
                      <>
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
                        <div className="mx-2 my-1 border-t border-border" />
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => setPlusMenuPage("projects")}
                          className="composer-dropdown-item w-full text-left"
                        >
                          <FolderOpen size={13} className="shrink-0 text-text-3" />
                          <span className="flex-1">Use a Project</span>
                          {activeProjectId && <span className="h-1.5 w-1.5 bg-text-2 shrink-0" />}
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

              {/* Active project pill — blue chip next to attach */}
              {activeProject && (
                <span className="group inline-flex items-center gap-1 bg-accent px-2 py-0.5 text-[11px] font-semibold text-white">
                  <FolderOpen size={10} className="shrink-0" />
                  <span className="max-w-[90px] truncate">{activeProject.name}</span>
                  <button
                    type="button"
                    onClick={() => setActiveProjectId(null)}
                    className="ml-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 focus:outline-none"
                    aria-label="Remove project"
                  >
                    <X size={9} strokeWidth={2.5} />
                  </button>
                </span>
              )}

              {/* Mic / Voice button — removed from here, now on right */}
            </div>

            {/* Right: Mic + Send side by side */}
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
              {isStreaming ? (
                <button
                  type="button"
                  onClick={stopStreaming}
                  className="composer-action-btn border-text-2 text-text-2 hover:border-text-1 hover:text-text-1"
                  aria-label="Stop generating"
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
                  aria-label="Send message"
                >
                  <ArrowUp size={15} strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Hidden file inputs */}
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

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-text-1">

      {/* ── Left Rail ───────────────────────────────────────────────────── */}
      <LeftRail
        onToggleHistory={() => setIsSidebarOpen((v) => !v)}
        historyOpen={isSidebarOpen}
      />

      {/* ── Session sidebar + chat + artifact ──────────────────────────────── */}
      <div className="relative flex min-w-0 flex-1 overflow-hidden">
        {/* Session History Sidebar */}
        <SessionSidebar
          open={isSidebarOpen}
          sessions={sessions}
          activeSessionId={currentSessionId}
          onSelect={handleSelectSession}
          onRename={handleRenameSession}
          onDelete={handleDeleteSession}
          onPin={handlePinSession}
          onClose={() => setIsSidebarOpen(false)}
        />

        {/* Dim backdrop when sidebar is open — click to dismiss */}
        {isSidebarOpen && (
          <div
            className="absolute inset-x-0 bottom-0 top-12 z-10 bg-black/10"
            onClick={() => setIsSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* ── Chat pane ────────────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">

          {/* Pane header */}
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-bg px-4">
            <span
              className="truncate text-[15px] font-bold tracking-[-0.02em] text-text-1"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {paneTitle}
            </span>
            <div className="flex items-center gap-1.5">
              {artifacts.length > 0 && !isArtifactPanelOpen && (
                <button
                  type="button"
                  onClick={() => setIsFilesPanelOpen((v) => !v)}
                  className="files-btn files-btn-has-items"
                >
                  <Files size={13} />
                  <span>Files</span>
                  <span className="files-btn-badge">{artifacts.length}</span>
                </button>
              )}
              {/* New chat button */}
              <button
                type="button"
                onClick={startNewChat}
                className="flex h-7 w-7 items-center justify-center text-text-3 transition-colors hover:text-text-1 focus-visible:outline-none"
                aria-label="New chat"
                title="New chat"
              >
                <Edit3 size={14} />
              </button>
            </div>
          </div>

          {/* Loading skeleton */}
          {isLoadingSession && (
            <div className="flex flex-1 flex-col items-center justify-center gap-4">
              <ChatLoadingSkeleton />
              <span className="thinking-label">Loading…</span>
            </div>
          )}

          {showEmptyState && (
            <div className="flex flex-1 flex-col items-center justify-center px-4 pb-10">
              <div className="w-full max-w-[680px]">
                <h1 className="mb-1 text-center text-[1.75rem] font-bold tracking-[-0.03em] text-text-1" style={{ fontFamily: "var(--font-display)" }}>
                  Welcome to Operator.
                </h1>
                <p className="mb-5 text-center text-[13px] text-text-3">Your AI agent. Ready to research, build, and think.</p>
                {pendingClarifyingQuestions && pendingResearchQuery ? (
                  <ClarifyingQuestionsBar
                    questions={pendingClarifyingQuestions}
                    originalQuery={pendingResearchQuery}
                    onSubmit={(answers) =>
                      void sendMessageWithClarifications(pendingResearchQuery, answers)
                    }
                    onSkip={() =>
                      void sendMessageWithClarifications(pendingResearchQuery ?? "", {})
                    }
                  />
                ) : (
                  renderComposer(false)
                )}
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {!pendingClarifyingQuestions && SUGGESTIONS.map((item) => (
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
                            <div className="flex items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
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

                          {/* ── ThinkingBlock — collapsible reasoning accordion ── */}
                          {((isStreaming && index === messages.length - 1 &&
                            (thinkEnabled || (message.thinkingContent?.length ?? 0) > 0)) ||
                            (!isStreaming && (message.thinkingContent?.length ?? 0) > 0)) && (
                            <div className="mb-2">
                              <ThinkingBlock
                                content={message.thinkingContent ?? ""}
                                seconds={
                                  isStreaming && index === messages.length - 1
                                    ? thinkingSeconds
                                    : (message.thinkingSeconds ?? 0)
                                }
                                isStreaming={isStreaming && index === messages.length - 1}
                              />
                            </div>
                          )}

                          {message.content ? (
                            <>

                              {(() => {
                                const isCurrentMsg = isStreaming && index === messages.length - 1;
                                // Streaming with no artifact yet — strip partial XML (fallback path)
                                if (isCurrentMsg && !message.artifactId) {
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

                              {/* ── Live tool events (during streaming) — rendered after content ── */}
                              {isStreaming &&
                                index === messages.length - 1 &&
                                (activeToolActivity?.tool === "web_search" || activeSearchResults) && (
                                <div className="tool-events-container mt-2">
                                  {activeToolActivity &&
                                    activeToolActivity.tool === "web_search" &&
                                    activeToolActivity.status === "running" && (
                                      <WebSearchBlock
                                        status="running"
                                        query={activeToolActivity.query}
                                      />
                                    )}
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

                              {/* ── Persisted tool events — rendered after content ── */}
                              {(!isStreaming || index < messages.length - 1) &&
                                message.toolEvents &&
                                message.toolEvents.some((e) => e.type === "web_search") && (
                                  <div className="tool-events-container mt-2">
                                    {message.toolEvents.map((event, ei) => {
                                      if (event.type === "date_check") {
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
                                        userClosedPanelRef.current = false;
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
                            index === messages.length - 1 ? (
                            <>
                              {/* Live tool events when there is no response text yet */}
                              {(activeToolActivity?.tool === "web_search" || activeSearchResults) && (
                                <div className="tool-events-container">
                                  {activeToolActivity &&
                                    activeToolActivity.tool === "web_search" &&
                                    activeToolActivity.status === "running" && (
                                      <WebSearchBlock
                                        status="running"
                                        query={activeToolActivity.query}
                                      />
                                    )}
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
                              {/* Generating indicator — shown when no content and no active tool */}
                              {!activeToolActivity && !activeSearchResults && (
                                <div
                                  className="tool-block"
                                  aria-live="polite"
                                  aria-label={
                                    streamPaused
                                      ? "Model is taking longer than usual – stop to retry"
                                      : "Agent is generating a response"
                                  }
                                >
                                  <div className="tb-header">
                                    <span className="tb-spinner" aria-hidden="true" />
                                    <span className="tb-title">
                                      {streamPaused
                                        ? <>Taking longer than usual…&nbsp;<span style={{opacity:0.5, fontWeight:400}}>stop to retry</span></>
                                        : thinkingSeconds > 0
                                          ? `Generating\u2026 ${thinkingSeconds}s`
                                          : "Generating\u2026"}
                                    </span>
                                  </div>
                                </div>
                              )}
                            </>
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
                  {pendingClarifyingQuestions && pendingResearchQuery ? (
                    <ClarifyingQuestionsBar
                      questions={pendingClarifyingQuestions}
                      originalQuery={pendingResearchQuery}
                      onSubmit={(answers) =>
                        void sendMessageWithClarifications(pendingResearchQuery, answers)
                      }
                      onSkip={() =>
                        void sendMessageWithClarifications(pendingResearchQuery ?? "", {})
                      }
                    />
                  ) : (
                    renderComposer(true)
                  )}
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
