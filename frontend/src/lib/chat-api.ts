export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  role: ChatRole;
  content: string;
  /** ID of the artifact produced by this message, if any */
  artifactId?: string;
  /** Persisted tool events (e.g. web search) attached to this message */
  toolEvents?: ToolEvent[];
  /** Reasoning/thinking content emitted by the model (ephemeral, not persisted to DB) */
  thinkingContent?: string;
  /** How many seconds the model spent in the <think> phase before first response token */
  thinkingSeconds?: number;
};

// Artifact as returned inside the artifact_created / artifact_updated SSE events
export type ArtifactPayload = {
  id: string;
  session_id: string;
  source_message_id: string | null;
  type: string;
  title: string;
  content: string;
  version: number;
  created_at: string;
  updated_at: string;
};

// ── Web search types ──────────────────────────────────────────────────────────

export type SearchResultItem = {
  title: string;
  url: string;
  snippet: string;
  domain: string;
};

/** Emitted when a web-search tool starts/errors (before results arrive) */
export type WebSearchActivity = {
  tool: "web_search";
  status: "running" | "error";
  query: string;
  message?: string;
};

/** Emitted when the date/time was checked before a search */
export type DateCheckActivity = {
  tool: "date_check";
  status: "completed";
  date: string;
  time: string;
};

/** Emitted when a tool starts/errors (before results arrive) */
export type ToolActivityPayload = WebSearchActivity | DateCheckActivity;

/** Emitted when Tavily results are ready */
export type SearchResultsPayload = {
  tool: "web_search";
  query: string;
  results: SearchResultItem[];
  result_count: number;
  search_id: string;
};

/**
 * A persisted web-search tool event embedded in a ChatMessage.
 */
export type WebSearchEvent = {
  type: "web_search";
  status: "completed" | "error" | "running";
  query: string;
  result_count: number;
  results: SearchResultItem[];
  search_id: string;
  timestamp: string;
  message?: string;
  toolId?: string; // ID for matching with sentinel markers
};

/**
 * A persisted date-check tool event embedded in a ChatMessage.
 */
export type DateCheckEvent = {
  type: "date_check";
  date: string;
  time: string;
  timestamp: string;
  toolId?: string; // ID for matching with sentinel markers
};

/**
 * A persisted generic tool start event embedded in a ChatMessage.
 */
export type ToolStartEvent = {
  type: "tool_start";
  tool_name: string;
  parameters?: Record<string, unknown>;
  timestamp: string;
  toolId?: string; // ID for matching with sentinel markers
  correlation_id?: string;
};

/**
 * A persisted generic tool end event embedded in a ChatMessage.
 */
export type ToolEndEvent = {
  type: "tool_end";
  tool_name: string;
  result_summary?: string;
  status: "success" | "failed";
  error?: string;
  duration_ms: number;
  timestamp: string;
  toolId?: string; // ID for matching with sentinel markers
  correlation_id?: string;
};

/**
 * A persisted tool event embedded in a ChatMessage after streaming completes
 * (and restored from metadata_json when a session is loaded).
 */
export type ToolEvent = WebSearchEvent | DateCheckEvent | ToolStartEvent | ToolEndEvent;

// ── Terminal types ────────────────────────────────────────────────────────────

export type TerminalOutputEvent = {
  type: "terminal_output";
  content: string;
  stream_type: "stdout" | "stderr";
  command_context?: string;
  working_directory: string;
  timestamp: string;
  session_id: string;
  correlation_id?: string;
};

export type TerminalCompleteEvent = {
  type: "terminal_complete";
  exit_code: number;
  command: string;
  duration_ms: number;
  timestamp: string;
  session_id: string;
  correlation_id?: string;
};

// ── Browser types ─────────────────────────────────────────────────────────────

export type BrowserNavigateEvent = {
  type: "browser_navigate";
  url: string;
  session_name: string;
  status: "started" | "completed" | "failed";
  error?: string;
  timestamp: string;
  session_id: string;
  correlation_id?: string;
};

export type BrowserClickEvent = {
  type: "browser_click";
  selector: string;
  session_name: string;
  status: "started" | "completed" | "failed";
  error?: string;
  timestamp: string;
  session_id: string;
  correlation_id?: string;
};

