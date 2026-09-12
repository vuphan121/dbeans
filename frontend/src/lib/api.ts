const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080";

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
