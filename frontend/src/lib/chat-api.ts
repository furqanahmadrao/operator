export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  role: ChatRole;
  content: string;
  /** ID of the artifact produced by this message, if any */
  artifactId?: string;
  /** Persisted tool events (e.g. web search) attached to this message */
  toolEvents?: ToolEvent[];
};

// Artifact as returned inside the artifact_created SSE event
export type ArtifactPayload = {
  id: string;
  session_id: string;
  source_message_id: string | null;
  type: string;
  title: string;
  content: string;
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
  status: "completed" | "error";
  query: string;
  result_count: number;
  results: SearchResultItem[];
  search_id: string;
  timestamp: string;
  message?: string;
};

/**
 * A persisted date-check tool event embedded in a ChatMessage.
 */
export type DateCheckEvent = {
  type: "date_check";
  date: string;
  time: string;
  timestamp: string;
};

/**
 * A persisted tool event embedded in a ChatMessage after streaming completes
 * (and restored from metadata_json when a session is loaded).
 */
export type ToolEvent = WebSearchEvent | DateCheckEvent;

type StreamEvent =
  | { type: "token"; content: string }
  | { type: "error"; message: string };

type SessionStreamEvent =
  | { type: "token"; content: string }
  | { type: "error"; message: string }
  | { type: "message_ids"; user_message_id: string; assistant_message_id: string }
  | { type: "artifact_created"; artifact: ArtifactPayload }
  | ({ type: "tool_activity" } & ToolActivityPayload)
  | ({ type: "search_results" } & SearchResultsPayload);

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
  onToolActivity: ((payload: ToolActivityPayload) => void) | undefined,
  onSearchResults: ((payload: SearchResultsPayload) => void) | undefined,
  signal?: AbortSignal,
  webSearchEnabled = true,
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, web_search_enabled: webSearchEnabled }),
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
        continue;
      }

      if (parsed.type === "token") {
        onToken(parsed.content);
      } else if (parsed.type === "error") {
        throw new Error(parsed.message);
      } else if (parsed.type === "artifact_created") {
        onArtifact(parsed.artifact);
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
        } else {
          onToolActivity?.({
            tool: "web_search",
            status: raw.status as "running" | "error",
            query: raw.query as string,
            message: raw.message as string | undefined,
          });
        }
      } else if (parsed.type === "search_results") {
        onSearchResults?.({
          tool: parsed.tool,
          query: parsed.query,
          results: parsed.results,
          result_count: parsed.result_count,
          search_id: parsed.search_id,
        });
      }
      // message_ids: stored server-side, not needed client-side yet
    }
  }
}
