import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertCircle, Clock, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { LineChart, type LineChartSeries } from "@/components/ui/LineChart";
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
}

const STATS_TABLE_SQL = `
  SELECT collected_at, database_size_bytes, active_connections, table_count,
         total_row_estimate, engine_version, max_connections, ssl_in_use
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

// The per-connection health/metrics view — a second thing you can look at
// besides the schema + SQL editor, fed by whatever "Connection stats" job
// has been collecting hourly for this connection (see the job's own SQL in
// AddJob for exactly what it captures) plus data dbeans already tracks
// elsewhere (ping-based reachability, job run history).
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
        const rows: StatsRow[] = result.rows.map((r) => ({
          collected_at: r[idx("collected_at")] as unknown as string,
          database_size_bytes: Number(r[idx("database_size_bytes")]),
          active_connections: Number(r[idx("active_connections")]),
          table_count: Number(r[idx("table_count")]),
          total_row_estimate: Number(r[idx("total_row_estimate")]),
          engine_version: r[idx("engine_version")] as unknown as string | null,
          max_connections: r[idx("max_connections")] != null ? Number(r[idx("max_connections")]) : null,
          ssl_in_use: r[idx("ssl_in_use")] as unknown as boolean | null,
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

  const storageSeries: LineChartSeries[] = useMemo(
    () => [
      {
        label: "Storage",
        color: "var(--color-accent)",
        points: (stats ?? []).map((r) => ({ x: new Date(r.collected_at).getTime(), y: r.database_size_bytes })),
      },
    ],
    [stats],
  );

  const connectionsSeries: LineChartSeries[] = useMemo(
    () => [
      {
        label: "Active",
        color: "var(--color-accent)",
        points: (stats ?? []).map((r) => ({ x: new Date(r.collected_at).getTime(), y: r.active_connections })),
      },
      {
        label: "Max",
        color: "var(--color-text-quiet)",
        points: (stats ?? []).map((r) => ({ x: new Date(r.collected_at).getTime(), y: r.max_connections ?? 0 })),
      },
    ],
    [stats],
  );

  const statsJobRuns = statsJob ? jobRuns[statsJob.id] ?? [] : [];
  const latencySeries: LineChartSeries[] = useMemo(
    () => [
      {
        label: "Latency",
        color: "var(--color-accent)",
        points: statsJobRuns
          .filter((r) => r.durationMs != null)
          .slice()
          .reverse()
          .map((r) => ({ x: new Date(r.startedAt).getTime(), y: r.durationMs! })),
      },
    ],
    [statsJobRuns],
  );

  const allRuns = useMemo(
    () =>
      connectionJobs
        .flatMap((j) => (jobRuns[j.id] ?? []).map((r) => ({ ...r, jobName: j.name })))
        .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()),
    [connectionJobs, jobRuns],
  );
  const recentOutages = allRuns.filter((r) => r.status !== "success").slice(0, 8);

  const lastSuccessfulCheck = statsJobRuns.find((r) => r.status === "success")?.finishedAt;
  const authOk = statsJobRuns[0]?.status === "success";
  const sslMode = "sslMode" in connection.fields ? connection.fields.sslMode : undefined;

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 size={18} className="animate-spin text-text-quiet" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-bg-app p-6">
      <div className="mx-auto flex max-w-[920px] flex-col gap-4">
        {statsError && (
          <div className="rounded-[8px] border border-border-default bg-bg-surface px-4 py-6 text-center text-[12.5px] text-text-faint">
            No stats collected yet for this connection.
            <div className="mt-1 text-[11.5px] text-text-quiet">
              Set up an hourly "Connection stats" query job against this connection to start populating these
              graphs.
            </div>
          </div>
        )}

        <div className="grid grid-cols-4 gap-3">
          <StatusCard
            label="Reachability"
            value={connection.status === "online" ? "Online" : connection.status === "offline" ? "Offline" : "Unknown"}
            dotClassName={
              connection.status === "online" ? "bg-success-dot" : connection.status === "offline" ? "bg-error-dot" : "bg-text-faint"
            }
            sub={connection.lastCheckedAt ? `checked ${timeAgo(connection.lastCheckedAt)}` : "never checked"}
          />
          <StatusCard
            label="Authentication"
            value={statsJobRuns.length === 0 ? "Unknown" : authOk ? "Succeeding" : "Failing"}
            dotClassName={statsJobRuns.length === 0 ? "bg-text-faint" : authOk ? "bg-success-dot" : "bg-error-dot"}
            sub={statsJobRuns.length === 0 ? "no checks yet" : `last run ${timeAgo(statsJobRuns[0]?.startedAt)}`}
          />
          <StatusCard
            label="TLS"
            icon={sslMode && sslMode !== "disable" ? <ShieldCheck size={13} /> : <ShieldOff size={13} />}
            value={sslMode ? sslMode : "n/a"}
            dotClassName={sslMode && sslMode !== "disable" ? "bg-success-dot" : "bg-text-faint"}
            sub={latest?.ssl_in_use != null ? `session: ${latest.ssl_in_use ? "encrypted" : "plain"}` : "configured mode"}
          />
          <StatusCard
            label="Last successful check"
            icon={<Clock size={13} />}
            value={timeAgo(lastSuccessfulCheck)}
            dotClassName="bg-text-faint"
            sub={statsJob ? statsJob.name : "no stats job"}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <ChartCard title="Storage usage" value={latest ? formatBytes(latest.database_size_bytes) : "—"}>
            <LineChart series={storageSeries} formatValue={(v) => formatBytes(v)} formatX={(x) => new Date(x).toLocaleString()} />
          </ChartCard>
          <ChartCard
            title="Active vs. max connections"
            value={latest ? `${latest.active_connections} / ${latest.max_connections ?? "—"}` : "—"}
          >
            <LineChart series={connectionsSeries} formatX={(x) => new Date(x).toLocaleString()} />
          </ChartCard>
          <ChartCard title="Query latency" value={statsJobRuns[0]?.durationMs != null ? `${statsJobRuns[0].durationMs}ms` : "—"}>
            <LineChart series={latencySeries} formatValue={(v) => `${Math.round(v)}ms`} formatX={(x) => new Date(x).toLocaleString()} />
          </ChartCard>
          <div className="flex flex-col gap-2 rounded-[8px] border border-border-default bg-bg-surface p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-text-quiet">Database</div>
            <InfoRow label="Engine" value={connection.engine} />
            <InfoRow label="Version" value={latest?.engine_version ? shortVersion(latest.engine_version) : "—"} />
            <InfoRow label="Tables" value={latest ? String(latest.table_count) : "—"} />
            <InfoRow label="Rows (est.)" value={latest ? latest.total_row_estimate.toLocaleString() : "—"} />
          </div>
        </div>

        <div className="flex flex-col gap-1 rounded-[7px] border border-border-default">
          <div className="border-b border-border-faint px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-text-quiet">
            Recent outages &amp; failed runs
          </div>
          {recentOutages.length === 0 ? (
            <div className="px-3 py-3 text-[12px] text-text-quiet">No failures recorded for this connection's jobs.</div>
          ) : (
            <div className="max-h-[220px] overflow-y-auto">
              {recentOutages.map((run) => (
                <div
                  key={run.id}
                  className="flex items-center gap-2.5 border-b border-border-faint px-3 py-1.5 text-[11.5px] last:border-b-0"
                >
                  {run.status === "failed" ? (
                    <AlertCircle size={11} className="shrink-0 text-error-dim" />
                  ) : (
                    <Dot className={cn("shrink-0", "bg-text-faint")} />
                  )}
                  <span className="text-text-secondary">{(run as JobRun & { jobName: string }).jobName}</span>
                  <span className="text-text-quiet">{run.status}</span>
                  <span className="ml-auto text-text-quiet">{new Date(run.startedAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function shortVersion(full: string): string {
  const match = full.match(/^\S+\s+\S+/);
  return match ? match[0] : full;
}

function StatusCard({
  label,
  value,
  sub,
  dotClassName,
  icon,
}: {
  label: string;
  value: string;
  sub: string;
  dotClassName: string;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-[8px] border border-border-default bg-bg-surface p-3.5">
      <div className="text-[10.5px] font-medium uppercase tracking-wide text-text-quiet">{label}</div>
      <div className="flex items-center gap-1.5">
        {icon ?? <Dot className={dotClassName} />}
        <span className="text-[13px] font-medium text-text-primary">{value}</span>
      </div>
      <div className="text-[10.5px] text-text-faint">{sub}</div>
    </div>
  );
}

function ChartCard({ title, value, children }: { title: string; value: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-[8px] border border-border-default bg-bg-surface p-4">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-medium uppercase tracking-wide text-text-quiet">{title}</div>
        <div className="font-mono text-[12px] text-text-primary">{value}</div>
      </div>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <span className="text-text-faint">{label}</span>
      <span className="font-mono text-text-secondary">{value}</span>
    </div>
  );
}
