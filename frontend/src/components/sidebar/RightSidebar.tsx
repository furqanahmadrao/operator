"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { 
  Terminal, 
  Globe, 
  Files, 
  X, 
  ChevronLeft, 
  ChevronRight
} from "lucide-react";

// Import existing components
import { Terminal as TerminalComponent, type TerminalLine } from "@/components/terminal/Terminal";
import { BrowserPreview, type BrowserPreviewProps } from "@/components/browser/BrowserPreview";
import { FilesPanel, type FilesPanelProps } from "@/components/files/FilesPanel";

// ── Types ─────────────────────────────────────────────────────────────────────

export type RightSidebarTab = "terminal" | "browser" | "files";

export interface RightSidebarProps {
  /** Whether the sidebar is open */
  isOpen: boolean;
  /** Current active tab */
  activeTab: RightSidebarTab;
  /** Whether the sidebar is collapsed (minimized) */
  isCollapsed: boolean;
  /** Sidebar width in pixels */
  width: number;
  /** Terminal component props */
  terminalProps?: {
    output: TerminalLine[];
    onClear?: () => void;
    theme?: "dark" | "light";
    showLineNumbers?: boolean;
    maxLines?: number;
    autoScroll?: boolean;
  };
  /** Browser preview component props */
  browserProps?: BrowserPreviewProps;
  /** Files panel component props */
  filesProps?: FilesPanelProps;
  /** Callback when tab changes */
  onTabChange?: (tab: RightSidebarTab) => void;
  /** Callback when sidebar is closed */
  onClose?: () => void;
  /** Callback when sidebar is collapsed/expanded */
  onToggleCollapse?: () => void;
  /** Callback when sidebar is resized */
  onResize?: (width: number) => void;
  /** CSS class name */
  className?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_WIDTH = 320;
const MAX_WIDTH = 900;
const DEFAULT_WIDTH = 560;

const TAB_CONFIG = {
  terminal: {
    id: "terminal" as const,
    label: "Terminal",
    icon: Terminal,
    shortcut: "T",
  },
  browser: {
    id: "browser" as const,
    label: "Browser",
    icon: Globe,
    shortcut: "B",
  },
  files: {
    id: "files" as const,
    label: "Files",
    icon: Files,
    shortcut: "F",
  },
} as const;

// ── Local Storage Keys ────────────────────────────────────────────────────────

const STORAGE_KEYS = {
  activeTab: "rightSidebar.activeTab",
  width: "rightSidebar.width",
  isCollapsed: "rightSidebar.isCollapsed",
} as const;

// ── Utility Functions ─────────────────────────────────────────────────────────

function getStoredValue<T>(key: string, defaultValue: T): T {
  if (typeof window === "undefined") return defaultValue;
  
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch {
    return defaultValue;
  }
}

function setStoredValue<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage errors
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RightSidebar({
  isOpen,
  activeTab: externalActiveTab,
  isCollapsed: externalIsCollapsed,
  width: externalWidth,
  terminalProps,
  browserProps,
  filesProps,
  onTabChange,
  onClose,
  onToggleCollapse,
  onResize,
  className = "",
}: RightSidebarProps) {
  // ── Internal state (with localStorage persistence) ─────────────────────────
  const [internalActiveTab, setInternalActiveTab] = useState<RightSidebarTab>(() =>
    getStoredValue(STORAGE_KEYS.activeTab, "terminal")
  );
  const [internalIsCollapsed, setInternalIsCollapsed] = useState<boolean>(() =>
    getStoredValue(STORAGE_KEYS.isCollapsed, false)
  );
  const [internalWidth, setInternalWidth] = useState<number>(() =>
    getStoredValue(STORAGE_KEYS.width, DEFAULT_WIDTH)
  );

  // Use external props if provided, otherwise use internal state
  const activeTab = externalActiveTab ?? internalActiveTab;
  const isCollapsed = externalIsCollapsed ?? internalIsCollapsed;
  const width = externalWidth ?? internalWidth;

  // ── Resize handling ───────────────────────────────────────────────────────
  const isResizingRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(0);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = width;

    const onMove = (ev: MouseEvent) => {
      if (!isResizingRef.current) return;
      // Dragging left increases width, right decreases it
      const delta = resizeStartXRef.current - ev.clientX;
      const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, resizeStartWidthRef.current + delta));
      
