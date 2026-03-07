import { MessageSquare, Plus, X } from "lucide-react";

type SessionSidebarProps = {
  open: boolean;
  mobile?: boolean;
  onClose?: () => void;
};

const SESSIONS = {
  today: [
    { id: "1", title: "UI redesign for production-grade chat", active: true },
    { id: "2", title: "Phase 1 premium chat shell wireframes" },
  ],
  yesterday: [
    { id: "3", title: "Backend streaming architecture review" },
  ],
};

export function SessionSidebar({ open, mobile = false, onClose }: SessionSidebarProps) {
  const sidebarId = mobile ? "session-sidebar-mobile" : "session-sidebar";
  const sidebarClassName = mobile
    ? `app-drawer-panel transition-transform duration-200 ${open ? "translate-x-0" : "-translate-x-full"}`
    : `hidden border-r border-border bg-surface-1 transition-[width] duration-200 md:block ${
        open ? "w-[264px]" : "w-0 border-r-0 overflow-hidden"
      }`;

  return (
    <aside
      id={sidebarId}
      className={sidebarClassName}
      aria-hidden={!open}
      role={mobile ? "dialog" : undefined}
      aria-modal={mobile ? true : undefined}
      aria-label="Session navigation"
    >
      {open ? (
        <div className="flex h-full flex-col overflow-hidden">
          {/* Header */}
          <div className="shrink-0 border-b border-border px-4 py-4">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[15px] font-semibold leading-tight text-text-1">Agent</p>
                <p className="mt-0.5 truncate font-mono text-[11px] text-text-3">~/Documents/Github/Agent</p>
              </div>

              {mobile ? (
                <button
                  type="button"
                  className="icon-btn h-8 w-8 shrink-0"
                  onClick={onClose}
                  aria-label="Close sessions sidebar"
                  data-sidebar-close="true"
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>

            <button type="button" className="btn-secondary mt-3 h-9 w-full gap-1.5 text-sm">
              <Plus size={13} />
              New session
            </button>
          </div>

          {/* Session list */}
          <div className="flex-1 overflow-y-auto px-3 py-3">
            {/* Today */}
            <section className="mb-4">
              <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-widest text-text-3">
                Today
              </p>
              <ul className="space-y-0.5">
                {SESSIONS.today.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`session-item ${ item.active ? "session-item-active" : ""}`}
                      aria-label={`Open session: ${item.title}`}
                      aria-current={item.active ? "page" : undefined}
                    >
                      <MessageSquare size={12} className="shrink-0 text-text-3" />
                      <span className="truncate">{item.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            {/* Yesterday */}
            <section>
              <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-widest text-text-3">
                Yesterday
              </p>
              <ul className="space-y-0.5">
                {SESSIONS.yesterday.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="session-item"
                      aria-label={`Open session: ${item.title}`}
                    >
                      <MessageSquare size={12} className="shrink-0 text-text-3" />
                      <span className="truncate">{item.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
