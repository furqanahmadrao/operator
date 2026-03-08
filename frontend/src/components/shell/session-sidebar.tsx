"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";

import type { Session } from "@/lib/sessions-api";

// ── Date grouping ─────────────────────────────────────────────────────────────

type DateGroup = { label: string; items: Session[]; isPinned?: boolean };

function groupSessions(sessions: Session[]): DateGroup[] {
  const pinned = sessions.filter((s) => s.pinned);
  const unpinned = sessions.filter((s) => !s.pinned);

  const now = Date.now();
  const DAY = 86_400_000;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();

  const groups: Record<string, Session[]> = {
    Today: [],
    Yesterday: [],
    "Last 7 days": [],
    Older: [],
  };

  for (const s of unpinned) {
    const t = new Date(s.updated_at).getTime();
    const age = now - t;
    if (t >= todayMs) {
      groups.Today.push(s);
    } else if (age < 2 * DAY) {
      groups.Yesterday.push(s);
    } else if (age < 7 * DAY) {
      groups["Last 7 days"].push(s);
    } else {
      groups.Older.push(s);
    }
  }

  const result: DateGroup[] = [];
  if (pinned.length > 0) {
    result.push({ label: "Pinned", items: pinned, isPinned: true });
  }
  result.push(
    ...Object.entries(groups)
      .filter(([, items]) => items.length > 0)
      .map(([label, items]) => ({ label, items })),
  );
  return result;
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

type SessionSidebarProps = {
  open: boolean;
  sessions: Session[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onPin: (id: string, pinned: boolean) => Promise<void>;
  onClose: () => void;
};

export function SessionSidebar({
  open,
  sessions,
  activeSessionId,
  onSelect,
  onRename,
  onDelete,
  onPin,
  onClose,
}: SessionSidebarProps) {
  const groups = groupSessions(sessions);

  return (
    <aside
      id="session-sidebar"
      aria-label="Chat history"
      aria-hidden={!open}
      className={`absolute left-0 top-12 bottom-0 z-20 flex w-[260px] flex-col border-r border-border bg-surface-1 transition-transform duration-200 ease-in-out ${
        open ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      {/* Session list — no header, starts with a small spacing */}
      <nav
        className="flex-1 overflow-y-auto px-0 pt-2 pb-1"
        aria-label="Past chats"
      >
        {sessions.length === 0 ? (
          <p className="pl-4 py-4 text-[12px] text-text-3">
            No chats yet — start a new one.
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.label} className="mb-1">
              <p className="flex items-center gap-1.5 pl-3 pr-2 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-text-3">
                {group.isPinned && <Pin size={8} className="shrink-0" />}
                {group.label}
              </p>
              <ul className="space-y-px">
                {group.items.map((session) => (
                  <li key={session.id}>
                    <SessionItem
                      session={session}
                      isActive={session.id === activeSessionId}
                      onSelect={() => {
                        onSelect(session.id);
                        onClose();
                      }}
                      onRename={(title) => onRename(session.id, title)}
                      onDelete={() => onDelete(session.id)}
                      onPin={(pinned) => onPin(session.id, pinned)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </nav>

    </aside>
  );
}

// ── Individual session row ────────────────────────────────────────────────────

type SessionItemProps = {
  session: Session;
  isActive: boolean;
  onSelect: () => void;
  onRename: (title: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onPin: (pinned: boolean) => Promise<void>;
};

function SessionItem({
  session,
  isActive,
  onSelect,
  onRename,
  onDelete,
  onPin,
}: SessionItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(session.title);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });

  const inputRef = useRef<HTMLInputElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        !dropdownRef.current?.contains(e.target as Node) &&
        !menuBtnRef.current?.contains(e.target as Node)
      ) {
        setMenuOpen(false);
        setConfirmDelete(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing) {
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [isEditing]);

  const openMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    const btn = menuBtnRef.current;
    if (btn) {
      const rect = btn.getBoundingClientRect();
      setMenuPos({
        top: rect.bottom + 4,
        right: document.documentElement.clientWidth - rect.right,
      });
    }
    setMenuOpen((v) => !v);
    setConfirmDelete(false);
  };

  const startEdit = () => {
    setMenuOpen(false);
    setEditValue(session.title);
    setIsEditing(true);
  };

  const saveEdit = async () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== session.title) {
      await onRename(trimmed);
    }
    setIsEditing(false);
  };

  const handleEditKeyDown = async (
    e: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (e.key === "Enter") {
      e.preventDefault();
      await saveEdit();
    }
    if (e.key === "Escape") {
      setIsEditing(false);
      setEditValue(session.title);
    }
  };

  // ── Editing state ─────────────────────────────────────────────────────────
  if (isEditing) {
    return (
      <div className="flex items-center gap-1 bg-surface-3 px-2 py-1.5">
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleEditKeyDown}
          onBlur={saveEdit}
          className="min-w-0 flex-1 rounded bg-transparent text-[13px] text-text-1 focus:outline-none"
          aria-label="Rename session"
        />
        <button
          type="button"
          onClick={saveEdit}
          className="shrink-0 rounded p-0.5 text-text-3 hover:text-text-1 focus:outline-none"
          aria-label="Save rename"
        >
          <Check size={12} />
        </button>
      </div>
    );
  }

  // ── Normal row ────────────────────────────────────────────────────────────
  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); } }}
        className={`session-item group ${isActive ? "session-item-active" : ""}`}
        aria-current={isActive ? "page" : undefined}
      >
        <span className="min-w-0 flex-1 truncate text-left">
          {session.title}
        </span>
        {session.pinned && (
          <Pin
            size={9}
            className="shrink-0 text-text-3 opacity-40 transition-opacity group-hover:opacity-0"
          />
        )}
        {/* 3-dot menu trigger */}
        <button
          ref={menuBtnRef}
          type="button"
          onClick={(e) => { e.stopPropagation(); openMenu(e); }}
          className="shrink-0 rounded p-0.5 text-text-3 opacity-0 transition-opacity hover:text-text-2 focus:opacity-100 focus:outline-none group-hover:opacity-100"
          aria-label="More options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <MoreHorizontal size={13} />
        </button>
      </div>

      {/* Dropdown — portal so it escapes overflow:hidden on aside/nav */}
      {menuOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={dropdownRef}
            role="menu"
            className="session-dropdown"
            style={{ top: menuPos.top, right: menuPos.right }}
            onClick={(e) => e.stopPropagation()}
          >
            {!confirmDelete ? (
              <>
                <button
                  type="button"
                  role="menuitem"
                  onClick={startEdit}
                  className="session-dropdown-item"
                >
                  <Pencil size={12} />
                  <span>Rename</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={async () => {
                    await onPin(!session.pinned);
                    setMenuOpen(false);
                  }}
                  className="session-dropdown-item"
                >
                  {session.pinned ? (
                    <PinOff size={12} />
                  ) : (
                    <Pin size={12} />
                  )}
                  <span>{session.pinned ? "Unpin" : "Pin"}</span>
                </button>
                <div className="session-dropdown-divider" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => setConfirmDelete(true)}
                  className="session-dropdown-item session-dropdown-item-danger"
                >
                  <Trash2 size={12} />
                  <span>Delete</span>
                </button>
              </>
            ) : (
              <div className="px-3 py-2.5">
                <p className="mb-2.5 text-[12px] font-medium leading-tight text-text-2">
                  Delete this chat?
                </p>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={async () => {
                      setMenuOpen(false);
                      await onDelete();
                    }}
                    className="flex-1 border border-danger-border bg-danger-soft px-2.5 py-1.5 text-[11.5px] font-medium text-danger transition-colors hover:bg-[rgba(180,100,100,0.14)] focus:outline-none"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="flex-1 border border-border bg-surface-2 px-2.5 py-1.5 text-[11.5px] font-medium text-text-2 transition-colors hover:bg-surface-3 hover:text-text-1 focus:outline-none"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

