"use client";

import { useState, useEffect } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Terminal,
  Globe,
  FileText,
  Code,
  Database,
  Settings,
  Loader2,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ToolCardStatus = "loading" | "completed" | "failed";

export interface ToolCardProps {
  /** Unique identifier for the tool invocation */
  toolId: string;
  /** Name of the tool being executed */
  toolName: string;
  /** Current status of the tool execution */
  status: ToolCardStatus;
  /** Tool parameters/command being executed */
  parameters?: Record<string, unknown>;
  /** Execution duration in milliseconds */
  duration?: number;
  /** Tool output/result */
  output?: string;
  /** Error message if status is failed */
  error?: string;
  /** Start expanded? Default: false (collapsed) */
  defaultExpanded?: boolean;
  /** Callback when expansion state changes */
  onToggle?: (expanded: boolean) => void;
  /** CSS class name */
  className?: string;
}

// ── Tool type mappings ────────────────────────────────────────────────────────

const TOOL_ICONS: Record<string, React.ReactNode> = {
  // Terminal/Command tools
  execute_command: <Terminal size={11} />,
  change_directory: <Terminal size={11} />,
  list_directory: <Terminal size={11} />,
  
  // File operations
  read_file: <FileText size={11} />,
  write_file: <FileText size={11} />,
  delete_file: <FileText size={11} />,
  
  // Browser tools
  navigate_to_url: <Globe size={11} />,
  click_element: <Globe size={11} />,
  extract_page_content: <Globe size={11} />,
  fill_form_field: <Globe size={11} />,
  take_screenshot: <Globe size={11} />,
  execute_javascript: <Code size={11} />,
  
  // Database/MCP tools
  mcp_tool: <Database size={11} />,
  
  // Default fallback
  default: <Settings size={11} />,
};

const TOOL_COLORS: Record<string, string> = {
  // Terminal tools - blue theme
  execute_command: "text-blue-600 dark:text-blue-400",
  change_directory: "text-blue-600 dark:text-blue-400", 
  list_directory: "text-blue-600 dark:text-blue-400",
  
  // File tools - green theme
  read_file: "text-green-600 dark:text-green-400",
  write_file: "text-green-600 dark:text-green-400",
  delete_file: "text-red-600 dark:text-red-400",
  
  // Browser tools - purple theme
  navigate_to_url: "text-purple-600 dark:text-purple-400",
  click_element: "text-purple-600 dark:text-purple-400",
  extract_page_content: "text-purple-600 dark:text-purple-400",
  fill_form_field: "text-purple-600 dark:text-purple-400",
  take_screenshot: "text-purple-600 dark:text-purple-400",
  execute_javascript: "text-purple-600 dark:text-purple-400",
  
  // Database/MCP tools - orange theme
  mcp_tool: "text-orange-600 dark:text-orange-400",
  
  // Default
  default: "text-gray-600 dark:text-gray-400",
};

// ── Utility functions ─────────────────────────────────────────────────────────

function getToolIcon(toolName: string): React.ReactNode {
  return TOOL_ICONS[toolName] || TOOL_ICONS.default;
}

function getToolColor(toolName: string): string {
  return TOOL_COLORS[toolName] || TOOL_COLORS.default;
}

function formatDuration(durationMs?: number): string {
  if (!durationMs) return "";
  
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  } else if (durationMs < 60000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  } else {
    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
}

