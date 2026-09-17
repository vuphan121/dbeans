import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { BarChart } from "@/components/ui/BarChart";
import { Dot } from "@/components/ui/Badge";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
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

type RangePreset = "week" | "month" | "custom";

const RANGE_OPTIONS: { value: RangePreset; label: string }[] = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "custom", label: "Custom" },
];

// Local date components, not toISOString() — a UTC conversion shifts the
// displayed day by one whenever local midnight and UTC midnight fall on
// different calendar dates (any positive UTC offset around local midnight).
function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Monday-start week — no particular locale requirement here, just a
// consistent, documented choice.
function startOfWeek(d: Date): Date {
  const day = d.getDay(); // 0 = Sunday .. 6 = Saturday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const start = new Date(d);
  start.setDate(d.getDate() + diffToMonday);
  start.setHours(0, 0, 0, 0);
  return start;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0);
}

interface SavedRange {
  preset: RangePreset;
  start: string;
  end: string;
}

function rangeStorageKey(connectionId: string): string {
  return `dbeans:graphs:range:${connectionId}`;
}

// Per-connection, so switching between connections doesn't clobber each
// other's last-used range. Best-effort: a private window or blocked storage
// just falls back to the "this month" default below.
function loadSavedRange(connectionId: string): SavedRange | null {
  try {
    const raw = localStorage.getItem(rangeStorageKey(connectionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.preset === "string" && typeof parsed.start === "string" && typeof parsed.end === "string") {
      return parsed as SavedRange;
    }
  } catch {
    // ignore — treat as no saved range
  }
  return null;
}

function statsTableSql(start: Date, end: Date): string {
  return `
  SELECT collected_at, database_size_bytes, active_connections, table_count,
         total_row_estimate, engine_version, max_connections, ssl_in_use,
         cache_hit_ratio, rollback_ratio, longest_query_seconds
  FROM dbeans_connection_stats
  WHERE collected_at >= '${start.toISOString()}'
    AND collected_at <= '${end.toISOString()}'
  ORDER BY collected_at DESC
  LIMIT 1000
`;
}

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
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [jobRuns, setJobRuns] = useState<Record<string, JobRun[]>>({});

  const [rangePreset, setRangePreset] = useState<RangePreset>(() => loadSavedRange(connection.id)?.preset ?? "month");
  const [customStart, setCustomStart] = useState<string>(
    () => loadSavedRange(connection.id)?.start ?? toDateInputValue(startOfMonth(new Date())),
  );
  const [customEnd, setCustomEnd] = useState<string>(() => loadSavedRange(connection.id)?.end ?? toDateInputValue(new Date()));

  useEffect(() => {
    try {
      localStorage.setItem(rangeStorageKey(connection.id), JSON.stringify({ preset: rangePreset, start: customStart, end: customEnd }));
    } catch {
      // best-effort — a blocked/private-window store just means it won't persist
    }
  }, [connection.id, rangePreset, customStart, customEnd]);

  function applyPreset(preset: "week" | "month") {
    const now = new Date();
    setCustomStart(toDateInputValue(preset === "week" ? startOfWeek(now) : startOfMonth(now)));
    setCustomEnd(toDateInputValue(now));
    setRangePreset(preset);
  }

  function handleRangeOptionChange(v: RangePreset) {
    if (v === "custom") setRangePreset("custom");
    else applyPreset(v);
  }

  function handleCustomStartChange(v: string) {
    setCustomStart(v);
    setRangePreset("custom");
  }

  function handleCustomEndChange(v: string) {
    setCustomEnd(v);
    setRangePreset("custom");
  }

  const range = useMemo(() => {
    const start = new Date(`${customStart}T00:00:00`);
    const end = new Date(`${customEnd}T23:59:59.999`);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
      const now = new Date();
      return { start: startOfMonth(now), end: now };
    }
    return { start, end };
  }, [customStart, customEnd]);

  const connectionJobs = useMemo(() => jobs.filter((j) => j.connectionId === connection.id), [jobs, connection.id]);
  const statsJob = useMemo(
    () => connectionJobs.find((j) => j.cronExpr === "0 * * * *") ?? connectionJobs[0],
    [connectionJobs],
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!token) return;
      setRefreshing(true);
      setStatsError(null);
      try {
        const result = await runQuery(token, connection.id, statsTableSql(range.start, range.end));
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
        if (!cancelled) {
          setRefreshing(false);
          setInitialLoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [token, connection.id, range]);

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
        .filter((r) => {
          if (r.durationMs == null) return false;
          const t = new Date(r.startedAt).getTime();
          return t >= range.start.getTime() && t <= range.end.getTime();
        })
        .slice()
        .reverse()
        .map((r) => ({ x: new Date(r.startedAt).getTime(), y: r.durationMs! })),
    [statsJobRuns, range],
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

  if (initialLoading) {
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

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <DateField value={customStart} onChange={handleCustomStartChange} max={customEnd} />
            <span className="text-[11px] text-text-quiet">to</span>
            <DateField value={customEnd} onChange={handleCustomEndChange} min={customStart} />
          </div>
          <div className="flex items-center gap-2">
            {refreshing && <Loader2 size={12} className="animate-spin text-text-quiet" />}
            <SegmentedControl options={RANGE_OPTIONS} value={rangePreset} onChange={handleRangeOptionChange} className="w-[248px]" />
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
          <ChartCard
            label="Storage usage"
            value={latest ? formatBytes(latest.database_size_bytes) : "—"}
            foot={`${customStart} – ${customEnd}`}
          >
            <BarChart points={storageSeries} formatValue={(v) => formatBytes(v)} formatX={(x) => new Date(x).toLocaleString()} />
          </ChartCard>
        </div>

        <div className="flex divide-x divide-border-faint rounded-[9px] border border-border-default bg-bg-surface">
          <VitalSeg
            label="Cache hit ratio"
            dot={dotFor(latest?.cache_hit_ratio, (v) => v >= 95)}
            value={latest?.cache_hit_ratio != null ? `${latest.cache_hit_ratio.toFixed(1)}%` : "—"}
          />
          <VitalSeg
            label="Rollback rate"
            dot={dotFor(latest?.rollback_ratio, (v) => v < 2)}
            value={latest?.rollback_ratio != null ? `${latest.rollback_ratio.toFixed(1)}%` : "—"}
          />
          <VitalSeg
            label="Longest running query"
            dot={dotFor(latest?.longest_query_seconds, (v) => v < 30)}
            value={latest?.longest_query_seconds != null ? formatDuration(latest.longest_query_seconds) : "—"}
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

function VitalSeg({ label, dot, value }: { label: string; dot: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 px-3.5 py-2.5">
      <span className="truncate text-[10px] font-medium uppercase tracking-wide text-text-quiet">{label}</span>
      <span className="flex items-center gap-1.5">
        <Dot className={dot} />
        <span className="font-mono text-[13px] font-semibold text-text-secondary">{value}</span>
      </span>
    </div>
  );
}

function DateField({
  value,
  onChange,
  min,
  max,
}: {
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
}) {
  return (
    <input
      type="date"
      value={value}
      min={min}
      max={max}
      onChange={(e) => onChange(e.target.value)}
      className="h-[30px] rounded-[7px] border border-border-input bg-bg-inset px-2 font-mono text-[11.5px] text-text-primary outline-none"
    />
  );
}
