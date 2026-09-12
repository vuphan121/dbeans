import type {
  CardLayout,
  ConnectionSchema,
  ConnectionStatus,
  JobRun,
  QueryResult,
  SavedConnection,
  ScheduledJob,
} from "@/lib/types";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export interface LoginResponse {
  token: string;
  username: string;
}

export function login(username: string, password: string): Promise<LoginResponse> {
  return request("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
}

export function logout(token: string): Promise<{ ok: boolean }> {
  return request("/api/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
}

export function me(token: string): Promise<{ username: string }> {
  return request("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } });
}

// Fire-and-forget analytics — a failure here should never surface to the user
// or block whatever action triggered it.
export function trackEvent(token: string, type: string, payload?: unknown): void {
  if (!token) return;
  request("/api/analytics/event", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type, payload }),
  }).catch(() => {
    /* best-effort */
  });
}

export function listConnections(token: string): Promise<SavedConnection[]> {
  return request("/api/connections", { headers: { Authorization: `Bearer ${token}` } });
}

export function createConnection(token: string, conn: SavedConnection): Promise<SavedConnection> {
  return request("/api/connections", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(conn),
  });
}

export function updateConnectionLayout(token: string, id: string, layout: CardLayout): Promise<{ ok: boolean }> {
  return request(`/api/connections/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ layout }),
  });
}

export function touchConnection(token: string, id: string, lastUsed: string): Promise<{ ok: boolean }> {
  return request(`/api/connections/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ lastUsed }),
  });
}

export function deleteConnection(token: string, id: string): Promise<{ ok: boolean }> {
  return request(`/api/connections/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export interface PingResult {
  status: ConnectionStatus;
  lastCheckedAt: string;
  cached: boolean;
}

// The backend itself enforces a ~60s cache per connection, so this is safe
// to call every time the Connections page loads — a repeat visit within
// that window just gets the cached result back, no new network check.
export function pingConnection(token: string, id: string): Promise<PingResult> {
  return request(`/api/connections/${id}/ping`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function getConnectionSchema(token: string, id: string): Promise<ConnectionSchema> {
  return request(`/api/connections/${id}/schema`, { headers: { Authorization: `Bearer ${token}` } });
}

export function runQuery(token: string, id: string, sql: string): Promise<QueryResult> {
  return request(`/api/connections/${id}/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ sql }),
  });
}

export function listJobs(token: string): Promise<ScheduledJob[]> {
  return request("/api/jobs", { headers: { Authorization: `Bearer ${token}` } });
}

export function createJob(token: string, job: ScheduledJob): Promise<ScheduledJob> {
  return request("/api/jobs", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(job),
  });
}

export function updateJob(token: string, job: ScheduledJob): Promise<{ ok: boolean }> {
  return request(`/api/jobs/${job.id}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(job),
  });
}

export function updateJobLayout(token: string, id: string, layout: CardLayout): Promise<{ ok: boolean }> {
  return request(`/api/jobs/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ layout }),
  });
}

export function deleteJob(token: string, id: string): Promise<{ ok: boolean }> {
  return request(`/api/jobs/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
}

export function runJobNow(token: string, id: string): Promise<JobRun> {
  return request(`/api/jobs/${id}/run`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
}

export function listJobRuns(token: string, id: string): Promise<JobRun[]> {
  return request(`/api/jobs/${id}/runs`, { headers: { Authorization: `Bearer ${token}` } });
}

export interface JobsTickInfo {
  secret: string;
  path: string;
}

export function getJobsTickInfo(token: string): Promise<JobsTickInfo> {
  return request("/api/jobs/tick-info", { headers: { Authorization: `Bearer ${token}` } });
}
