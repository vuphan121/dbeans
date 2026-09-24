import { useEffect, useRef, useState } from "react";
import { WorkbenchShell } from "./WorkbenchShell";
import { SchemaTree } from "./SchemaTree";
import { TabStrip } from "./TabStrip";
import { SqlEditor } from "./SqlEditor";
import { StatusBar } from "./StatusBar";
import { ResultsGrid } from "./ResultsGrid";
import { ResizeDivider } from "./ResizeDivider";
import { ConnectionGraphs } from "./ConnectionGraphs";
import { SchemaDiagram } from "./SchemaDiagram";
import { DataBrowser } from "./DataBrowser";
import { HistoryPanel } from "./HistoryPanel";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useWorkbenchStore } from "@/state/workbench";
import { useSettingsStore } from "@/state/settings";
import { useAuthStore } from "@/state/auth";
import { trackEvent, runQuery as runQueryRequest, ApiError } from "@/lib/api";
import { comboLabel } from "@/lib/platform";
import type { QueryResult, SavedConnection } from "@/lib/types";

export function SqlWorkbench({
  connection,
  onOpenPalette,
}: {
  connection: SavedConnection;
  onOpenPalette: () => void;
}) {
  const { tabs, activeTabId, updateTabSql, openTable, openSql } = useWorkbenchStore();
  const { theme, editorFontSize } = useSettingsStore();
  const token = useAuthStore((s) => s.token);
  const resolvedTheme = theme === "system" ? (document.documentElement.getAttribute("data-theme") as "dark" | "light" | null) ?? "dark" : theme;
  const [view, setView] = useState<"query" | "data" | "history" | "graphs" | "erd">("query");
  // In-flight runs, per tab, so each can be cancelled on its own. The ref holds
  // the controllers; the state mirrors which tabs are running so the UI updates.
  const runs = useRef<Record<string, AbortController>>({});
  const [runningTabs, setRunningTabs] = useState<Record<string, boolean>>({});
  const [cancelledTabs, setCancelledTabs] = useState<Record<string, boolean>>({});
  const [editorHeight, setEditorHeight] = useState(296);
  const [resultByTab, setResultByTab] = useState<Record<string, QueryResult>>({});
  const [errorByTab, setErrorByTab] = useState<Record<string, string>>({});

  function resizeEditor(deltaY: number) {
    setEditorHeight((h) => Math.min(640, Math.max(140, h + deltaY)));
  }

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const result = activeTab ? resultByTab[activeTab.id] : undefined;
  const error = activeTab ? errorByTab[activeTab.id] : undefined;
  const running = !!activeTab && !!runningTabs[activeTab.id];
  const cancelled = !!activeTab && !!cancelledTabs[activeTab.id];

  async function runQuery() {
    if (!activeTab?.sql?.trim() || !token) return;
    const tabId = activeTab.id;
    if (runs.current[tabId]) return; // one run per tab at a time
    const sql = activeTab.sql;
    const controller = new AbortController();
    runs.current[tabId] = controller;
    setRunningTabs((r) => ({ ...r, [tabId]: true }));
    setCancelledTabs((c) => ({ ...c, [tabId]: false }));
    setErrorByTab((e) => ({ ...e, [tabId]: "" }));
    try {
      const res = await runQueryRequest(token, connection.id, sql, undefined, controller.signal);
      setResultByTab((r) => ({ ...r, [tabId]: res }));
      trackEvent(token, "query_run", {
        connectionId: connection.id,
        engine: connection.engine,
        sql,
        durationMs: res.durationMs,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        // A cancel is not an error, and the previous run's result no longer
        // describes what's in the editor.
        setCancelledTabs((c) => ({ ...c, [tabId]: true }));
        setResultByTab((r) => {
          const next = { ...r };
          delete next[tabId];
          return next;
        });
      } else {
        const message = err instanceof ApiError ? err.message : "Failed to run query";
        setErrorByTab((e) => ({ ...e, [tabId]: message }));
      }
    } finally {
      delete runs.current[tabId];
      setRunningTabs((r) => ({ ...r, [tabId]: false }));
    }
  }

  function cancelQuery() {
    if (activeTab) runs.current[activeTab.id]?.abort();
  }

  // Esc cancels the running query. An open autocomplete popup handles (and
  // prevents) its own Esc first, so closing it never cancels anything.
  useEffect(() => {
    if (!running || view !== "query") return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !e.defaultPrevented) runs.current[activeTabId]?.abort();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [running, view, activeTabId]);

  return (
    <WorkbenchShell
      onOpenPalette={onOpenPalette}
      sidebar={<SchemaTree connectionId={connection.id} />}
      topBarCenter={
        <div className="flex w-full items-stretch">
          <div className="flex shrink-0 items-center border-r border-border-subtle px-3">
            <SegmentedControl<"query" | "data" | "history" | "graphs" | "erd">
              options={[
                { value: "query", label: "Query" },
                { value: "data", label: "Data" },
                { value: "history", label: "History" },
                { value: "graphs", label: "Graphs" },
                { value: "erd", label: "ERD" },
              ]}
              value={view}
              onChange={setView}
              className="w-[320px]"
            />
          </div>
          {view === "query" && <TabStrip />}
        </div>
      }
    >
      {view === "data" ? (
        <DataBrowser key={connection.id} connection={connection} onOpenQuery={(tableName) => { openTable(tableName); setView("query"); }} onOpenSql={(title, sql) => { openSql(title, sql); setView("query"); }} />
      ) : view === "history" ? (
        <HistoryPanel key={connection.id} connection={connection} onOpenSql={(title, sql) => { openSql(title, sql); setView("query"); }} />
      ) : view === "graphs" ? (
        <ConnectionGraphs connection={connection} />
      ) : view === "erd" ? (
        <SchemaDiagram connectionId={connection.id} />
      ) : (
        activeTab && (
          <>
            <div className="relative shrink-0" style={{ height: editorHeight }}>
              <SqlEditor
                value={activeTab.sql ?? ""}
                onChange={(v) => updateTabSql(activeTab.id, v)}
                theme={resolvedTheme}
                fontSize={editorFontSize}
                onRun={runQuery}
                connectionId={connection.id}
              />
              <div className="pointer-events-none absolute right-3.5 top-3 flex gap-1.5">
                <Button variant="secondary" size="sm" className="pointer-events-auto">
                  Format
                </Button>
                <Button variant="primary" size="sm" onClick={running ? cancelQuery : runQuery} title={running ? "Cancel (Esc)" : undefined} className="pointer-events-auto">
                  {running ? "Cancel" : <>Run <span className="font-mono opacity-55">{comboLabel("⏎")}</span></>}
                </Button>
              </div>
            </div>
            <ResizeDivider onDrag={resizeEditor} />
            {result && (
              <StatusBar
                rows={result.rowCount}
                ms={result.durationMs}
                connectionName={connection.name}
                schema={"database" in connection.fields ? connection.fields.database : ""}
              />
            )}
            {error ? (
              <div className="flex flex-1 items-start justify-center overflow-y-auto bg-bg-app p-6">
                <div className="max-w-xl rounded-[8px] border border-error-dim/40 bg-error-dim/10 px-4 py-3 font-mono text-[12px] text-error-text">
                  {error}
                </div>
              </div>
            ) : cancelled ? (
              <div className="flex flex-1 items-center justify-center bg-bg-app text-[12px] text-text-quiet">Query cancelled</div>
            ) : (
              <ResultsGrid
                result={result}
                connectionId={connection.id}
                readOnly={"readOnly" in connection.fields ? connection.fields.readOnly : true}
                onEdited={(rowIndex, colIndex, value) =>
                  setResultByTab((prev) => {
                    const current = prev[activeTab.id];
                    if (!current) return prev;
                    const rows = current.rows.map((r, i) => (i === rowIndex ? r.map((c, j) => (j === colIndex ? value : c)) : r));
                    return { ...prev, [activeTab.id]: { ...current, rows } };
                  })
                }
              />
            )}
          </>
        )
      )}
    </WorkbenchShell>
  );
}
