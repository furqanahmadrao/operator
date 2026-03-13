"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Copy, Search, X, RotateCcw } from "lucide-react";
import "@xterm/xterm/css/xterm.css";

// ── Types ─────────────────────────────────────────────────────────────────────

export type TerminalLine = {
  content: string;
  type: "stdout" | "stderr" | "prompt";
  timestamp: string;
  command?: string;
};

export type TerminalTheme = "dark" | "light";

export interface TerminalProps {
  /** Terminal output lines to display */
  output: TerminalLine[];
  /** Callback when terminal is cleared */
  onClear?: () => void;
  /** Terminal theme */
  theme?: TerminalTheme;
  /** Show line numbers */
  showLineNumbers?: boolean;
  /** Maximum lines to keep in terminal */
  maxLines?: number;
  /** Terminal height in pixels */
  height?: number;
  /** Whether terminal should auto-scroll to bottom */
  autoScroll?: boolean;
  /** CSS class name */
  className?: string;
}

// ── Theme configurations ──────────────────────────────────────────────────────

const THEMES = {
  dark: {
    background: "#1e1e1e",
    foreground: "#d4d4d4",
    cursor: "#ffffff",
    cursorAccent: "#000000",
    selection: "#264f78",
    black: "#000000",
    red: "#f14c4c",
    green: "#23d18b",
    yellow: "#f5f543",
    blue: "#3b8eea",
    magenta: "#d670d6",
    cyan: "#29b8db",
    white: "#e5e5e5",
    brightBlack: "#666666",
    brightRed: "#f14c4c",
    brightGreen: "#23d18b",
    brightYellow: "#f5f543",
    brightBlue: "#3b8eea",
    brightMagenta: "#d670d6",
    brightCyan: "#29b8db",
    brightWhite: "#e5e5e5",
  },
  light: {
    background: "#ffffff",
    foreground: "#333333",
    cursor: "#000000",
    cursorAccent: "#ffffff",
    selection: "#add6ff",
    black: "#000000",
    red: "#cd3131",
    green: "#00bc00",
    yellow: "#949800",
    blue: "#0451a5",
    magenta: "#bc05bc",
    cyan: "#0598bc",
    white: "#555555",
    brightBlack: "#666666",
    brightRed: "#cd3131",
    brightGreen: "#00bc00",
    brightYellow: "#949800",
    brightBlue: "#0451a5",
    brightMagenta: "#bc05bc",
    brightCyan: "#0598bc",
    brightWhite: "#a5a5a5",
  },
};

// ── Component ─────────────────────────────────────────────────────────────────

