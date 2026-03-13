"use client";

import { useState, useCallback, useRef } from "react";
import type { ToolStartEvent, ToolEndEvent } from "@/lib/chat-api";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ActiveToolCard {
  toolId: string;
  toolName: string;
  status: "loading" | "completed" | "failed";
  parameters?: Record<string, unknown>;
  startTime: number;
  duration?: number;
  output?: string;
  error?: string;
  correlationId?: string;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useToolCards() {
  const [activeTools, setActiveTools] = useState<Map<string, ActiveToolCard>>(new Map());
  const toolIdCounterRef = useRef(0);

  // Generate unique tool ID for correlation
  const generateToolId = useCallback(() => {
    return `tool-${Date.now()}-${++toolIdCounterRef.current}`;
  }, []);

  // Handle tool start event
  const handleToolStart = useCallback((event: ToolStartEvent) => {
    const toolId = event.toolId || generateToolId();
    const toolCard: ActiveToolCard = {
      toolId,
      toolName: event.tool_name,
      status: "loading",
      parameters: event.parameters,
      startTime: Date.now(),
      correlationId: event.correlation_id,
    };

    setActiveTools(prev => new Map(prev).set(toolId, toolCard));
    return toolId;
  }, [generateToolId]);

  // Handle tool end event
  const handleToolEnd = useCallback((event: ToolEndEvent) => {
    const toolId = event.toolId || event.correlation_id;
    if (!toolId) {
      console.warn("Tool end event missing toolId and correlation_id:", event);
      return;
    }

    setActiveTools(prev => {
      const newMap = new Map(prev);
      const existingTool = newMap.get(toolId);
      
      if (existingTool) {
        const updatedTool: ActiveToolCard = {
          ...existingTool,
          status: event.status === "success" ? "completed" : "failed",
          duration: event.duration_ms,
          output: event.result_summary,
          error: event.error,
        };
        newMap.set(toolId, updatedTool);
      } else {
        // Create a new tool card for orphaned end events
        const newTool: ActiveToolCard = {
          toolId,
          toolName: event.tool_name,
          status: event.status === "success" ? "completed" : "failed",
          startTime: Date.now() - event.duration_ms,
          duration: event.duration_ms,
          output: event.result_summary,
          error: event.error,
          correlationId: event.correlation_id,
        };
        newMap.set(toolId, newTool);
      }
      
      return newMap;
    });
  }, []);

  // Get all active tools as array
  const getActiveToolsArray = useCallback(() => {
    return Array.from(activeTools.values()).sort((a, b) => a.startTime - b.startTime);
  }, [activeTools]);

  // Get specific tool by ID
  const getToolById = useCallback((toolId: string) => {
    return activeTools.get(toolId);
  }, [activeTools]);

  // Clear all tools (for new session)
  const clearAllTools = useCallback(() => {
    setActiveTools(new Map());
  }, []);

  // Remove specific tool
  const removeTool = useCallback((toolId: string) => {
    setActiveTools(prev => {
      const newMap = new Map(prev);
      newMap.delete(toolId);
      return newMap;
    });
  }, []);

  // Update tool (for manual state changes)
  const updateTool = useCallback((toolId: string, updates: Partial<ActiveToolCard>) => {
    setActiveTools(prev => {
      const newMap = new Map(prev);
      const existingTool = newMap.get(toolId);
      if (existingTool) {
        newMap.set(toolId, { ...existingTool, ...updates });
      }
      return newMap;
    });
  }, []);

  return {
    activeTools: getActiveToolsArray(),
    handleToolStart,
    handleToolEnd,
    getToolById,
    clearAllTools,
    removeTool,
    updateTool,
  };
}

// ── Utility functions ─────────────────────────────────────────────────────────

/**
 * Find tool by correlation ID (for matching start/end events)
 */
export function findToolByCorrelationId(
  tools: ActiveToolCard[],
  correlationId?: string
): ActiveToolCard | undefined {
  if (!correlationId) return undefined;
  return tools.find(tool => tool.correlationId === correlationId);
}

/**
 * Check if tool is still loading
 */
export function isToolLoading(tool: ActiveToolCard): boolean {
  return tool.status === "loading";
}

/**
 * Get tool execution duration (current or final)
 */
export function getToolDuration(tool: ActiveToolCard): number {
  if (tool.duration !== undefined) {
    return tool.duration;
  }
  return Date.now() - tool.startTime;
}