"use client";

import {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowUp, Check, Copy, Menu, Pencil, Square, SquarePen, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { ChatErrorBanner } from "@/components/chat/chat-error-banner";
import { ChatMessage, streamChatCompletion } from "@/lib/chat-api";

// ── Demo data ─────────────────────────────────────────────────────────────────
const DEMO_SESSIONS = {
  today: [
    { id: "1", title: "UI redesign for production chat", active: true },
    { id: "2", title: "Phase 1 chat shell wireframes" },
  ],
  yesterday: [
    { id: "3", title: "Backend streaming architecture" },
  ],
};

const SUGGESTIONS = [
  "Explain how large language models work",
  "Write a Python script to read and process a CSV file",
  "What are the best practices for designing a REST API?",
];

const DEMO_USER_NAME = "Furqan";
const DEMO_USER_INITIALS = "FU";

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// ── Component ─────────────────────────────────────────────────────────────────
export function ChatShell() {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [lastPrompt, setLastPrompt] = useState("");

  // Edit state
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");

  // Copy feedback
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // Thinking indicator
  const [thinkingSeconds, setThinkingSeconds] = useState(0);
  const [thoughtForSeconds, setThoughtForSeconds] = useState<number | null>(null);
  const thinkingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const thinkingSecondsRef = useRef(0);
  const hasReceivedFirstTokenRef = useRef(false);

  const streamingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  // Generation counter — ensures old stream's finally() never stomps new stream state
  const streamGenRef = useRef(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLElement>(null);
  const isNearBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  const showEmptyState = useMemo(
    () => messages.length === 0 && !isStreaming,
    [isStreaming, messages.length],
  );

  const greeting = useMemo(() => getGreeting(), []);

  // ── Smart scroll ─────────────────────────────────────────────────────────
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceFromBottom < 120;
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

  // ── Close sidebar on Escape ───────────────────────────────────────────────
  useEffect(() => {
    if (!isSidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsSidebarOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isSidebarOpen]);

  // ── Stream token helpers ──────────────────────────────────────────────────
  const appendAssistantPlaceholder = () => {
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
  };

  const appendAssistantToken = (token: string) => {
    // First token received — stop thinking timer and record duration
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

  // ── Stop current stream ───────────────────────────────────────────────────
  const stopStreaming = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

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
      setIsStreaming(true);

      const base = priorMessages ?? messages;
      const userMessage: ChatMessage = { role: "user", content: trimmed };
      const nextMessages = [...base, userMessage];
      setMessages(nextMessages);
      appendAssistantPlaceholder();

      // Start thinking timer
      hasReceivedFirstTokenRef.current = false;
      thinkingSecondsRef.current = 0;
      setThinkingSeconds(0);
      setThoughtForSeconds(null);
      thinkingTimerRef.current = setInterval(() => {
        thinkingSecondsRef.current += 1;
        setThinkingSeconds(thinkingSecondsRef.current);
      }, 1000);

      try {
        await streamChatCompletion(nextMessages, appendAssistantToken, controller.signal);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          // User stopped — keep partial content, drop empty placeholder
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant" && !last.content) return prev.slice(0, -1);
            return prev;
          });
        } else {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant" && !last.content) return prev.slice(0, -1);
            return prev;
          });
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Something went wrong while streaming.",
          );
        }
      } finally {
        // Clear thinking timer regardless
        if (thinkingTimerRef.current) {
          clearInterval(thinkingTimerRef.current);
          thinkingTimerRef.current = null;
        }
        // Only clean up if this is still the active stream
        if (streamGenRef.current === myGen) {
          abortControllerRef.current = null;
          streamingRef.current = false;
          setIsStreaming(false);
        }
      }
    },
    [messages],
  );

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await sendMessage(prompt);
  };

  const onTextareaKeyDown = async (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      await sendMessage(prompt);
    }
  };

  const retryLastPrompt = async () => {
    if (!lastPrompt || isStreaming) return;
    await sendMessage(lastPrompt);
  };

  // ── New chat ──────────────────────────────────────────────────────────────
  const startNewChat = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    if (thinkingTimerRef.current) {
      clearInterval(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }
    streamGenRef.current++;
    streamingRef.current = false;
    setMessages([]);
    setIsStreaming(false);
    setErrorMessage("");
    setPrompt("");
    setEditingIndex(null);
    setThoughtForSeconds(null);
    setThinkingSeconds(0);
  }, []);

  // ── Copy to clipboard ─────────────────────────────────────────────────────
  const copyToClipboard = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch {
      // clipboard unavailable — fail silently
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

    // Abort any running stream synchronously, then let sendMessage start fresh
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

  // ── Composer ──────────────────────────────────────────────────────────────
  const renderComposer = () => (
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
      <div className="mt-2.5 flex items-center justify-end">
        {isStreaming ? (
          <button
            type="button"
            onClick={stopStreaming}
            className="composer-stop"
            aria-label="Stop generating"
          >
            <Square size={9} fill="currentColor" strokeWidth={0} />
          </button>
        ) : (
          <button
            type="submit"
            className="composer-send"
            disabled={!prompt.trim()}
            aria-label="Send message"
          >
            <ArrowUp size={14} strokeWidth={2.5} />
          </button>
        )}
      </div>
    </form>
  );

  // ── Layout ────────────────────────────────────────────────────────────────
  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-bg font-sans text-text-1">

      {/* ── Top bar ── */}
      <header className="relative z-30 flex h-12 shrink-0 items-center justify-between border-b border-border/50 bg-surface-1/80 px-3 backdrop-blur-sm">
        {/* Left: hamburger + new chat */}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setIsSidebarOpen((v) => !v)}
            className="icon-btn h-8 w-8"
            aria-label="Toggle chat history"
            aria-expanded={isSidebarOpen}
            aria-controls="chat-sidebar"
          >
            <Menu size={15} />
          </button>
          <button
            type="button"
            onClick={startNewChat}
            className="icon-btn h-8 w-8"
            aria-label="New chat"
          >
            <SquarePen size={14} />
          </button>
        </div>

        {/* Right: avatar only */}
        <div
          className="flex h-7 w-7 shrink-0 cursor-default select-none items-center justify-center rounded-full bg-surface-3 text-[11px] font-semibold text-text-2"
          title={DEMO_USER_NAME}
          aria-label={`Signed in as ${DEMO_USER_NAME}`}
        >
          {DEMO_USER_INITIALS}
        </div>
      </header>

      {/* ── Sidebar backdrop ── */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]"
          onClick={() => setIsSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Chat history sidebar ── */}
      <aside
        id="chat-sidebar"
        aria-label="Chat history"
        aria-hidden={!isSidebarOpen}
        className={`fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col bg-surface-1 shadow-2xl transition-transform duration-200 ease-out ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
          <span className="text-[13px] font-semibold text-text-1">Chats</span>
          <button
            type="button"
            onClick={() => setIsSidebarOpen(false)}
            className="icon-btn h-7 w-7"
            aria-label="Close sidebar"
          >
            <X size={13} />
          </button>
        </div>

        <div className="px-3 pt-2 pb-1">
          <button
            type="button"
            onClick={() => {
              startNewChat();
              setIsSidebarOpen(false);
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-text-2 transition-colors duration-100 hover:bg-surface-2 hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <SquarePen size={13} />
            New chat
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 pb-4" aria-label="Past chats">
          <p className="px-3 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-text-3">
            Today
          </p>
          <ul className="space-y-px">
            {DEMO_SESSIONS.today.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`session-item ${item.active ? "session-item-active" : ""}`}
                  aria-current={item.active ? "page" : undefined}
                >
                  <span className="truncate">{item.title}</span>
                </button>
              </li>
            ))}
          </ul>

          <p className="px-3 pt-4 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-text-3">
            Yesterday
          </p>
          <ul className="space-y-px">
            {DEMO_SESSIONS.yesterday.map((item) => (
              <li key={item.id}>
                <button type="button" className="session-item">
                  <span className="truncate">{item.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="border-t border-border px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[11px] font-semibold text-text-2">
              {DEMO_USER_INITIALS}
            </div>
            <span className="text-[13px] font-medium text-text-2">{DEMO_USER_NAME}</span>
          </div>
        </div>
      </aside>

      {/* ── Main canvas ── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">

        {/* ── EMPTY STATE ── */}
        {showEmptyState && (
          <div className="flex flex-1 flex-col items-center justify-center px-4 pb-10">
            <div className="w-full max-w-[680px]">
              <h1 className="mb-7 text-center text-[1.75rem] font-semibold tracking-[-0.02em] text-text-1">
                {greeting}, {DEMO_USER_NAME}.
              </h1>

              {renderComposer()}

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

        {/* ── CHAT STATE ── */}
        {!showEmptyState && (
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
              <div className="mx-auto w-full max-w-[760px] space-y-6 px-4 py-8 md:px-6">
                {messages.map((message, index) => (
                  <article key={`${message.role}-${index}`} className="msg-enter">

                    {/* ── User message ── */}
                    {message.role === "user" ? (
                      editingIndex === index ? (
                        /* Inline edit mode */
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
                        /* Normal user bubble with hover actions */
                        <div className="group flex flex-col items-end gap-1.5">
                          <div className="msg-user">
                            <p className="whitespace-pre-wrap">{message.content}</p>
                          </div>
                          <div className="flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                            <button
                              type="button"
                              onClick={() => copyToClipboard(message.content, index)}
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
                      /* ── Assistant message ── */
                      <div className="msg-assistant">
                        <p className="mb-2.5 text-[11px] font-medium text-text-3">Agent</p>

                        {message.content ? (
                          <>
                            {/* "Thought for Xs" badge — shown for latest assistant message */}
                            {thoughtForSeconds !== null && index === messages.length - 1 && (
                              <div className="thought-badge" aria-label={`Agent thought for ${thoughtForSeconds} seconds`}>
                                <span className="thought-dot" />
                                Thought for {thoughtForSeconds}s
                              </div>
                            )}

                            <div className="markdown-content">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                  a: ({ ...props }) => (
                                    <a {...props} target="_blank" rel="noopener noreferrer" />
                                  ),
                                }}
                              >
                                {message.content}
                              </ReactMarkdown>
                            </div>

                            {/* Copy icon — only after streaming ends for this message */}
                            {(!isStreaming || index < messages.length - 1) && (
                              <div className="mt-3">
                                <button
                                  type="button"
                                  onClick={() => copyToClipboard(message.content, index)}
                                  className="msg-tool-btn"
                                  aria-label="Copy response"
                                  title={copiedIndex === index ? "Copied!" : "Copy"}
                                >
                                  {copiedIndex === index ? (
                                    <Check size={13} />
                                  ) : (
                                    <Copy size={13} />
                                  )}
                                </button>
                              </div>
                            )}
                          </>
                        ) : isStreaming && index === messages.length - 1 ? (
                          /* Thinking state — no content yet */
                          <div className="thinking-indicator" aria-live="polite" aria-label="Agent is thinking">
                            <span className="thinking-dots">
                              <span /><span /><span />
                            </span>
                            <span className="thinking-label">
                              {thinkingSeconds > 0 ? `Thinking… ${thinkingSeconds}s` : "Thinking…"}
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

            {/* Docked composer */}
            <div className="shrink-0 px-4 pb-5 pt-2 md:px-6">
              <div className="mx-auto w-full max-w-[760px]">
                {renderComposer()}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
