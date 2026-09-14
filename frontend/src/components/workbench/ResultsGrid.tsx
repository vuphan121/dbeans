import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import type { QueryResult } from "@/lib/types";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/DropdownMenu";
import { downloadCsv, downloadJson } from "@/lib/export";
import { updateCell, ApiError } from "@/lib/api";
import { useAuthStore } from "@/state/auth";
import { cn } from "@/lib/utils";

const PAGE_SIZE_OPTIONS = [50, 100, 500, 1000];
const INDEX_COL_WIDTH = 52;
const MIN_COL_WIDTH = 140;

interface EditableTable {
  schema: string;
  table: string;
  pkIndex: number;
}

interface PendingEdit {
  row: number;
  col: number;
  value: string;
}

export function ResultsGrid({
  result,
  connectionId,
  readOnly,
  onEdited,
}: {
  result?: QueryResult;
  connectionId: string;
  readOnly: boolean;
  onEdited: (rowIndex: number, colIndex: number, value: string | null) => void;
}) {
  const token = useAuthStore((s) => s.token);
  const [pageSize, setPageSize] = useState(100);
  const [page, setPage] = useState(0);
  const parentRef = useRef<HTMLDivElement>(null);

  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const rows = result?.rows ?? [];
  const columns = result?.columns ?? [];

  // A result is only editable when every column resolves to the same real
  // table (not a join/computed expression) and a primary key for that table
  // is present in the result set — otherwise there's no safe WHERE clause.
  const editableTable = useMemo<EditableTable | null>(() => {
    const cols = result?.columns ?? [];
    if (cols.length === 0) return null;
    const first = cols[0];
    if (!first.sourceTable) return null;
    const sameTable = cols.every((c) => c.sourceSchema === first.sourceSchema && c.sourceTable === first.sourceTable);
    if (!sameTable) return null;
    const pkIndex = cols.findIndex((c) => c.isPrimaryKey);
    if (pkIndex === -1) return null;
    return { schema: first.sourceSchema!, table: first.sourceTable!, pkIndex };
  }, [result]);

  useEffect(() => {
    setEditingCell(null);
    setPendingEdit(null);
    setSaveError(null);
  }, [result]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageStart = safePage * pageSize;
  const pageRows = rows.slice(pageStart, pageStart + pageSize);
  const pageEnd = pageStart + pageRows.length;

  const virtualizer = useVirtualizer({
    count: pageRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 30,
    overscan: 10,
  });

  function goToPage(next: number) {
    setPage(Math.min(totalPages - 1, Math.max(0, next)));
  }

  function startEdit(rowIndex: number, colIndex: number, currentValue: string | null) {
    if (!editableTable || readOnly || colIndex === editableTable.pkIndex) return;
    setEditingCell({ row: rowIndex, col: colIndex });
    setEditValue(currentValue ?? "");
  }

  function commitEdit(rowIndex: number, colIndex: number, originalValue: string | null) {
    const changed = editValue !== (originalValue ?? "");
    setEditingCell(null);
    if (!changed) return;
    setSaveError(null);
    setPendingEdit({ row: rowIndex, col: colIndex, value: editValue });
  }

  async function confirmEdit() {
    if (!pendingEdit || !editableTable || !token) return;
    const row = rows[pendingEdit.row];
    const pkValue = row[editableTable.pkIndex];
    if (pkValue === null) {
      setSaveError("Can't edit a row whose primary key is null.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await updateCell(token, connectionId, {
        schema: editableTable.schema,
        table: editableTable.table,
        column: columns[pendingEdit.col].name,
        value: pendingEdit.value,
        pkColumn: columns[editableTable.pkIndex].name,
        pkValue,
      });
      onEdited(pendingEdit.row, pendingEdit.col, pendingEdit.value);
      setPendingEdit(null);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Failed to save the change.");
    } finally {
      setSaving(false);
    }
  }

  const gridTemplateColumns = `${INDEX_COL_WIDTH}px repeat(${Math.max(columns.length, 1)}, minmax(${MIN_COL_WIDTH}px, 1fr))`;

  if (!result) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-bg-app text-[12px] text-text-quiet">
        Run a query to see results here.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg-app">
      <div
        style={{ gridTemplateColumns }}
        className="grid h-[30px] shrink-0 items-center border-b border-border-default bg-bg-inset font-mono text-[11px] font-medium text-text-muted"
      >
        <div className="px-2.5 text-text-ghost">#</div>
        {columns.length === 0 ? (
          <div className="border-l border-border-default px-2.5 text-text-ghost">
            {result.command} · {result.rowCount} row{result.rowCount === 1 ? "" : "s"} affected
          </div>
        ) : (
          columns.map((col) => (
            <div key={col.name} className="truncate border-l border-border-default px-2.5" title={`${col.name} · ${col.type}`}>
              {col.name} <span className="text-text-ghost">{col.type}</span>
            </div>
          ))
        )}
      </div>

      <div ref={parentRef} className="flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[12px] text-text-quiet">
            {columns.length === 0 ? "No rows affected." : "No rows returned."}
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((vRow) => {
              const globalIndex = pageStart + vRow.index;
              const row = pageRows[vRow.index];
              return (
                <div
                  key={vRow.key}
                  style={{
                    gridTemplateColumns,
                    transform: `translateY(${vRow.start}px)`,
                  }}
                  className="absolute left-0 top-0 grid h-[30px] w-full items-center border-b border-border-faint font-mono text-[11.5px] text-text-secondary"
                >
                  <div className="px-2.5 text-text-disabled">{globalIndex + 1}</div>
                  {row.map((cell, i) => {
                    const isEditing = editingCell?.row === globalIndex && editingCell.col === i;
                    const isEditable = !!editableTable && !readOnly && i !== editableTable.pkIndex;
                    if (isEditing) {
                      return (
                        <input
                          key={i}
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={() => commitEdit(globalIndex, i, cell)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitEdit(globalIndex, i, cell);
                            if (e.key === "Escape") setEditingCell(null);
                          }}
                          className="h-full w-full border-l border-border-focus bg-bg-inset px-2.5 font-mono text-[11.5px] text-text-primary outline-none"
                        />
                      );
                    }
                    return (
                      <div
                        key={i}
                        onClick={() => startEdit(globalIndex, i, cell)}
                        className={cn(
                          "truncate border-l border-border-faint px-2.5",
                          cell === null && "italic text-text-ghost",
                          isEditable && "cursor-text hover:bg-bg-hover",
                        )}
                      >
                        {cell === null ? "null" : cell}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {result.truncated && (
        <div className="flex h-8 shrink-0 items-center border-t border-border-default bg-bg-inset px-3.5 text-[11px] text-text-faint">
          Result truncated — only the first {rows.length.toLocaleString()} rows are shown.
        </div>
      )}

      <div className="flex h-9 shrink-0 items-center gap-3 border-t border-border-default bg-bg-inset px-3.5 text-[11.5px] text-text-faint">
        <span>
          Rows <span className="text-text-secondary">{rows.length === 0 ? 0 : pageStart + 1}–{pageEnd}</span> of{" "}
          {rows.length}
        </span>
        <div className="ml-auto flex items-center gap-3">
          {columns.length > 0 && rows.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex h-6 items-center gap-1 rounded-[5px] px-1.5 text-text-muted hover:bg-bg-hover">
                  <Download size={12} />
                  Export
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => downloadCsv(result, "results.csv")}>Export CSV</DropdownMenuItem>
                <DropdownMenuItem onClick={() => downloadJson(result, "results.json")}>Export JSON</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <div className="flex items-center gap-1.5">
            <span>Rows per page</span>
            <Select
              value={String(pageSize)}
              onChange={(v) => {
                setPageSize(Number(v));
                setPage(0);
              }}
              options={PAGE_SIZE_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))}
              className="h-6 text-[11px]"
            />
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => goToPage(safePage - 1)}
              disabled={safePage === 0}
              className="flex h-6 w-6 items-center justify-center rounded-[5px] text-text-muted hover:bg-bg-hover disabled:pointer-events-none disabled:opacity-30"
            >
              <ChevronLeft size={13} />
            </button>
            <span className="min-w-[64px] text-center text-text-secondary">
              Page {safePage + 1} of {totalPages}
            </span>
            <button
              onClick={() => goToPage(safePage + 1)}
              disabled={safePage >= totalPages - 1}
              className="flex h-6 w-6 items-center justify-center rounded-[5px] text-text-muted hover:bg-bg-hover disabled:pointer-events-none disabled:opacity-30"
            >
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      </div>

      {pendingEdit && editableTable && (
        <Dialog.Root open onOpenChange={(v) => !v && !saving && setPendingEdit(null)}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-[10px] border border-border-elevated bg-bg-raised p-5 shadow-2xl">
              <Dialog.Title className="mb-3 text-[14px] font-semibold text-text-primary">Confirm update</Dialog.Title>
              <div className="overflow-x-auto rounded-[7px] border border-border-input bg-bg-inset px-3 py-2.5 font-mono text-[11.5px] text-text-secondary">
                {`UPDATE "${editableTable.schema}"."${editableTable.table}" SET "${columns[pendingEdit.col].name}" = '${pendingEdit.value.replace(/'/g, "''")}' WHERE "${columns[editableTable.pkIndex].name}" = '${String(rows[pendingEdit.row][editableTable.pkIndex]).replace(/'/g, "''")}';`}
              </div>
              {saveError && <div className="mt-3 text-[11.5px] text-error-text">{saveError}</div>}
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="ghost" size="md" onClick={() => setPendingEdit(null)} disabled={saving}>
                  Cancel
                </Button>
                <Button variant="primary" size="md" onClick={() => void confirmEdit()} disabled={saving}>
                  {saving ? "Running…" : "Run UPDATE"}
                </Button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </div>
  );
}
