"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Files, LayoutGrid, MessageSquarePlus, Settings, User, Zap } from "lucide-react";

interface LeftRailProps {
  /** Called when the user clicks the chat/history icon */
  onToggleHistory: () => void;
  /** Whether the session history panel is currently open */
  historyOpen: boolean;
}

const USER_INITIALS = "FA";
const USER_NAME = "Furqan";

export function LeftRail({ onToggleHistory, historyOpen }: LeftRailProps) {
  const pathname = usePathname();

  return (
    <aside className="hidden h-full w-12 shrink-0 flex-col items-center border-r border-border bg-bg md:flex">
      {/* Logo — blue flash (Zap) */}
      <div className="flex h-12 w-full shrink-0 items-center justify-center border-b border-border">
        <Zap size={20} className="fill-accent text-accent" strokeWidth={0} />
      </div>

      {/* Nav items */}
      <nav className="flex flex-1 flex-col w-full">
        {/* Chat / Session history toggle */}
        <button
          type="button"
          onClick={onToggleHistory}
          className={`relative flex h-12 w-full items-center justify-center transition-colors hover:bg-black/5 focus-visible:outline-none ${
            historyOpen ? "text-accent" : "text-text-3 hover:text-text-1"
          }`}
          aria-label="Chat history"
          title="Chat history"
        >
          {historyOpen && <span className="absolute inset-y-0 left-0 w-0.5 bg-accent" />}
          <MessageSquarePlus size={18} />
        </button>

        {/* Projects */}
        <Link
          href="/projects"
          className={`relative flex h-12 w-full items-center justify-center transition-colors hover:bg-black/5 focus-visible:outline-none ${
            pathname.startsWith("/projects") ? "text-accent" : "text-text-3 hover:text-text-1"
          }`}
          aria-label="Projects"
          title="Projects"
        >
          {pathname.startsWith("/projects") && (
            <span className="absolute inset-y-0 left-0 w-0.5 bg-accent" />
          )}
          <LayoutGrid size={18} />
        </Link>

        {/* Library */}
        <Link
          href="/library"
          className={`relative flex h-12 w-full items-center justify-center transition-colors hover:bg-black/5 focus-visible:outline-none ${
            pathname === "/library" ? "text-accent" : "text-text-3 hover:text-text-1"
          }`}
          aria-label="Artifact Library"
          title="Artifact Library"
        >
          {pathname === "/library" && (
            <span className="absolute inset-y-0 left-0 w-0.5 bg-accent" />
          )}
          <Files size={18} />
        </Link>
      </nav>

      {/* Bottom nav */}
      <div className="flex w-full flex-col border-t border-border">
        <Link
          href="/settings"
          className={`relative flex h-12 w-full items-center justify-center transition-colors hover:bg-black/5 focus-visible:outline-none ${
            pathname.startsWith("/settings") ? "text-accent" : "text-text-3 hover:text-text-1"
          }`}
          aria-label="Settings"
          title="Settings"
        >
          {pathname.startsWith("/settings") && (
            <span className="absolute inset-y-0 left-0 w-0.5 bg-accent" />
          )}
          <Settings size={18} />
        </Link>
        <Link
          href="/settings"
          className="flex h-12 w-full items-center justify-center transition-colors hover:bg-black/5 focus-visible:outline-none"
          aria-label={`Signed in as ${USER_NAME}`}
          title={USER_NAME}
        >
          <div className={`flex h-6 w-6 items-center justify-center text-[9px] font-bold tracking-tight ${
            pathname.startsWith("/settings") ? "bg-accent text-white" : "bg-text-1 text-bg"
          }`}>
            {USER_INITIALS}
          </div>
        </Link>
      </div>
    </aside>
  );
}
