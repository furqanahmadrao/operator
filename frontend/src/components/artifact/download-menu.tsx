"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download, FileCode2, FileDown, FileText } from "lucide-react";

import {
  downloadArtifact,
  downloadArtifactAsHtml,
  downloadArtifactAsPdf,
} from "@/lib/artifacts-api";

type DownloadMenuProps = {
  artifactId: string;
  title: string;
  content: string;
  /** The artifact type — controls which download options are shown. */
  artifactType?: string;
  /** "icon" = icon-only trigger (used in the artifact panel header)
   *  "card" = text button trigger (used on the in-chat card) */
  variant?: "icon" | "card";
};

export function DownloadMenu({
  artifactId,
  title,
  content,
  artifactType = "markdown",
  variant = "icon",
}: DownloadMenuProps) {
  const isHtml = artifactType.toLowerCase() === "html";
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"file" | "pdf" | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const handleFileDownload = async () => {
    setOpen(false);
    setBusy("file");
    try {
      if (isHtml) {
        downloadArtifactAsHtml(title, content);
      } else {
        await downloadArtifact(artifactId, title);
      }
    } catch {
      // fail silently
    } finally {
      setBusy(null);
    }
  };

  const handlePdf = async () => {
    setOpen(false);
    setBusy("pdf");
    try {
      await downloadArtifactAsPdf(title, content, artifactType);
    } catch {
      // fail silently
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="download-menu-root" ref={rootRef}>
      {/* Trigger button */}
      {variant === "icon" ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={busy !== null}
          className="artifact-action-btn"
          aria-label="Download options"
          aria-expanded={open}
          title="Download"
        >
          <Download size={13} />
        </button>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          disabled={busy !== null}
          className="artifact-chat-card-download"
          aria-label="Download options"
          aria-expanded={open}
        >
          <Download size={13} />
          <span>{busy === "file" ? "Saving…" : busy === "pdf" ? "Opening…" : "Download"}</span>
          <ChevronDown
            size={11}
            style={{
              transition: "transform 0.15s",
              transform: open ? "rotate(180deg)" : "rotate(0deg)",
            }}
          />
        </button>
      )}

      {/* Dropdown */}
      {open && (
        <div
          className="download-menu-popover"
          role="menu"
          aria-label="Download format"
        >
          {/* Primary file download — label depends on type */}
          <button
            type="button"
            className="download-menu-item"
            role="menuitem"
            onClick={handleFileDownload}
          >
            {isHtml ? <FileCode2 size={13} /> : <FileText size={13} />}
            <span>{isHtml ? "HTML (.html)" : "Markdown (.md)"}</span>
          </button>
          {/* PDF / print */}
          <button
            type="button"
            className="download-menu-item"
            role="menuitem"
            onClick={handlePdf}
          >
            <FileDown size={13} />
            <span>{isHtml ? "Print as PDF" : "PDF (print)"}</span>
          </button>
        </div>
      )}
    </div>
  );
}
