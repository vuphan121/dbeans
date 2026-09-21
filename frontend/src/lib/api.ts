import type {
  CardLayout,
  ConnectionSchema,
  ConnectionStatus,
  JobRun,
  JobRunCalendarDay,
  KafkaMessage,
  KafkaTopic,
  QueryResult,
  DataFilter,
  DataSort,
  DataViewConfig,
  HistoryEntry,
  ImportResult,
  InsertRowResult,
  SavedQuery,
  SavedView,
  TableDataPage,
  RedisKeyEntry,
  SavedConnection,
  ScheduledJob,
  Secret,
} from "@/lib/types";

import { cancelOnAbort } from "@/lib/cancelOnAbort";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// The server's own message for an ApiError, otherwise the caller's fallback
// (a network failure or a bug shouldn't surface its raw text to the user).
export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
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

export function changePassword(token: string, currentPassword: string, newPassword: string): Promise<{ ok: boolean }> {
  return request("/api/auth/change-password", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
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

export function runQuery(token: string, id: string, sql: string, renderTemplate?: boolean): Promise<QueryResult> {
  return request(`/api/connections/${id}/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ sql, renderTemplate: renderTemplate || undefined }),
  });
}

export interface UpdateCellInput {
  schema: string;
  table: string;
  column: string;
  value: string | null;
  pkColumn: string;
  pkValue: string;
}

export function updateCell(token: string, id: string, input: UpdateCellInput): Promise<{ ok: boolean; rowsAffected: number }> {
  return request(`/api/connections/${id}/update-cell`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
}

// Asks the server to terminate the Postgres session running an aborted page
// load or count (see cancelOnAbort for why aborting the fetch isn't enough).
function cancelServerWorkOnAbort(token: string, connectionId: string, requestId: string, signal: AbortSignal | undefined, settled: Promise<unknown>) {
  cancelOnAbort(signal, settled, () =>
    request<{ terminated: number }>(`/api/connections/${connectionId}/table-data/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ requestId }),
    }),
  );
}

// signal lets the caller cancel an in-flight page load, including the database
// query behind it (see cancelServerWorkOnAbort). countMode "skip" asks the
// server not to count rows at all — for when only the page or sort changed and
// the caller already holds the total for this exact table + filter set.
export function browseTableData(
  token: string,
  id: string,
  input: {
    schema: string;
    table: string;
    filters: Omit<DataFilter, "id">[];
    sorts?: DataSort[];
    page: number;
    pageSize: number;
    countMode?: "auto" | "skip";
  },
  signal?: AbortSignal,
): Promise<TableDataPage> {
  const requestId = crypto.randomUUID();
  const result = request<TableDataPage>(`/api/connections/${id}/table-data`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...input, requestId }),
    signal,
  });
  cancelServerWorkOnAbort(token, id, requestId, signal, result);
  return result;
}

// The explicit exact count behind the Data view's "Count exactly" — separate
// from browseTableData so it can be cancelled without disturbing the page.
export function countTableData(
  token: string,
  id: string,
  input: { schema: string; table: string; filters: Omit<DataFilter, "id">[] },
  signal?: AbortSignal,
): Promise<{ total: number; totalKind: "exact" }> {
  const requestId = crypto.randomUUID();
  const result = request<{ total: number; totalKind: "exact" }>(`/api/connections/${id}/table-data/count`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...input, requestId }),
    signal,
  });
  cancelServerWorkOnAbort(token, id, requestId, signal, result);
  return result;
}

export function importTableRows(
  token: string,
  id: string,
  input: { schema: string; table: string; columns: string[]; rows: (string | null)[][]; dryRun: boolean },
): Promise<ImportResult> {
  return request(`/api/connections/${id}/table-import`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
}

export function listSavedViews(token: string, id: string): Promise<SavedView[]> {
  return request(`/api/connections/${id}/views`, { headers: { Authorization: `Bearer ${token}` } });
}

export function createSavedView(
  token: string,
  id: string,
  view: { id: string; schema: string; table: string; name: string; config: DataViewConfig },
): Promise<SavedView> {
  return request(`/api/connections/${id}/views`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(view),
  });
}

export function updateSavedView(
  token: string,
  id: string,
  viewId: string,
  update: { name?: string; config?: DataViewConfig },
): Promise<{ ok: boolean }> {
  return request(`/api/connections/${id}/views/${viewId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(update),
  });
}

export function deleteSavedView(token: string, id: string, viewId: string): Promise<{ ok: boolean }> {
  return request(`/api/connections/${id}/views/${viewId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function listSavedQueries(token: string): Promise<SavedQuery[]> {
  return request("/api/saved-queries", { headers: { Authorization: `Bearer ${token}` } });
}

export function createSavedQuery(token: string, query: { id: string; name: string; sql: string }): Promise<SavedQuery> {
  return request("/api/saved-queries", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(query),
  });
}

export function updateSavedQuery(token: string, id: string, update: { name?: string; sql?: string }): Promise<{ ok: boolean }> {
  return request(`/api/saved-queries/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(update),
  });
}

export function deleteSavedQuery(token: string, id: string): Promise<{ ok: boolean }> {
  return request(`/api/saved-queries/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
}

// One-time move of queries saved in this browser's localStorage (before saved
// queries lived on the server). Idempotent server-side: ids that already exist
// are skipped. Resolves to the user's full list afterward.
export function importSavedQueries(token: string, queries: { id: string; name: string; sql: string }[]): Promise<SavedQuery[]> {
  return request("/api/saved-queries/import", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ queries }),
  });
}