export type BrowserScreenshotEvent = {
  type: "browser_screenshot";
  filename: string;
  session_name: string;
  status: "started" | "completed" | "failed";
  error?: string;
  timestamp: string;
  session_id: string;
  correlation_id?: string;
};

// ── Planning and Reflection types ─────────────────────────────────────────────

export type PlanningEvent = {
  type: "planning";
  sub_tasks: string[];
  reasoning: string;
  timestamp: string;
  session_id: string;
  correlation_id?: string;
};

export type ReflectionEvent = {
  type: "reflection";
  observation: string;
  adjustment?: string;
  timestamp: string;
  session_id: string;
  correlation_id?: string;
};

// ── Deep research types ───────────────────────────────────────────────────────

export type ClarifyingQuestion = {
  id: string;
  text: string;
  /** Undefined falls back to single_select for backwards-compat */
  type?: "single_select" | "multi_select" | "text";
  choices: string[];
};

export type TodoItem = {
  id: string;
  text: string;
  status: "pending" | "active" | "done";
};

type StreamEvent =
  | { type: "token"; content: string }
  | { type: "error"; message: string };

type SessionStreamEvent =
  | { type: "token"; content: string }
  | { type: "thinking"; content: string }
  | { type: "error"; message: string }
  | { type: "message_ids"; user_message_id: string; assistant_message_id: string }
  | { type: "artifact_created"; artifact: ArtifactPayload }
  | { type: "artifact_updated"; artifact: ArtifactPayload }
  | ({ type: "tool_activity" } & ToolActivityPayload)
  | ({ type: "search_results" } & SearchResultsPayload)
  | { type: "clarifying_questions"; questions: ClarifyingQuestion[] }
  | { type: "deep_research_plan"; sub_questions: string[]; iteration: number }
  | { type: "deep_research_progress"; step: string }
  | { type: "todo_update"; items: TodoItem[] }
  | TerminalOutputEvent
  | TerminalCompleteEvent
  | BrowserNavigateEvent
  | BrowserClickEvent
  | BrowserScreenshotEvent
  | PlanningEvent
  | ReflectionEvent
  | ({ type: "tool_start" } & Omit<ToolStartEvent, "type">)
  | ({ type: "tool_end" } & Omit<ToolEndEvent, "type">);

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ??
  "http://localhost:8000";

export async function streamChatCompletion(
  messages: ChatMessage[],
  onToken: (token: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messages }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "Failed to fetch chat response.");
  }

  if (!response.body) {
    throw new Error("Streaming not supported in this browser.");
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const eventChunk of events) {
      const dataLine = eventChunk
        .split("\n")
        .find((line) => line.startsWith("data: "));

      if (!dataLine) {
        continue;
      }

      const data = dataLine.slice(6).trim();
      if (data === "[DONE]") {
        return;
      }

      let parsed: StreamEvent;
      try {
        parsed = JSON.parse(data) as StreamEvent;
      } catch {
        continue;
      }

      if (parsed.type === "token") {
        onToken(parsed.content);
      }

      if (parsed.type === "error") {
        throw new Error(parsed.message);
      }
    }
  }
}

// ── Session-aware streaming ────────────────────────────────────────────────

