import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { BarChart } from "@/components/ui/BarChart";
import { Dot } from "@/components/ui/Badge";
import { useAuthStore } from "@/state/auth";
import { useJobsStore } from "@/state/jobs";
import { runQuery, listJobRuns, ApiError } from "@/lib/api";
import type { JobRun, SavedConnection } from "@/lib/types";
import { cn } from "@/lib/utils";

interface StatsRow {
  collected_at: string;
  database_size_bytes: number;
  active_connections: number;
  table_count: number;
  total_row_estimate: number;
  engine_version: string | null;
  max_connections: number | null;
  ssl_in_use: boolean | null;
  cache_hit_ratio: number | null;
  rollback_ratio: number | null;
  longest_query_seconds: number | null;
}

const STATS_TABLE_SQL = `
  SELECT collected_at, database_size_bytes, active_connections, table_count,
         total_row_estimate, engine_version, max_connections, ssl_in_use,
         cache_hit_ratio, rollback_ratio, longest_query_seconds
  FROM dbeans_connection_stats
  ORDER BY collected_at DESC
  LIMIT 200
`;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 1) return "0s";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function timeAgo(iso?: string): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// Reachability comes from dbeans' own ping mechanism. Everything else here
// comes from whatever "Connection stats" query job has been collecting
// hourly into this connection's own `dbeans_connection_stats` table — see
// docs/ARCHITECTURE.md §4 for the exact collection SQL, since dbeans itself
// never writes to that table, only reads it back for these graphs.
export function ConnectionGraphs({ connection }: { connection: SavedConnection }) {
  const token = useAuthStore((s) => s.token);
  const jobs = useJobsStore((s) => s.jobs);

  const [stats, setStats] = useState<StatsRow[] | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [jobRuns, setJobRuns] = useState<Record<string, JobRun[]>>({});

  const connectionJobs = useMemo(() => jobs.filter((j) => j.connectionId === connection.id), [jobs, connection.id]);
  const statsJob = useMemo(
    () => connectionJobs.find((j) => j.cronExpr === "0 * * * *") ?? connectionJobs[0],
    [connectionJobs],
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!token) return;
      setLoading(true);
      setStatsError(null);
      try {
        const result = await runQuery(token, connection.id, STATS_TABLE_SQL);
        if (cancelled) return;
        const idx = (name: string) => result.columns.findIndex((c) => c.name === name);
        const num = (r: unknown[], name: string) => {
          const v = r[idx(name)];
          return v == null ? null : Number(v);
        };
        const rows: StatsRow[] = result.rows.map((r) => ({
          collected_at: r[idx("collected_at")] as unknown as string,
          database_size_bytes: Number(r[idx("database_size_bytes")]),
          active_connections: Number(r[idx("active_connections")]),
          table_count: Number(r[idx("table_count")]),
          total_row_estimate: Number(r[idx("total_row_estimate")]),
          engine_version: r[idx("engine_version")] as unknown as string | null,
          max_connections: num(r, "max_connections"),
          ssl_in_use: r[idx("ssl_in_use")] as unknown as boolean | null,
          cache_hit_ratio: num(r, "cache_hit_ratio"),
          rollback_ratio: num(r, "rollback_ratio"),
          longest_query_seconds: num(r, "longest_query_seconds"),
        }));
        setStats(rows.reverse()); // oldest first, for charting left-to-right
      } catch (err) {
        if (!cancelled) setStatsError(err instanceof ApiError ? err.message : "Failed to load stats");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [token, connection.id]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!token || connectionJobs.length === 0) return;
      const entries = await Promise.all(
        connectionJobs.map(async (j) => [j.id, await listJobRuns(token, j.id).catch(() => [])] as const),
      );
      if (!cancelled) setJobRuns(Object.fromEntries(entries));
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [token, connectionJobs]);

  const latest = stats && stats.length > 0 ? stats[stats.length - 1] : null;

  const connSeries = useMemo(
    () => (stats ?? []).map((r) => ({ x: new Date(r.collected_at).getTime(), y: r.active_connections })),
    [stats],
  );
  const storageSeries = useMemo(
    () => (stats ?? []).map((r) => ({ x: new Date(r.collected_at).getTime(), y: r.database_size_bytes })),
    [stats],
  );

  const statsJobRuns = statsJob ? jobRuns[statsJob.id] ?? [] : [];
  const latencySeries = useMemo(
    () =>
      statsJobRuns
        .filter((r) => r.durationMs != null)
        .slice()
        .reverse()
        .map((r) => ({ x: new Date(r.startedAt).getTime(), y: r.durationMs! })),
    [statsJobRuns],
  );

  const allRuns = useMemo(
    () =>
      connectionJobs
        .flatMap((j) => (jobRuns[j.id] ?? []).map((r) => ({ ...r, jobName: j.name })))
        .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()),
    [connectionJobs, jobRuns],
  );
  const recentOutages = allRuns.filter((r) => r.status !== "success").slice(0, 5);

  const connPct = latest?.max_connections ? Math.round((latest.active_connections / latest.max_connections) * 100) : null;

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 size={18} className="animate-spin text-text-quiet" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-bg-app p-6">
      <div className="mx-auto flex max-w-[820px] flex-col gap-3">
        {statsError && (
          <div className="rounded-[8px] border border-border-default bg-bg-surface px-4 py-6 text-center text-[12.5px] text-text-faint">
            No stats collected yet for this connection.
            <div className="mt-1 text-[11.5px] text-text-quiet">
              Set up (or update) an hourly "Connection stats" query job against this connection — see
              docs/ARCHITECTURE.md §4 for the collection SQL, including the newer cache-hit/rollback/longest-query
              columns.
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 rounded-[10px] border border-border-elevated bg-bg-raised px-5 py-4">
          <div className="flex items-center gap-3">
            <Dot
              className={cn(
                "h-2 w-2",
                connection.status === "online" ? "bg-success-dot" : connection.status === "offline" ? "bg-error-dot" : "bg-text-faint",
              )}
            />
            <div className="flex flex-col gap-0.5">
              <span className="text-[15px] font-semibold text-text-primary">
                {connection.status === "online" ? "Online" : connection.status === "offline" ? "Offline" : "Unknown"}
              </span>
              <span className="text-[11px] text-text-faint">
                {connection.lastCheckedAt ? `checked ${timeAgo(connection.lastCheckedAt)}` : "never checked"}
              </span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-0.5 text-right text-[11.5px] text-text-quiet">
            <span className="font-medium text-text-tertiary">{connection.name}</span>
            <span>
              {connection.engine}
              {latest?.engine_version ? ` ${shortVersion(latest.engine_version)}` : ""}
              {latest ? ` · ${latest.table_count} tables` : ""}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <ChartCard
            label="Connections used"
            value={connPct != null ? `${connPct}%` : "—"}
            foot={latest?.max_connections ? `${latest.active_connections} of ${latest.max_connections} max` : "no data"}
          >
            <BarChart points={connSeries} formatValue={(v) => String(Math.round(v))} formatX={(x) => new Date(x).toLocaleString()} />
          </ChartCard>
          <ChartCard label="Storage usage" value={latest ? formatBytes(latest.database_size_bytes) : "—"} foot="7-day trend">
            <BarChart points={storageSeries} formatValue={(v) => formatBytes(v)} formatX={(x) => new Date(x).toLocaleString()} />
          </ChartCard>
        </div>

        <div className="flex divide-x divide-border-faint rounded-[9px] border border-border-default bg-bg-surface">
          <VitalSeg
            label="Cache hit ratio"
            dot={dotFor(latest?.cache_hit_ratio, (v) => v >= 95)}
            value={latest?.cache_hit_ratio != null ? `${latest.cache_hit_ratio.toFixed(1)}%` : "—"}
            foot="pg_stat_database"
          />
          <VitalSeg
            label="Rollback rate"
            dot={dotFor(latest?.rollback_ratio, (v) => v < 2)}
            value={latest?.rollback_ratio != null ? `${latest.rollback_ratio.toFixed(1)}%` : "—"}
            foot="pg_stat_database"
          />
          <VitalSeg
            label="Longest running query"
            dot={dotFor(latest?.longest_query_seconds, (v) => v < 30)}
            value={latest?.longest_query_seconds != null ? formatDuration(latest.longest_query_seconds) : "—"}
            foot="pg_stat_activity"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1 px-3.5 py-2.5">
            <span className="truncate text-[10px] font-medium uppercase tracking-wide text-text-quiet">Query latency</span>
            <span className="font-mono text-[13px] font-semibold text-text-secondary">
              {statsJobRuns[0]?.durationMs != null ? `${statsJobRuns[0].durationMs}ms` : "—"}
            </span>
            <BarChart points={latencySeries} compact formatValue={(v) => `${Math.round(v)}ms`} />
          </div>
        </div>

        <div className="pt-1">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-text-quiet">Recent failed runs</div>
          {recentOutages.length === 0 ? (
            <div className="py-1.5 text-[11px] text-text-quiet">No failures recorded for this connection's jobs.</div>
          ) : (
            recentOutages.map((run, i) => (
              <div
                key={run.id}
                className={cn("flex items-center gap-2 py-[3px] text-[11px]", i > 0 && "border-t border-border-faint")}
              >
                <span className="text-text-tertiary">{(run as JobRun & { jobName: string }).jobName}</span>
                <span className="text-error-dim">{run.status}</span>
                <span className="ml-auto font-mono text-[10px] text-text-quiet">{new Date(run.startedAt).toLocaleString()}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function dotFor(value: number | null | undefined, isGood: (v: number) => boolean): string {
  if (value == null) return "bg-text-faint";
  return isGood(value) ? "bg-success-dot" : "bg-error-dot";
}

function shortVersion(full: string): string {
  const match = full.match(/^\S+\s+\S+/);
  return match ? match[0] : full;
}

function ChartCard({ label, value, foot, children }: { label: string; value: string; foot: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-[9px] border border-border-default bg-bg-surface p-3.5 pb-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[10.5px] font-medium uppercase tracking-wide text-text-quiet">{label}</span>
        <span className="font-mono text-[17px] font-semibold text-text-primary">{value}</span>
      </div>
      {children}
      <div className="text-[10.5px] text-text-faint">{foot}</div>
    </div>
  );
}

function VitalSeg({ label, dot, value, foot }: { label: string; dot: string; value: string; foot: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 px-3.5 py-2.5">
      <span className="truncate text-[10px] font-medium uppercase tracking-wide text-text-quiet">{label}</span>
      <span className="flex items-center gap-1.5">
        <Dot className={dot} />
        <span className="font-mono text-[13px] font-semibold text-text-secondary">{value}</span>
      </span>
      <span className="text-[9.5px] text-text-quiet">{foot}</span>
    </div>
  );
}