export interface TableRowMutation {
  schema: string;
  table: string;
  values?: Record<string, string | null>;
  key?: Record<string, string | null>;
}

export function insertTableRow(token: string, id: string, input: TableRowMutation): Promise<InsertRowResult> {
  return request(`/api/connections/${id}/table-rows`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
}

export function updateTableRow(token: string, id: string, input: TableRowMutation): Promise<{ ok: boolean; rowsAffected: number }> {
  return request(`/api/connections/${id}/table-rows`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
}

export function deleteTableRow(token: string, id: string, input: TableRowMutation): Promise<{ ok: boolean; rowsAffected: number }> {
  return request(`/api/connections/${id}/table-rows`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
}

export function bulkDeleteTableRows(token: string, id: string, input: { schema: string; table: string; keys: Record<string, string | null>[] }): Promise<{ ok: boolean; rowsAffected: number }> {
  return request(`/api/connections/${id}/table-rows/bulk-delete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
}

export function executeSchemaChange(token: string, id: string, sql: string): Promise<{ ok: boolean }> {
  return request(`/api/connections/${id}/schema-change`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ sql }),
  });
}

export function getConnectionHistory(token: string, id: string, limit = 100): Promise<HistoryEntry[]> {
  return request(`/api/connections/${id}/history?limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function listRedisKeys(token: string, id: string, pattern = "*"): Promise<RedisKeyEntry[]> {
  return request(`/api/connections/${id}/redis/keys?pattern=${encodeURIComponent(pattern)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function createRedisKey(token: string, id: string, entry: RedisKeyEntry): Promise<RedisKeyEntry> {
  return request(`/api/connections/${id}/redis/keys`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(entry),
  });
}

export function updateRedisKey(token: string, id: string, entry: RedisKeyEntry): Promise<RedisKeyEntry> {
  return request(`/api/connections/${id}/redis/keys`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(entry),
  });
}

export function updateRedisTTL(token: string, id: string, key: string, ttl: number | null): Promise<{ ok: boolean }> {
  return request(`/api/connections/${id}/redis/keys/ttl`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ key, ttl }),
  });
}

export function deleteRedisKey(token: string, id: string, key: string): Promise<{ ok: boolean }> {
  return request(`/api/connections/${id}/redis/keys?key=${encodeURIComponent(key)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function listKafkaTopics(token: string, id: string): Promise<KafkaTopic[]> {
  return request(`/api/connections/${id}/kafka/topics`, { headers: { Authorization: `Bearer ${token}` } });
}

export function listKafkaMessages(token: string, id: string, topic: string): Promise<KafkaMessage[]> {
  return request(`/api/connections/${id}/kafka/messages?topic=${encodeURIComponent(topic)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function produceKafkaMessage(
  token: string,
  id: string,
  topic: string,
  message: Omit<KafkaMessage, "offset" | "timestamp">,
): Promise<{ ok: boolean }> {
  return request(`/api/connections/${id}/kafka/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ topic, ...message }),
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

// date, if given (YYYY-MM-DD), backfills the job for that logical date
// instead of running it for today. downstream additionally (re)runs every
// job that depends on this one, transitively, stopping a branch as soon as
// something in it doesn't succeed — mirrors Airflow's "Downstream" clear
// option. Always resolves to an array: one run without downstream, one run
// per job in the cascade with it.
export function runJobNow(
  token: string,
  id: string,
  options?: { date?: string; downstream?: boolean },
): Promise<JobRun[]> {
  return request<JobRun | { runs: JobRun[] }>(`/api/jobs/${id}/run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ date: options?.date || undefined, downstream: options?.downstream || undefined }),
  }).then((res) => ("runs" in res ? res.runs : [res]));
}

export function listSecrets(token: string): Promise<Secret[]> {
  return request("/api/secrets", { headers: { Authorization: `Bearer ${token}` } });
}

export function createSecret(token: string, secret: { id: string; name: string; value: string }): Promise<Secret> {
  return request("/api/secrets", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(secret),
  });
}

// value, if omitted/empty, keeps the existing encrypted value and only renames.
export function updateSecret(token: string, id: string, update: { name: string; value?: string }): Promise<{ ok: boolean }> {
  return request(`/api/secrets/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(update),
  });
}

export function deleteSecret(token: string, id: string): Promise<{ ok: boolean }> {
  return request(`/api/secrets/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
}

export function listJobRuns(token: string, id: string): Promise<JobRun[]> {
  return request(`/api/jobs/${id}/runs`, { headers: { Authorization: `Bearer ${token}` } });
}

export function getJobRunCalendar(token: string, id: string, days = 60): Promise<JobRunCalendarDay[]> {
  return request(`/api/jobs/${id}/runs/calendar?days=${days}`, { headers: { Authorization: `Bearer ${token}` } });
}

export interface JobsTickInfo {
  secret: string;
  path: string;
}

export function getJobsTickInfo(token: string): Promise<JobsTickInfo> {
  return request("/api/jobs/tick-info", { headers: { Authorization: `Bearer ${token}` } });
}