      if (externalWidth !== undefined) {
        onResize?.(newWidth);
      } else {
        setInternalWidth(newWidth);
        setStoredValue(STORAGE_KEYS.width, newWidth);
      }
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
  }, [width, externalWidth, onResize]);

  // ── Tab handling ──────────────────────────────────────────────────────────
  const handleTabChange = useCallback((tab: RightSidebarTab) => {
    if (externalActiveTab !== undefined) {
      onTabChange?.(tab);
    } else {
      setInternalActiveTab(tab);
      setStoredValue(STORAGE_KEYS.activeTab, tab);
    }
  }, [externalActiveTab, onTabChange]);

  // ── Collapse handling ─────────────────────────────────────────────────────
  const handleToggleCollapse = useCallback(() => {
    if (externalIsCollapsed !== undefined) {
      onToggleCollapse?.();
    } else {
      const newCollapsed = !isCollapsed;
      setInternalIsCollapsed(newCollapsed);
      setStoredValue(STORAGE_KEYS.isCollapsed, newCollapsed);
    }
  }, [externalIsCollapsed, isCollapsed, onToggleCollapse]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle shortcuts when sidebar is focused or no input is focused
      const activeElement = document.activeElement;
      const isInputFocused = activeElement?.tagName === "INPUT" || 
                           activeElement?.tagName === "TEXTAREA" ||
                           (activeElement as HTMLElement)?.contentEditable === "true";
      
      if (isInputFocused) return;

      // Cmd/Ctrl + Shift + [T/B/F] for tab switching
      if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
        switch (e.key.toLowerCase()) {
          case "t":
            e.preventDefault();
            handleTabChange("terminal");
            break;
          case "b":
            e.preventDefault();
            handleTabChange("browser");
            break;
          case "f":
            e.preventDefault();
            handleTabChange("files");
            break;
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleTabChange]);

  // ── Render helpers ────────────────────────────────────────────────────────
  const renderTabContent = () => {
    if (isCollapsed) return null;

    const contentHeight = "calc(100% - 48px)"; // Subtract header height

    switch (activeTab) {
      case "terminal":
        return (
          <div className="h-full overflow-hidden" style={{ height: contentHeight }}>
            {terminalProps ? (
              <TerminalComponent
                {...terminalProps}
                height={undefined} // Let it fill the container
                className="h-full"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-gray-500 dark:text-gray-400">
                <div className="text-center">
                  <Terminal className="mx-auto h-12 w-12 mb-4 opacity-50" />
                  <p className="text-sm">No terminal session active</p>
                </div>
              </div>
            )}
          </div>
        );

      case "browser":
        return (
          <div className="h-full overflow-hidden" style={{ height: contentHeight }}>
            {browserProps ? (
              <BrowserPreview
                {...browserProps}
                height={undefined} // Let it fill the container
                className="h-full"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-gray-500 dark:text-gray-400">
                <div className="text-center">
                  <Globe className="mx-auto h-12 w-12 mb-4 opacity-50" />
                  <p className="text-sm">No browser session active</p>
                </div>
              </div>
            )}
          </div>
        );

      case "files":
        return (
          <div className="h-full overflow-hidden" style={{ height: contentHeight }}>
            {filesProps ? (
              <FilesPanel
                {...filesProps}
                height={undefined} // Let it fill the container
                className="h-full"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-gray-500 dark:text-gray-400">
                <div className="text-center">
                  <Files className="mx-auto h-12 w-12 mb-4 opacity-50" />
                  <p className="text-sm">No files available</p>
                </div>
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Resize handle */}
      <div
        className="w-1 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 cursor-col-resize transition-colors flex-shrink-0"
        onMouseDown={startResize}
        aria-hidden="true"
        title="Drag to resize sidebar"
      />

      {/* Sidebar container */}
      <div
        className={`right-sidebar-container bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 flex flex-col ${className}`}
        style={{ width: isCollapsed ? 48 : width }}
      >
        {/* Header with tabs */}
        <div className="flex items-center justify-between h-12 px-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          {!isCollapsed ? (
            <>
              {/* Tab buttons */}
              <div className="flex items-center gap-1">
                {Object.values(TAB_CONFIG).map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  
                  return (
                    <button
                      key={tab.id}
                      onClick={() => handleTabChange(tab.id)}
                      className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded transition-colors ${
                        isActive
                          ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                          : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700"
                      }`}
                      title={`${tab.label} (Cmd+Shift+${tab.shortcut})`}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Controls */}
              <div className="flex items-center gap-1">
                <button
                  onClick={handleToggleCollapse}
                  className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                  title="Collapse sidebar"
                >
                  <ChevronRight className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                </button>
                <button
                  onClick={onClose}
                  className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                  title="Close sidebar"
                >
                  <X className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                </button>
              </div>
            </>
          ) : (
            /* Collapsed header */
            <div className="flex flex-col items-center gap-2 w-full">
              {/* Vertical tab buttons */}
              {Object.values(TAB_CONFIG).map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                
                return (
                  <button
                    key={tab.id}
                    onClick={() => handleTabChange(tab.id)}
                    className={`p-2 rounded transition-colors ${
                      isActive
                        ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                        : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700"
                    }`}
                    title={tab.label}
                  >
                    <Icon className="w-4 h-4" />
                  </button>
                );
              })}
              
              {/* Expand button */}
              <button
                onClick={handleToggleCollapse}
                className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors mt-2"
                title="Expand sidebar"
              >
                <ChevronLeft className="w-4 h-4 text-gray-600 dark:text-gray-400" />
              </button>
            </div>
          )}
        </div>

        {/* Tab content */}
        {renderTabContent()}
      </div>
    </>
  );
}

// ── Utility Hooks ─────────────────────────────────────────────────────────────

/**
 * Hook for managing right sidebar state with localStorage persistence
 */
export function useRightSidebar() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<RightSidebarTab>(() =>
    getStoredValue(STORAGE_KEYS.activeTab, "terminal")
  );
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() =>
    getStoredValue(STORAGE_KEYS.isCollapsed, false)
  );
  const [width, setWidth] = useState<number>(() =>
    getStoredValue(STORAGE_KEYS.width, DEFAULT_WIDTH)
  );

  const handleTabChange = useCallback((tab: RightSidebarTab) => {
    setActiveTab(tab);
    setStoredValue(STORAGE_KEYS.activeTab, tab);
  }, []);

  const handleToggleCollapse = useCallback(() => {
    const newCollapsed = !isCollapsed;
    setIsCollapsed(newCollapsed);
    setStoredValue(STORAGE_KEYS.isCollapsed, newCollapsed);
  }, [isCollapsed]);

  const handleResize = useCallback((newWidth: number) => {
    setWidth(newWidth);
    setStoredValue(STORAGE_KEYS.width, newWidth);
  }, []);

  const openSidebar = useCallback((tab?: RightSidebarTab) => {
    setIsOpen(true);
    if (tab) {
      handleTabChange(tab);
    }
  }, [handleTabChange]);

  const closeSidebar = useCallback(() => {
    setIsOpen(false);
  }, []);

  return {
    isOpen,
    activeTab,
    isCollapsed,
    width,
    openSidebar,
    closeSidebar,
    setActiveTab: handleTabChange,
    toggleCollapse: handleToggleCollapse,
    setWidth: handleResize,
  };
}