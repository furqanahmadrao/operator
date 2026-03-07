export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

type StreamEvent =
  | { type: "token"; content: string }
  | { type: "error"; message: string };

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
