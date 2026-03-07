export type Project = {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  pinned: boolean;
  session_count: number;
  created_at: string;
  updated_at: string;
};

export type ProjectCreate = {
  name: string;
  description?: string;
  system_prompt?: string;
};

export type ProjectUpdate = {
  name?: string;
  description?: string;
  system_prompt?: string;
};

export type ProjectArtifact = {
  id: string;
  session_id: string;
  source_message_id: string | null;
  type: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
};

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ??
  "http://localhost:8000";

export async function listProjects(): Promise<Project[]> {
  const res = await fetch(`${API_BASE}/api/projects`);
  if (!res.ok) throw new Error("Failed to list projects");
  return res.json() as Promise<Project[]>;
}

export async function createProject(data: ProjectCreate): Promise<Project> {
  const res = await fetch(`${API_BASE}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create project");
  return res.json() as Promise<Project>;
}

export async function getProject(id: string): Promise<Project> {
  const res = await fetch(`${API_BASE}/api/projects/${id}`);
  if (!res.ok) throw new Error("Failed to load project");
  return res.json() as Promise<Project>;
}

export async function updateProject(
  id: string,
  data: ProjectUpdate,
): Promise<Project> {
  const res = await fetch(`${API_BASE}/api/projects/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update project");
  return res.json() as Promise<Project>;
}

export async function pinProject(id: string, pinned: boolean): Promise<Project> {
  const res = await fetch(`${API_BASE}/api/projects/${id}/pin`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pinned }),
  });
  if (!res.ok) throw new Error("Failed to pin/unpin project");
  return res.json() as Promise<Project>;
}

export async function deleteProject(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/projects/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete project");
}

export async function listProjectSessions(projectId: string): Promise<
  Array<{
    id: string;
    title: string;
    pinned: boolean;
    project_id: string | null;
    created_at: string;
    updated_at: string;
  }>
> {
  const res = await fetch(`${API_BASE}/api/projects/${projectId}/sessions`);
  if (!res.ok) throw new Error("Failed to list project sessions");
  return res.json();
}

export async function listProjectArtifacts(
  projectId: string,
): Promise<ProjectArtifact[]> {
  const res = await fetch(`${API_BASE}/api/projects/${projectId}/artifacts`);
  if (!res.ok) throw new Error("Failed to list project artifacts");
  return res.json() as Promise<ProjectArtifact[]>;
}