export function Terminal({
  output = [],
  onClear,
  theme = "dark",
  showLineNumbers = false,
  maxLines = 10000,
  height = 400,
  autoScroll = true,
  className = "",
}: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const lastOutputLengthRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ── Initialize xterm.js ───────────────────────────────────────────────────
  useEffect(() => {
    if (!terminalRef.current) return;

    const terminal = new XTerm({
      theme: THEMES[theme],
      fontFamily: '"Fira Code", "SF Mono", Monaco, Inconsolata, "Roboto Mono", "Source Code Pro", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: "block",
      scrollback: maxLines,
      convertEol: true,
      disableStdin: true, // Read-only terminal
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);

    terminal.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Handle scroll events to detect user scrolling
    terminal.onScroll(() => {
      const isAtBottom = terminal.buffer.active.viewportY + terminal.rows >= terminal.buffer.active.length;
      setIsUserScrolling(!isAtBottom);
    });

    // Handle resize
    const handleResize = () => {
      fitAddon.fit();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      terminal.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [theme, maxLines]);

  // ── Update terminal content when output changes ───────────────────────────
  useEffect(() => {
    const terminal = xtermRef.current;
    if (!terminal) return;

    // Only process new lines since last update
    const newLines = output.slice(lastOutputLengthRef.current);
    lastOutputLengthRef.current = output.length;

    for (const line of newLines) {
      let formattedContent = line.content;
      
      // Add line number if enabled
      if (showLineNumbers) {
        const lineNum = output.indexOf(line) + 1;
        formattedContent = `${lineNum.toString().padStart(4, " ")} │ ${formattedContent}`;
      }

      // Add color coding based on stream type
      if (line.type === "stderr") {
        formattedContent = `\x1b[31m${formattedContent}\x1b[0m`; // Red for stderr
      } else if (line.type === "prompt") {
        formattedContent = `\x1b[32m${formattedContent}\x1b[0m`; // Green for prompts
      }

      // Write to terminal
      terminal.writeln(formattedContent);
    }

    // Auto-scroll to bottom if enabled and user isn't manually scrolling
    if (autoScroll && !isUserScrolling && newLines.length > 0) {
      terminal.scrollToBottom();
    }
  }, [output, showLineNumbers, autoScroll, isUserScrolling]);

  // ── Search functionality ──────────────────────────────────────────────────
  const handleSearch = useCallback((term: string) => {
    const terminal = xtermRef.current;
    if (!terminal || !term) return;

    // Simple search implementation - highlight matching text
    // Note: This is a basic implementation. For advanced search,
    // consider using xterm-addon-search when it's available for @xterm/xterm
    const buffer = terminal.buffer.active;
    let found = false;

    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i);
      if (line) {
        const lineText = line.translateToString();
        if (lineText.toLowerCase().includes(term.toLowerCase())) {
          terminal.scrollToLine(i);
          found = true;
          break;
        }
      }
    }

    if (!found) {
      // Could show "not found" message
      console.log("Search term not found:", term);
    }
  }, []);

  // ── Copy terminal content ─────────────────────────────────────────────────
  const handleCopy = useCallback(async () => {
    const terminal = xtermRef.current;
    if (!terminal) return;

    try {
      // Get selected text or all visible content
      const selection = terminal.getSelection();
      let textToCopy = selection;
      
      if (!textToCopy) {
        // If no selection, copy all output as text
        textToCopy = output.map(line => line.content).join('\n');
      }
      
      await navigator.clipboard.writeText(textToCopy);
    } catch (error) {
      console.error("Failed to copy terminal content:", error);
    }
  }, [output]);

  // ── Clear terminal ────────────────────────────────────────────────────────
  const handleClear = useCallback(() => {
    const terminal = xtermRef.current;
    if (!terminal) return;

    terminal.clear();
    lastOutputLengthRef.current = 0;
    onClear?.();
  }, [onClear]);

  // ── Focus search input when search opens ──────────────────────────────────
  useEffect(() => {
    if (isSearchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isSearchOpen]);

  // ── Handle search input ───────────────────────────────────────────────────
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchTerm.trim()) {
      handleSearch(searchTerm.trim());
    }
  };

  return (
    <div className={`terminal-container ${className}`}>
      {/* Terminal toolbar */}
      <div className="flex items-center justify-between p-2 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Terminal
          </span>
          {output.length > 0 && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {output.length} lines
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-1">
          {/* Search toggle */}
          <button
            onClick={() => setIsSearchOpen(!isSearchOpen)}
            className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            title="Search terminal output"
          >
            <Search className="w-4 h-4 text-gray-600 dark:text-gray-400" />
          </button>
          
          {/* Copy button */}
          <button
            onClick={handleCopy}
            className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            title="Copy terminal content"
          >
            <Copy className="w-4 h-4 text-gray-600 dark:text-gray-400" />
          </button>
          
          {/* Clear button */}
          {onClear && (
            <button
              onClick={handleClear}
              className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              title="Clear terminal"
            >
              <RotateCcw className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            </button>
          )}
        </div>
      </div>

      {/* Search bar */}
      {isSearchOpen && (
        <div className="p-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
          <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
            <input
              ref={searchInputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search terminal output..."
              className="flex-1 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
              Search
            </button>
            <button
              type="button"
              onClick={() => setIsSearchOpen(false)}
              className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              <X className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            </button>
          </form>
        </div>
      )}

      {/* Terminal display */}
      <div 
        ref={terminalRef}
        style={{ height: `${height}px` }}
        className="terminal-display bg-gray-900 dark:bg-black"
      />

      {/* Auto-scroll indicator */}
      {isUserScrolling && autoScroll && (
        <div className="absolute bottom-4 right-4 bg-blue-600 text-white px-3 py-1 rounded-full text-sm shadow-lg">
          <button
            onClick={() => {
              xtermRef.current?.scrollToBottom();
              setIsUserScrolling(false);
            }}
            className="flex items-center gap-1 hover:bg-blue-700 px-2 py-1 rounded transition-colors"
          >
            <span>Scroll to bottom</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ── Utility functions ─────────────────────────────────────────────────────────

/**
 * Converts terminal output events to TerminalLine format
 */
export function terminalEventToLine(
  content: string,
  streamType: "stdout" | "stderr",
  timestamp?: string,
  command?: string
): TerminalLine {
  return {
    content: content.replace(/\n$/, ""), // Remove trailing newline
    type: streamType,
    timestamp: timestamp || new Date().toISOString(),
    command,
  };
}

/**
 * Creates a prompt line for terminal display
 */
export function createPromptLine(
  workingDirectory: string,
  command: string,
  timestamp?: string
): TerminalLine {
  const prompt = `${workingDirectory}$ ${command}`;
  return {
    content: prompt,
    type: "prompt",
    timestamp: timestamp || new Date().toISOString(),
    command,
  };
}