function formatToolName(toolName: string): string {
  // Convert snake_case to Title Case
  return toolName
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatParameters(parameters?: Record<string, unknown>): string {
  if (!parameters || Object.keys(parameters).length === 0) {
    return "";
  }
  
  // Format key parameters for display
  const entries = Object.entries(parameters);
  if (entries.length === 1) {
    const [key, value] = entries[0];
    if (typeof value === 'string' && value.length < 50) {
      return value;
    }
  }
  
  // For multiple parameters or long values, show count
  return `${entries.length} parameter${entries.length === 1 ? '' : 's'}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ToolCard({
  toolId,
  toolName,
  status,
  parameters,
  duration,
  output,
  error,
  defaultExpanded = false,
  onToggle,
  className = "",
}: ToolCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [startTime] = useState(() => Date.now());
  const [currentDuration, setCurrentDuration] = useState(duration || 0);

  // Update duration for running tools
  useEffect(() => {
    if (status !== "loading") {
      return;
    }

    const interval = setInterval(() => {
      setCurrentDuration(Date.now() - startTime);
    }, 100);

    return () => clearInterval(interval);
  }, [status, startTime]);

  // Sync with defaultExpanded prop changes
  useEffect(() => {
    setExpanded(defaultExpanded);
  }, [defaultExpanded]);

  const handleToggle = () => {
    const newExpanded = !expanded;
    setExpanded(newExpanded);
    onToggle?.(newExpanded);
  };

  const hasExpandableContent = !!(output || error || (parameters && Object.keys(parameters).length > 0));
  const isExpandable = hasExpandableContent && (status === "completed" || status === "failed");
  
  const toolIcon = getToolIcon(toolName);
  const toolColor = getToolColor(toolName);
  const formattedName = formatToolName(toolName);
  const parameterSummary = formatParameters(parameters);
  const displayDuration = duration || currentDuration;

  return (
    <div className={`tool-card ${className}`}>
      {/* Header */}
      {isExpandable ? (
        <button
          type="button"
          className="tool-card-header tool-card-header-clickable"
          onClick={handleToggle}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${formattedName} tool details`}
        >
          <ToolCardHeader
            status={status}
            toolIcon={toolIcon}
            toolColor={toolColor}
            formattedName={formattedName}
            parameterSummary={parameterSummary}
            displayDuration={displayDuration}
            isExpandable={isExpandable}
            expanded={expanded}
            error={error}
          />
        </button>
      ) : (
        <div className="tool-card-header">
          <ToolCardHeader
            status={status}
            toolIcon={toolIcon}
            toolColor={toolColor}
            formattedName={formattedName}
            parameterSummary={parameterSummary}
            displayDuration={displayDuration}
            isExpandable={isExpandable}
            expanded={expanded}
            error={error}
          />
        </div>
      )}

      {/* Expandable content */}
      {isExpandable && expanded && (
        <div className="tool-card-body">
          <ToolCardContent
            parameters={parameters}
            output={output}
            error={error}
            status={status}
          />
        </div>
      )}
    </div>
  );
}

// ── Header component ──────────────────────────────────────────────────────────

interface ToolCardHeaderProps {
  status: ToolCardStatus;
  toolIcon: React.ReactNode;
  toolColor: string;
  formattedName: string;
  parameterSummary: string;
  displayDuration: number;
  isExpandable: boolean;
  expanded: boolean;
  error?: string;
}

function ToolCardHeader({
  status,
  toolIcon,
  toolColor,
  formattedName,
  parameterSummary,
  displayDuration,
  isExpandable,
  expanded,
  error,
}: ToolCardHeaderProps) {
  return (
    <>
      {/* Status indicator */}
      <div className="tool-card-status">
        {status === "loading" ? (
          <Loader2 size={11} className="animate-spin text-blue-600 dark:text-blue-400" />
        ) : status === "completed" ? (
          <CheckCircle2 size={11} className="text-green-600 dark:text-green-400" />
        ) : (
          <AlertCircle size={11} className="text-red-600 dark:text-red-400" />
        )}
      </div>

      {/* Tool icon */}
      <div className={`tool-card-icon ${toolColor}`}>
        {toolIcon}
      </div>

      {/* Tool name */}
      <span className="tool-card-title">
        {formattedName}
      </span>

      {/* Parameter summary */}
      {parameterSummary && (
        <span className="tool-card-subtitle">
          {parameterSummary}
        </span>
      )}

      {/* Duration badge */}
      {displayDuration > 0 && (
        <div className="tool-card-badge">
          <Clock size={9} />
          <span>{formatDuration(displayDuration)}</span>
        </div>
      )}

      {/* Error indicator in header */}
      {status === "failed" && error && (
        <span className="tool-card-error-badge">
          Failed
        </span>
      )}

      {/* Expand/collapse chevron */}
      {isExpandable && (
        <div className="tool-card-chevron">
          {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </div>
      )}
    </>
  );
}

// ── Content component ─────────────────────────────────────────────────────────

interface ToolCardContentProps {
  parameters?: Record<string, unknown>;
  output?: string;
  error?: string;
  status: ToolCardStatus;
}

function ToolCardContent({
  parameters,
  output,
  error,
  status,
}: ToolCardContentProps) {
  return (
    <div className="space-y-3">
      {/* Parameters section */}
      {parameters && Object.keys(parameters).length > 0 && (
        <div className="tool-card-section">
          <h4 className="tool-card-section-title">Parameters</h4>
          <div className="tool-card-parameters">
            {Object.entries(parameters).map(([key, value]) => (
              <div key={key} className="tool-card-parameter">
                <span className="tool-card-parameter-key">{key}:</span>
                <span className="tool-card-parameter-value">
                  {typeof value === 'string' ? value : JSON.stringify(value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Output section */}
      {output && status === "completed" && (
        <div className="tool-card-section">
          <h4 className="tool-card-section-title">Output</h4>
          <div className="tool-card-output">
            <pre className="tool-card-output-content">{output}</pre>
          </div>
        </div>
      )}

      {/* Error section */}
      {error && status === "failed" && (
        <div className="tool-card-section">
          <h4 className="tool-card-section-title text-red-600 dark:text-red-400">Error</h4>
          <div className="tool-card-error">
            <pre className="tool-card-error-content">{error}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Export ────────────────────────────────────────────────────────────────────

export default ToolCard;