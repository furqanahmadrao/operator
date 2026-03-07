export type Session = {
  id: string;
  title: string;
  pinned: boolean;
  project_id: string | null;
  created_at: string;
  updated_at: string;
};

export type SessionMessage = {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  artifact_id: string | null;
  created_at: string;
  metadata_json: string | null;
};

export type SessionWithMessages = Session & {
  messages: SessionMessage[];
};

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ??
  "http://localhost:8000";

export async function listSessions(): Promise<Session[]> {
  const res = await fetch(`${API_BASE}/api/sessions`);
  if (!res.ok) throw new Error("Failed to list sessions");
  return res.json() as Promise<Session[]>;
}

export async function createSession(title = "New Chat", projectId?: string): Promise<Session> {
  const res = await fetch(`${API_BASE}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, project_id: projectId ?? null }),
  });
  if (!res.ok) throw new Error("Failed to create session");
  return res.json() as Promise<Session>;
}

export async function getSession(id: string): Promise<SessionWithMessages> {
  const res = await fetch(`${API_BASE}/api/sessions/${id}`);
  if (!res.ok) throw new Error("Failed to load session");
  return res.json() as Promise<SessionWithMessages>;
}

export async function renameSession(id: string, title: string): Promise<Session> {
  const res = await fetch(`${API_BASE}/api/sessions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error("Failed to rename session");
  return res.json() as Promise<Session>;
}

export async function deleteSession(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/sessions/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete session");
}

export async function pinSession(id: string, pinned: boolean): Promise<Session> {
  const res = await fetch(`${API_BASE}/api/sessions/${id}/pin`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pinned }),
  });
  if (!res.ok) throw new Error("Failed to pin/unpin session");
  return res.json() as Promise<Session>;
}

export async function moveSessionToProject(
  id: string,
  projectId: string | null,
): Promise<Session> {
  const res = await fetch(`${API_BASE}/api/sessions/${id}/project`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_id: projectId }),
  });
  if (!res.ok) throw new Error("Failed to move session to project");
  return res.json() as Promise<Session>;
}
