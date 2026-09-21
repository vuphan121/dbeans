import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ApiError, getConnectionHistory } from "@/lib/api";
import type { HistoryEntry, SavedConnection } from "@/lib/types";
import { useAuthStore } from "@/state/auth";
import { cn } from "@/lib/utils";

const LABELS: Record<HistoryEntry["eventType"], string> = {
  query_run: "Query",
  row_insert: "Row added",
  row_update: "Row updated",
  row_delete: "Row deleted",
  bulk_row_delete: "Rows deleted",
  schema_change: "Schema change",
  table_import: "CSV import",
};

function summary(entry: HistoryEntry): string {
  const p = entry.payload as Record<string, unknown>;
  switch (entry.eventType) {
    case "query_run":
      return typeof p.sql === "string" ? p.sql.replace(/\s+/g, " ").trim() : "";
    case "row_insert":
    case "row_delete":
      return `${p.schema}.${p.table}`;
    case "row_update":
      return `${p.schema}.${p.table} — ${Object.keys((p.values as object) ?? {}).join(", ")}`;
    case "bulk_row_delete":
      return `${p.schema}.${p.table} — ${Array.isArray(p.keys) ? p.keys.length : 0} rows`;
    case "table_import":
      return `${p.schema}.${p.table} — ${p.rowsAffected} rows`;
    case "schema_change":
      return typeof p.sql === "string" ? p.sql.replace(/\s+/g, " ").trim() : "";
    default:
      return "";
  }
}

// Reads back the analytics_events audit trail (query runs from the
// workbench's own trackEvent call, plus every Data-editor mutation logged
// server-side — see table_data.go's logTableMutation) for this connection.
export function HistoryPanel({ connection, onOpenSql }: { connection: SavedConnection; onOpenSql: (title: string, sql: string) => void }) {
  const token = useAuthStore((s) => s.token);
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError("");
    try {
      setEntries(await getConnectionHistory(token, connection.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load history.");
    } finally {
      setLoading(false);
    }
  }, [connection.id, token]);
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg-app">
      <div className="flex h-12 shrink-0 items-center justify-end border-b border-border-default bg-bg-surface px-3.5">
        <Button size="sm" variant="secondary" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </Button>
      </div>
      {error && <div className="shrink-0 border-b border-error-border bg-error-bg px-3.5 py-2 text-[11.5px] text-error-text">{error}</div>}
      <div className="min-h-0 flex-1 overflow-auto">
        {loading && !entries ? (
          <div className="flex h-full items-center justify-center gap-2 text-[12px] text-text-faint"><Loader2 size={13} className="animate-spin" /> Loading history…</div>
        ) : !entries?.length ? (
          <div className="flex h-full items-center justify-center text-[12px] text-text-quiet">No activity recorded yet.</div>
        ) : (
          <table className="w-full border-collapse font-mono text-[11.5px]">
            <tbody>
              {entries.map((entry) => {
                const clickable = entry.eventType === "query_run";
                return (
                  <tr
                    key={entry.id}
                    className={cn("border-b border-border-faint", clickable && "cursor-pointer hover:bg-bg-hover/50")}
                    onClick={() => clickable && onOpenSql(`history: ${new Date(entry.createdAt).toLocaleTimeString()}`, `${(entry.payload.sql as string | undefined) ?? ""}\n`)}
                  >
                    <td className="w-[170px] whitespace-nowrap px-3 py-2 text-text-ghost">{new Date(entry.createdAt).toLocaleString()}</td>
                    <td className="w-[110px] whitespace-nowrap px-3 py-2 text-text-secondary">{LABELS[entry.eventType] ?? entry.eventType}</td>
                    <td className="truncate px-3 py-2 text-text-secondary">{summary(entry)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
