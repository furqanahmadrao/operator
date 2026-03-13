"use client";

import { useEffect, useState } from "react";
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
 *   - Streaming  → auto-expands to show live reasoning, max height 50vh
 *   - Done       → auto-collapses after 1s delay (unless manually controlled)
 *   - Manual toggle → prevents auto-collapse behavior
 */
export function ThinkingBlock({ content, seconds, isStreaming }: ThinkingBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [manuallyCollapsed, setManuallyCollapsed] = useState(false);

  const hasContent = content.length > 0;

  // Auto-expand when streaming starts
  useEffect(() => {
    if (isStreaming && !manuallyCollapsed && !isExpanded) {
      // Use a microtask to defer state update
      Promise.resolve().then(() => setIsExpanded(true));
    }
  }, [isStreaming, manuallyCollapsed, isExpanded]);

  // Auto-collapse when streaming completes (with 1s delay)
  useEffect(() => {
    if (!isStreaming && isExpanded && !manuallyCollapsed) {
      const timer = setTimeout(() => {
        setIsExpanded(false);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [isStreaming, isExpanded, manuallyCollapsed]);

  // Manual toggle handler
  const handleToggle = () => {
    setIsExpanded(!isExpanded);
    setManuallyCollapsed(true); // User took control
  };

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
      defaultExpanded={isExpanded}
      onToggle={handleToggle}
    >
      {hasContent ? (
        <div 
          className="thinking-content" 
          style={{ maxHeight: isStreaming ? "50vh" : "none" }}
        >
          <pre className="thinking-pre">{content.trim()}</pre>
        </div>
      ) : null}
    </ToolBlock>
  );
}