export async function streamSessionChat(
  sessionId: string,
  content: string,
  onToken: (token: string) => void,
  onArtifact: (artifact: ArtifactPayload) => void,
  onArtifactUpdated: ((artifact: ArtifactPayload) => void) | undefined,
  onToolActivity: ((payload: ToolActivityPayload) => void) | undefined,
  onSearchResults: ((payload: SearchResultsPayload) => void) | undefined,
  onThinking: ((content: string) => void) | undefined,
  signal?: AbortSignal,
  webSearchEnabled = true,
  thinkEnabled = false,
  deepResearchEnabled = false,
  clarifications?: Record<string, string>,
  onClarifyingQuestions?: (questions: ClarifyingQuestion[]) => void,
  onDeepResearchPlan?: (subQuestions: string[], iteration: number) => void,
  onDeepResearchProgress?: (step: string) => void,
  onTodoUpdate?: (items: TodoItem[]) => void,
  onTerminalOutput?: (event: TerminalOutputEvent) => void,
  onTerminalComplete?: (event: TerminalCompleteEvent) => void,
  onBrowserNavigate?: (event: BrowserNavigateEvent) => void,
  onBrowserClick?: (event: BrowserClickEvent) => void,
  onBrowserScreenshot?: (event: BrowserScreenshotEvent) => void,
  onToolStart?: (event: ToolStartEvent) => void,
  onToolEnd?: (event: ToolEndEvent) => void,
  onPlanning?: (event: PlanningEvent) => void,
  onReflection?: (event: ReflectionEvent) => void,
): Promise<void> {
  console.log("[SSE] Starting stream for session:", sessionId);
  const response = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
      web_search_enabled: webSearchEnabled,
      think_enabled: thinkEnabled,
      deep_research_enabled: deepResearchEnabled,
      clarifications: clarifications ?? null,
    }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "Failed to fetch chat response.");
  }

  if (!response.body) {
    throw new Error("Streaming not supported in this browser.");
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const eventChunk of events) {
      const dataLine = eventChunk
        .split("\n")
        .find((line) => line.startsWith("data: "));

      if (!dataLine) continue;

      const data = dataLine.slice(6).trim();
      if (data === "[DONE]") return;

      let parsed: SessionStreamEvent;
      try {
        parsed = JSON.parse(data) as SessionStreamEvent;
      } catch {
        console.warn("[SSE] Failed to parse event:", data);
        continue;
      }

      if (parsed.type === "token") {
        console.log("[SSE] Token received:", parsed.content.substring(0, 50));
        onToken(parsed.content);
      } else if (parsed.type === "thinking") {
        onThinking?.(parsed.content);
      } else if (parsed.type === "error") {
        throw new Error(parsed.message);
      } else if (parsed.type === "artifact_created") {
        onArtifact(parsed.artifact);
      } else if (parsed.type === "artifact_updated") {
        onArtifactUpdated?.(parsed.artifact);
      } else if (parsed.type === "tool_activity") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = parsed as any;
        if (raw.tool === "date_check") {
          onToolActivity?.({
            tool: "date_check",
            status: "completed",
            date: raw.date as string,
            time: raw.time as string,
          });
        } else if (raw.tool === "web_search") {
          // Only forward web_search activities — other internal tools
          // (create_artifact, list_session_artifacts, get_current_datetime)
          // have no dedicated frontend spinner and were previously incorrectly
          // mapped here, causing a permanent "Searching the web…" state.
          onToolActivity?.({
            tool: "web_search",
            status: raw.status as "running" | "error",
            query: raw.query as string,
            message: raw.message as string | undefined,
          });
        }
        // All other tool_activity types are intentionally ignored.
      } else if (parsed.type === "search_results") {
        onSearchResults?.({
          tool: parsed.tool,
          query: parsed.query,
          results: parsed.results,
          result_count: parsed.result_count,
          search_id: parsed.search_id,
        });
      } else if (parsed.type === "clarifying_questions") {
        onClarifyingQuestions?.(parsed.questions);
      } else if (parsed.type === "deep_research_plan") {
        onDeepResearchPlan?.(parsed.sub_questions, parsed.iteration);
      } else if (parsed.type === "deep_research_progress") {
        onDeepResearchProgress?.(parsed.step);
      } else if (parsed.type === "todo_update") {
        onTodoUpdate?.(parsed.items);
      } else if (parsed.type === "terminal_output") {
        onTerminalOutput?.(parsed as TerminalOutputEvent);
      } else if (parsed.type === "terminal_complete") {
        onTerminalComplete?.(parsed as TerminalCompleteEvent);
      } else if (parsed.type === "browser_navigate") {
        onBrowserNavigate?.(parsed as BrowserNavigateEvent);
      } else if (parsed.type === "browser_click") {
        onBrowserClick?.(parsed as BrowserClickEvent);
      } else if (parsed.type === "browser_screenshot") {
        onBrowserScreenshot?.(parsed as BrowserScreenshotEvent);
      } else if (parsed.type === "tool_start") {
        onToolStart?.(parsed as ToolStartEvent);
      } else if (parsed.type === "tool_end") {
        onToolEnd?.(parsed as ToolEndEvent);
      } else if (parsed.type === "planning") {
        onPlanning?.(parsed as PlanningEvent);
      } else if (parsed.type === "reflection") {
        onReflection?.(parsed as ReflectionEvent);
      }
      // message_ids: stored server-side, not needed client-side yet
    }
  }
}
