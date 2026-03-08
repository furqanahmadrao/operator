"use client";

/**
 * TodoWidget
 * ----------
 * Collapsible research-plan tracker shown above the composer during a
 * deep-research run.
 *
 * Layout (above the composer, not replacing it):
 *
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │  🔬  Research plan · Searching: "What is X?"  2/5 ▓▓░░░  ⌄  │
 *   ├ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┤
 *   │  ✓  What are the main use-cases?                               │
 *   │  ⟳  Current market landscape and key players                   │
 *   │  ○  Historical context and evolution                           │
 *   │  ○  Regulatory and ethical considerations                      │
 *   └────────────────────────────────────────────────────────────────┘
 */

import React from "react";
import { Check, ChevronDown, ChevronUp, Circle, Loader2, ListTodo } from "lucide-react";
import type { TodoItem } from "@/lib/chat-api";

interface Props {
  items: TodoItem[];
  collapsed: boolean;
  onToggle: () => void;
}

export function TodoWidget({ items, collapsed, onToggle }: Props) {
  if (items.length === 0) return null;

  const doneCount = items.filter((i) => i.status === "done").length;
  const allDone = doneCount === items.length;
  const activeItem = items.find((i) => i.status === "active");
  const progressPct = Math.round((doneCount / items.length) * 100);

  const headerLabel = allDone
    ? "Research complete"
    : activeItem
      ? `Searching: ${activeItem.text.length > 46 ? activeItem.text.slice(0, 46) + "…" : activeItem.text}`
      : "Research plan";

  return (
    <div className={`todo-widget${allDone ? " todo-widget-complete" : ""}`}>
      {/* ── Header / toggle bar ── */}
      <button type="button" className="todo-header" onClick={onToggle}>
        <div className="todo-header-left">
          <ListTodo size={12} className="todo-header-icon" />
          <span className="todo-header-label">{headerLabel}</span>
          <span className="todo-header-count">{doneCount}/{items.length}</span>
          {/* Mini progress bar */}
          <span className="todo-progress-track" aria-hidden>
            <span className="todo-progress-fill" style={{ width: `${progressPct}%` }} />
          </span>
        </div>
        <span className="todo-header-chevron">
          {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </span>
      </button>

      {/* ── Expanded item list ── */}
      {!collapsed && (
        <ul className="todo-body" role="list">
          {items.map((item) => (
            <li key={item.id} className={`todo-item todo-item-${item.status}`}>
              <span className="todo-item-icon" aria-hidden>
                {item.status === "done" && (
                  <Check size={11} strokeWidth={2.5} />
                )}
                {item.status === "active" && (
                  <Loader2 size={11} className="todo-spin" />
                )}
                {item.status === "pending" && (
                  <Circle size={10} />
                )}
              </span>
              <span className="todo-item-text">{item.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
