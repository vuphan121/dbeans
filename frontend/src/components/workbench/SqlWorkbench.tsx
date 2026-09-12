import { useState } from "react";
import { WorkbenchShell } from "./WorkbenchShell";
import { SchemaTree } from "./SchemaTree";
import { TabStrip } from "./TabStrip";
import { SqlEditor } from "./SqlEditor";
import { StatusBar } from "./StatusBar";
import { ResultsGrid } from "./ResultsGrid";
import { ResizeDivider } from "./ResizeDivider";
import { Button } from "@/components/ui/Button";
import { useWorkbenchStore } from "@/state/workbench";
import { useSettingsStore } from "@/state/settings";
import { useAuthStore } from "@/state/auth";
import { trackEvent } from "@/lib/api";
import { comboLabel } from "@/lib/platform";
import { USER_ROWS } from "@/mock/sqlFixtures";
import type { SavedConnection } from "@/lib/types";

export function SqlWorkbench({
  connection,
  onOpenPalette,
}: {
  connection: SavedConnection;
  onOpenPalette: () => void;
}) {
  const { tabs, activeTabId, updateTabSql } = useWorkbenchStore();
  const { theme, editorFontSize } = useSettingsStore();
  const token = useAuthStore((s) => s.token);
  const resolvedTheme = theme === "system" ? (document.documentElement.getAttribute("data-theme") as "dark" | "light" | null) ?? "dark" : theme;
  const [lastRunMs, setLastRunMs] = useState(38);
  const [running, setRunning] = useState(false);
  const [editorHeight, setEditorHeight] = useState(296);

  function resizeEditor(deltaY: number) {
    setEditorHeight((h) => Math.min(640, Math.max(140, h + deltaY)));
  }

  const activeTab = tabs.find((t) => t.id === activeTabId);

  function runQuery() {
    setRunning(true);
    const start = performance.now();
    window.setTimeout(() => {
      const ms = Math.round(performance.now() - start) + 12;
      setLastRunMs(ms);
      setRunning(false);
      if (token) {
        trackEvent(token, "query_run", {
          connectionId: connection.id,
          engine: connection.engine,
          sql: activeTab?.sql,
          durationMs: ms,
        });
      }
    }, 220);
  }

  return (
    <WorkbenchShell
      onOpenPalette={onOpenPalette}
      sidebar={<SchemaTree />}
      topBarCenter={<TabStrip />}
    >
      {activeTab?.kind === "sql" ? (
        <>
          <div className="relative shrink-0" style={{ height: editorHeight }}>
            <SqlEditor
              value={activeTab.sql ?? ""}
              onChange={(v) => updateTabSql(activeTab.id, v)}
              theme={resolvedTheme}
              fontSize={editorFontSize}
              onRun={runQuery}
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
          <StatusBar rows={USER_ROWS.length} ms={lastRunMs} connectionName={connection.name} schema="public" />
          <ResultsGrid rows={USER_ROWS} />
        </>
      ) : (
        <>
          <StatusBar rows={USER_ROWS.length} ms={lastRunMs} connectionName={connection.name} schema="public" />
          <ResultsGrid rows={USER_ROWS} />
        </>
      )}
    </WorkbenchShell>
  );
}
