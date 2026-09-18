import { useState } from "react";
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
  const [view, setView] = useState<"query" | "data" | "graphs" | "erd">("query");
  const [running, setRunning] = useState(false);
  const [editorHeight, setEditorHeight] = useState(296);
  const [resultByTab, setResultByTab] = useState<Record<string, QueryResult>>({});
  const [errorByTab, setErrorByTab] = useState<Record<string, string>>({});

  function resizeEditor(deltaY: number) {
    setEditorHeight((h) => Math.min(640, Math.max(140, h + deltaY)));
  }

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const result = activeTab ? resultByTab[activeTab.id] : undefined;
  const error = activeTab ? errorByTab[activeTab.id] : undefined;

  async function runQuery() {
    if (!activeTab?.sql?.trim() || !token) return;
    const tabId = activeTab.id;
    const sql = activeTab.sql;
    setRunning(true);
    setErrorByTab((e) => ({ ...e, [tabId]: "" }));
    try {
      const res = await runQueryRequest(token, connection.id, sql);
      setResultByTab((r) => ({ ...r, [tabId]: res }));
      trackEvent(token, "query_run", {
        connectionId: connection.id,
        engine: connection.engine,
        sql,
        durationMs: res.durationMs,
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to run query";
      setErrorByTab((e) => ({ ...e, [tabId]: message }));
    } finally {
      setRunning(false);
    }
  }

  return (
    <WorkbenchShell
      onOpenPalette={onOpenPalette}
      sidebar={<SchemaTree connectionId={connection.id} />}
      topBarCenter={
        <div className="flex w-full items-stretch">
          <div className="flex shrink-0 items-center border-r border-border-subtle px-3">
            <SegmentedControl<"query" | "data" | "graphs" | "erd">
              options={[
                { value: "query", label: "Query" },
                { value: "data", label: "Data" },
                { value: "graphs", label: "Graphs" },
                { value: "erd", label: "ERD" },
              ]}
              value={view}
              onChange={setView}
              className="w-[258px]"
            />
          </div>
          {view === "query" && <TabStrip />}
        </div>
      }
    >
      {view === "data" ? (
        <DataBrowser connection={connection} onOpenQuery={(tableName) => { openTable(tableName); setView("query"); }} onOpenSql={(title, sql) => { openSql(title, sql); setView("query"); }} />
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
                <Button variant="primary" size="sm" onClick={runQuery} className="pointer-events-auto">
                  {running ? "Running…" : "Run"} <span className="font-mono opacity-55">{comboLabel("⏎")}</span>
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
