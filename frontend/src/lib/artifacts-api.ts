export type Artifact = {
  id: string;
  session_id: string;
  source_message_id: string | null;
  type: string;
  title: string;
  content: string;
  version: number;
  created_at: string;
  updated_at: string;
};

export type ArtifactRevision = {
  id: string;
  artifact_id: string;
  version: number;
  title: string;
  content: string;
  source_message_id: string | null;
  created_at: string;
};

export type ArtifactWithSession = Artifact & {
  /** The title of the parent session (for Library view). */
  session_title: string;
};

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ??
  "http://localhost:8000";

export async function listArtifacts(sessionId: string): Promise<Artifact[]> {
  const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/artifacts`);
  if (!res.ok) throw new Error("Failed to list artifacts");
  return res.json() as Promise<Artifact[]>;
}

export async function listAllArtifacts(): Promise<ArtifactWithSession[]> {
  const res = await fetch(`${API_BASE}/api/artifacts`);
  if (!res.ok) throw new Error("Failed to list all artifacts");
  return res.json() as Promise<ArtifactWithSession[]>;
}

export async function getArtifact(id: string): Promise<Artifact> {
  const res = await fetch(`${API_BASE}/api/artifacts/${id}`);
  if (!res.ok) throw new Error("Failed to load artifact");
  return res.json() as Promise<Artifact>;
}

export async function listArtifactRevisions(id: string): Promise<ArtifactRevision[]> {
  const res = await fetch(`${API_BASE}/api/artifacts/${id}/revisions`);
  if (!res.ok) throw new Error("Failed to list artifact revisions");
  return res.json() as Promise<ArtifactRevision[]>;
}

export async function updateArtifact(
  id: string,
  patch: { title?: string; content?: string },
): Promise<Artifact> {
  const res = await fetch(`${API_BASE}/api/artifacts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error("Failed to update artifact");
  return res.json() as Promise<Artifact>;
}

export async function deleteArtifact(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/artifacts/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete artifact");
}

export async function downloadArtifact(id: string, title: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/artifacts/${id}/download`);
  if (!res.ok) throw new Error("Failed to download artifact");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const filename = `${title.replace(/[/\\]/g, "-")}.md`;
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
/** Download an HTML artifact as a .html file. */
export function downloadArtifactAsHtml(title: string, content: string): void {
  const blob = new Blob([content], { type: "text/html; charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.replace(/[\/\\]/g, "-")}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}/**
 * Open the browser print dialog so the user can save the artifact as a PDF.
 * For HTML artifacts the content is opened directly; for markdown it is
 * converted to a styled print document first.
 */
export async function downloadArtifactAsPdf(
  title: string,
  content: string,
  artifactType: string = "markdown",
): Promise<void> {
  // ── HTML artifacts: open via Blob URL + auto print ───────────────────────────
  if (artifactType.toLowerCase() === "html") {
    const printScript =
      `<script>window.addEventListener('load',function(){setTimeout(function(){window.print();},400);});<\/script>`;
    // Inject print trigger before </body>; if no </body>, append at end
    const final = /<\/body>/i.test(content)
      ? content.replace(/<\/body>/i, `${printScript}</body>`)
      : content + printScript;
    // Use a Blob URL so the browser navigates to a real URL (more reliable than
    // document.write into an about:blank popup which is often blocked).
    const blob = new Blob([final], { type: "text/html; charset=utf-8" });
    const blobUrl = URL.createObjectURL(blob);
    const win = window.open(blobUrl, "_blank");
    if (!win) {
      // Popup blocked — fall back to downloading the HTML file
      URL.revokeObjectURL(blobUrl);
      downloadArtifactAsHtml(title, content);
      return;
    }
    // Revoke blob URL after 60 s — enough time for the page to load and print
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    return;
  }

  // ── Markdown artifacts: convert to styled print document ────────────────────
  const { marked } = await import("marked");
  marked.setOptions({ gfm: true, breaks: true });
  const htmlBody = await marked.parse(content);

  const safeTitle = title.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const dateStr = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const doc = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${safeTitle}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    @page { margin: 1in 1.15in; }
    body {
      font-family: "Georgia", "Times New Roman", serif;
      font-size: 12pt;
      line-height: 1.8;
      color: #111;
      background: #fff;
    }
    .doc-title {
      font-family: "Helvetica Neue", Arial, sans-serif;
      font-size: 22pt;
      font-weight: 700;
      color: #000;
      padding-bottom: 8pt;
      border-bottom: 1.5pt solid #bbb;
      margin-bottom: 6pt;
    }
    .doc-meta {
      font-family: "Helvetica Neue", Arial, sans-serif;
      font-size: 9pt;
      color: #888;
      margin-bottom: 28pt;
    }
    h1, h2, h3, h4, h5, h6 {
      font-family: "Helvetica Neue", Arial, sans-serif;
      font-weight: 700;
      line-height: 1.3;
      color: #000;
      margin-top: 20pt;
      margin-bottom: 6pt;
      page-break-after: avoid;
    }
    h1 { font-size: 18pt; border-bottom: 1pt solid #ddd; padding-bottom: 4pt; }
    h2 { font-size: 15pt; }
    h3 { font-size: 13pt; }
    h4, h5, h6 { font-size: 12pt; }
    p { margin-bottom: 9pt; orphans: 3; widows: 3; }
    ul, ol { margin: 6pt 0 9pt 22pt; }
    li { margin-bottom: 4pt; }
    li > ul, li > ol { margin-top: 2pt; }
    code {
      font-family: "Courier New", monospace;
      font-size: 10pt;
      background: #f5f5f5;
      border: 1pt solid #e0e0e0;
      border-radius: 3pt;
      padding: 1pt 4pt;
      color: #222;
    }
    pre {
      background: #f5f5f5;
      border: 1pt solid #ddd;
      border-radius: 4pt;
      padding: 9pt 11pt;
      margin: 9pt 0;
      overflow-x: auto;
      page-break-inside: avoid;
      font-family: "Courier New", monospace;
      font-size: 10pt;
      line-height: 1.6;
      color: #222;
    }
    pre code { background: none; border: none; padding: 0; font-size: inherit; }
    blockquote {
      border-left: 3pt solid #bbb;
      padding: 3pt 11pt;
      margin: 9pt 0;
      color: #555;
      font-style: italic;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 10pt 0;
      font-size: 11pt;
      page-break-inside: avoid;
    }
    th {
      background: #f0f0f0;
      font-family: "Helvetica Neue", Arial, sans-serif;
      font-weight: 700;
      text-align: left;
      padding: 5pt 8pt;
      border: 1pt solid #ccc;
    }
    td { padding: 4pt 8pt; border: 1pt solid #ddd; vertical-align: top; }
    tr:nth-child(even) td { background: #fafafa; }
    a { color: #222; text-decoration: underline; word-break: break-all; }
    img { max-width: 100%; height: auto; page-break-inside: avoid; }
    hr { border: none; border-top: 1pt solid #ccc; margin: 14pt 0; }
    @media print {
      body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="doc-title">${safeTitle}</div>
  <div class="doc-meta">Generated ${dateStr}</div>
  <div class="content">${htmlBody}</div>
</body>
</html>`;

  const win = window.open("", "_blank", "width=900,height=720");
  if (!win) {
    // Fallback: blob URL for browsers that block popups
    const blob = new Blob([doc], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[\/\\]/g, "-")}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return;
  }
  win.document.write(doc);
  win.document.close();
  // Small delay to ensure styles are applied before print dialog
  setTimeout(() => {
    win.focus();
    win.print();
  }, 400);
}