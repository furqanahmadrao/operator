import { RefObject } from "react";

import { Bell, PanelLeftClose, PanelLeftOpen, Search, Share2 } from "lucide-react";

type TopBarProps = {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  sidebarToggleRef?: RefObject<HTMLButtonElement | null>;
};

export function TopBar({ sidebarOpen, onToggleSidebar, sidebarToggleRef }: TopBarProps) {
  return (
    <header className="shrink-0 border-b border-border bg-surface-1 px-4 py-2 md:px-5">
      <div className="flex w-full items-center justify-between gap-3">
        {/* Left — sidebar toggle + status */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="icon-btn h-8 w-8"
            onClick={onToggleSidebar}
            ref={sidebarToggleRef}
            aria-label="Toggle sessions sidebar"
            aria-controls="session-sidebar session-sidebar-mobile"
            aria-expanded={sidebarOpen}
          >
            {sidebarOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
          </button>

          <span
            className="hidden items-center gap-1.5 md:inline-flex"
            aria-label="Workspace online"
          >
            <span className="h-1.5 w-1.5 bg-success pulse-dot" />
            <span className="text-[11px] font-semibold uppercase tracking-widest text-text-3">Online</span>
          </span>
        </div>

        {/* Center — command search */}
        <button
          type="button"
          aria-label="Open command palette (⌘K)"
          className="inline-flex h-8 w-full max-w-[380px] items-center gap-2 border border-border bg-surface-2 px-3 text-sm text-text-3 transition-all duration-200 hover:border-border-strong hover:text-text-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1"
        >
          <Search size={13} />
          <span className="hidden sm:inline">Search or ask anything…</span>
          <span className="sm:hidden">Search</span>
          <kbd className="ml-auto hidden border border-border px-1.5 py-0.5 font-mono text-[10px] text-text-3 sm:inline">⌘K</kbd>
        </button>

        {/* Right — actions */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="btn-secondary hidden h-8 gap-1.5 px-3 text-xs md:inline-flex"
            aria-label="Share"
          >
            <Share2 size={13} />
            Share
          </button>

          <button type="button" className="icon-btn h-8 w-8" aria-label="Notifications">
            <Bell size={14} />
          </button>
        </div>
      </div>
    </header>
  );
}
