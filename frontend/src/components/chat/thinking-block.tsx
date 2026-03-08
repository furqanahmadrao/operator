"use client";

import { Brain } from "lucide-react";
import { ToolBlock } from "./tool-activity";

interface ThinkingBlockProps {
  /** Accumulated reasoning text from the model's <think>…</think> block */
  content: string;
  /** How many seconds the model spent in the thinking phase */
  seconds: number;
  /** True while the model is still streaming tokens */
  isStreaming: boolean;
}

/**
 * ThinkingBlock — collapsible ToolBlock showing the model's chain-of-thought.
 *
 * Uses the same generic ToolBlock pattern as WebSearchBlock for visual consistency.
 *
 * Behaviour:
 *   - Streaming  → running spinner, "Thinking… Xs" title, not expandable
 *   - Done       → check icon, "Reasoned for Xs" title, collapsed dropdown
 *   - Expanded   → scrollable pre-formatted reasoning text
 */
export function ThinkingBlock({ content, seconds, isStreaming }: ThinkingBlockProps) {
  const hasContent = content.length > 0;

  if (!hasContent && !isStreaming) return null;

  const title = isStreaming
    ? seconds > 0
      ? `Thinking… ${seconds}s`
      : "Thinking…"
    : `Reasoned for ${seconds}s`;

  return (
    <ToolBlock
      status={isStreaming ? "running" : "completed"}
      icon={<Brain size={11} />}
      title={title}
      defaultExpanded={false}
    >
      {hasContent ? (
        <div className="thinking-content">
          <pre className="thinking-pre">{content.trim()}</pre>
        </div>
      ) : null}
    </ToolBlock>
  );
}
