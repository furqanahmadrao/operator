import { CircleHelp, MessageSquarePlus, Search, Settings, Sparkles } from "lucide-react";

export function LeftRail() {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-16 flex-col items-center justify-between border-r border-border bg-surface-1 py-3 md:flex">
      <div className="flex flex-col items-center gap-2">
        {/* Workspace avatar */}
        <button
          type="button"
          aria-label="Open workspace"
          title="Agent workspace"
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-3 text-[13px] font-bold tracking-tight text-text-1 transition-all duration-150 hover:bg-surface-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          AG
        </button>

        <div className="my-1 h-px w-6 bg-border" />

        <button type="button" aria-label="New session" title="New session" className="rail-btn rail-btn-active">
          <MessageSquarePlus size={15} />
        </button>

        <button type="button" aria-label="Search" title="Search" className="rail-btn">
          <Search size={15} />
        </button>

        <button type="button" aria-label="Agents" title="Agents" className="rail-btn">
          <Sparkles size={15} />
        </button>
      </div>

      <div className="flex flex-col items-center gap-2">
        <button type="button" aria-label="Help" title="Help" className="rail-btn">
          <CircleHelp size={15} />
        </button>
        <button type="button" aria-label="Settings" title="Settings" className="rail-btn">
          <Settings size={15} />
        </button>
      </div>
    </aside>
  );
}
