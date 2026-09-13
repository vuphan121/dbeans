import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useAuthStore } from "@/state/auth";
import { useJobsStore } from "@/state/jobs";
import { getJobRunCalendar, listJobRuns, ApiError } from "@/lib/api";
import type { JobRun, JobRunCalendarDay } from "@/lib/types";
import { cn } from "@/lib/utils";

const DAYS_BACK = 63; // 9 weeks — a Dagster/Airflow-style partition grid, not calendar/weekday-aligned

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateRange(daysBack: number): string[] {
  const dates: string[] = [];
  const today = new Date();
  for (let i = daysBack - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

const STATUS_COLOR: Record<string, string> = {
  success: "bg-success-dot",
  failed: "bg-error-dot",
  blocked: "bg-text-faint",
};

// A run-history view for one job: a Dagster/Airflow-style grid of the last
// ~9 weeks (one cell per date, colored by that date's latest run status),
// plus a way to pick any date — past or future — and backfill it, which
// re-runs the job's SQL with {{date}} etc. resolved to that date instead of
// today (see backend/internal/api/jobs.go renderJobTemplate).
export function JobRunCalendar({ jobId }: { jobId: string }) {
  const token = useAuthStore((s) => s.token);
  const runNow = useJobsStore((s) => s.runNow);

  const [calendar, setCalendar] = useState<JobRunCalendarDay[]>([]);
  const [recentRuns, setRecentRuns] = useState<JobRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<{ kind: "pass" | "fail"; text: string } | null>(null);

  async function refresh() {
    if (!token) return;
    setLoading(true);
    try {
      const [cal, runs] = await Promise.all([
        getJobRunCalendar(token, jobId, DAYS_BACK),
        listJobRuns(token, jobId),
      ]);
      setCalendar(cal);
      setRecentRuns(runs);
    } catch {
      /* leave whatever we had before */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const statusByDate = useMemo(() => {
    const map = new Map<string, JobRunCalendarDay>();
    for (const day of calendar) map.set(day.date, day);
    return map;
  }, [calendar]);

  const days = useMemo(() => dateRange(DAYS_BACK), []);
  const today = todayUTC();

  async function handleRun(date?: string) {
    setRunning(true);
    setMessage(null);
    try {
      const run = await runNow(jobId, date);
      setMessage(
        run.status === "success"
          ? { kind: "pass", text: `Succeeded${date ? ` for ${date}` : ""} · ${run.rowsAffected ?? 0} row${run.rowsAffected === 1 ? "" : "s"}` }
          : { kind: "fail", text: run.error ?? `Run ${run.status}` },
      );
      await refresh();
    } catch (err) {
      setMessage({ kind: "fail", text: err instanceof ApiError ? err.message : "Failed to run job" });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-[11px] text-text-quiet">
          <Legend color="bg-success-dot" label="Succeeded" />
          <Legend color="bg-error-dot" label="Failed" />
          <Legend color="bg-text-faint" label="Blocked" />
          <Legend color="bg-bg-inset" label="No run" outline />
        </div>
        <Button variant="secondary" size="sm" onClick={() => handleRun()} disabled={running}>
          {running ? <Loader2 size={12} className="animate-spin" /> : null}
          Run now
        </Button>
      </div>

      <div className={cn("grid grid-cols-9 gap-1", loading && "opacity-50")}>
        {days.map((date) => {
          const day = statusByDate.get(date);
          const selected = selectedDate === date;
          return (
            <button
              key={date}
              type="button"
              title={day ? `${date} · ${day.status} (${day.runCount} run${day.runCount === 1 ? "" : "s"})` : `${date} · no run`}
              onClick={() => setSelectedDate(date === selectedDate ? null : date)}
              className={cn(
                "h-6 w-full rounded-[3px] border transition-colors",
                day ? STATUS_COLOR[day.status] ?? "bg-bg-inset" : "bg-bg-inset",
                date === today ? "border-text-tertiary" : "border-transparent",
                selected && "ring-2 ring-inverse-bg",
              )}
            />
          );
        })}
      </div>

      {selectedDate && (
        <div className="flex items-center justify-between rounded-[7px] border border-border-default bg-bg-inset px-3 py-2">
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-[12px] text-text-primary">{selectedDate}</span>
            <span className="text-[11px] text-text-faint">
              {statusByDate.has(selectedDate)
                ? `${statusByDate.get(selectedDate)!.runCount} run(s) · latest ${statusByDate.get(selectedDate)!.status}`
                : "No run recorded for this date"}
            </span>
          </div>
          <Button variant="primary" size="sm" onClick={() => handleRun(selectedDate)} disabled={running}>
            {running ? <Loader2 size={12} className="animate-spin" /> : null}
            Backfill {selectedDate}
          </Button>
        </div>
      )}

      {message && (
        <div className={cn("flex items-center gap-1.5 text-[11.5px]", message.kind === "pass" ? "text-success-text" : "text-error-text")}>
          {message.kind === "pass" ? <Check size={12} /> : <AlertCircle size={12} />}
          {message.text}
        </div>
      )}

      {recentRuns.length > 0 && (
        <div className="flex flex-col gap-1 rounded-[7px] border border-border-default">
          <div className="border-b border-border-faint px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-text-quiet">
            Recent runs
          </div>
          <div className="max-h-[160px] overflow-y-auto">
            {recentRuns.slice(0, 20).map((run) => (
              <div
                key={run.id}
                className="flex items-center gap-2.5 border-b border-border-faint px-3 py-1.5 text-[11.5px] last:border-b-0"
              >
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_COLOR[run.status] ?? "bg-text-faint")} />
                <span className="font-mono text-text-faint">{run.runDate}</span>
                <span className="text-text-quiet">{run.triggeredBy}</span>
                <span className="ml-auto text-text-quiet">
                  {new Date(run.startedAt).toLocaleString()}
                  {run.durationMs != null ? ` · ${run.durationMs}ms` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Legend({ color, label, outline }: { color: string; label: string; outline?: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <span className={cn("h-2.5 w-2.5 rounded-[2px]", color, outline && "border border-border-strong")} />
      {label}
    </div>
  );
}
