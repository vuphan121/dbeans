import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3, Download, Filter, Loader2, Pencil, Plus, RefreshCw, TableProperties, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { browseTableData, bulkDeleteTableRows, countTableData, deleteTableRow, errorMessage, executeSchemaChange, insertTableRow, updateTableRow } from "@/lib/api";
import { OPERATORS, PAGE_SIZES, sanitizeViewConfig } from "@/lib/dataView";
import { downloadCsv, downloadJson } from "@/lib/export";
import type { ColumnInfo, DataFilter, DataFilterOperator, DataSort, DataViewConfig, InsertRowResult, SavedConnection, TableDataPage, TableInfo, TotalKind } from "@/lib/types";
import { useAuthStore } from "@/state/auth";
import { useDataViewStore } from "@/state/dataView";
import { useSavedViewsStore } from "@/state/savedViews";
import { useSchemaStore } from "@/state/schema";
import { useToastStore } from "@/state/toast";
import { cn } from "@/lib/utils";
import { Actions, Check, Confirm, Field, Modal } from "./DataDialogs";
import { ImportDialog } from "./ImportDialog";
import { TablePicker } from "./TablePicker";
import { ViewsMenu } from "./ViewsMenu";

const SQL_TYPES = ["text", "integer", "bigint", "numeric", "boolean", "uuid", "date", "timestamp with time zone", "jsonb"];
type SelectedTable = { schema: string; table: TableInfo };
type RowDialog = { mode: "add" } | { mode: "edit"; row: (string | null)[] };
type TotalInfo = { total: number; kind: TotalKind; key: string };

// Identifies "the set of rows a total describes": the table plus its applied
// filters. Paging and sorting don't change it, so the total is reused across
// them instead of being recounted on every page.
function countKeyOf(schema: string, table: string, filters: { column: string; operator: string; value: string }[]) {
  return JSON.stringify([schema, table, filters.map(({ column, operator, value }) => ({ column, operator, value }))]);
}

export function DataBrowser({ connection, onOpenQuery, onOpenSql }: { connection: SavedConnection; onOpenQuery: (name: string) => void; onOpenSql: (title: string, sql: string) => void }) {
  const token = useAuthStore((s) => s.token);
  const showToast = useToastStore((s) => s.show);
  const schemaEntry = useSchemaStore((s) => s.byConnectionId[connection.id]);
  const loadSchema = useSchemaStore((s) => s.loadSchema);
  const memory = useDataViewStore((s) => s.byConnection[connection.id]);
  const remember = useDataViewStore((s) => s.remember);
  const toggleFavorite = useDataViewStore((s) => s.toggleFavorite);
  const savedViews = useSavedViewsStore((s) => s.byConnectionId[connection.id]);
  const loadViews = useSavedViewsStore((s) => s.loadViews);
  const createView = useSavedViewsStore((s) => s.createView);
  const renameView = useSavedViewsStore((s) => s.renameView);
  const removeView = useSavedViewsStore((s) => s.removeView);
  const tables = useMemo<SelectedTable[]>(() => (schemaEntry?.schema?.schemas ?? []).flatMap((group) => group.tables.map((table) => ({ schema: group.name, table }))), [schemaEntry]);
  const [tableKey, setTableKey] = useState(() => memory?.lastTable ?? "");
  // The table whose remembered view (filters, sort, columns...) is currently
  // applied to the state below. Lags tableKey by one render, so a table switch
  // never fetches with the previous table's filters.
  const [viewKey, setViewKey] = useState("");
  const [draftFilters, setDraftFilters] = useState<DataFilter[]>([]);
  const [appliedFilters, setAppliedFilters] = useState<DataFilter[]>([]);
  const [sorts, setSorts] = useState<DataSort[]>([]);
  const [page, setPage] = useState(0); const [pageSize, setPageSize] = useState(100);
  const [data, setData] = useState<TableDataPage | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const [fetching, setFetching] = useState(false);
  const [totalInfo, setTotalInfo] = useState<TotalInfo | null>(null); const [counting, setCounting] = useState(false);
  const [rowDialog, setRowDialog] = useState<RowDialog | null>(null); const [deleteRows, setDeleteRows] = useState<(string | null)[][] | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [columnOrder, setColumnOrder] = useState<string[]>([]); const [hidden, setHidden] = useState<Set<string>>(new Set()); const [widths, setWidths] = useState<Record<string, number>>({});
  const [columnsOpen, setColumnsOpen] = useState(false); const [schemaOpen, setSchemaOpen] = useState(false); const [importOpen, setImportOpen] = useState(false);
  // In-flight page load and exact count, kept so a newer request (or leaving
  // the view) can cancel them; requestSeq additionally lets a response that
  // still slips through after being superseded recognise itself as stale.
  const abortRef = useRef<AbortController | null>(null); const countAbortRef = useRef<AbortController | null>(null);
  const requestSeq = useRef(0); const totalInfoRef = useRef<TotalInfo | null>(null); const countKeyRef = useRef("");

  useEffect(() => { if (!schemaEntry) void loadSchema(connection.id); }, [connection.id, loadSchema, schemaEntry]);
  useEffect(() => { void loadViews(connection.id); }, [connection.id, loadViews]);
  useEffect(() => () => { abortRef.current?.abort(); countAbortRef.current?.abort(); }, []);
  const firstKey = tables[0] ? `${tables[0].schema}.${tables[0].table.name}` : "";
  const effectiveKey = tables.some((item) => `${item.schema}.${item.table.name}` === tableKey) ? tableKey : firstKey;
  const selected = tables.find((item) => `${item.schema}.${item.table.name}` === effectiveKey);
  const readOnly = "readOnly" in connection.fields ? connection.fields.readOnly : true;
  const columns = data?.columns ?? selected?.table.columns ?? [];
  const displayedColumns = (columnOrder.length ? columnOrder : columns.map((c) => c.name)).map((name) => columns.find((c) => c.name === name)).filter((c): c is ColumnInfo => !!c && !hidden.has(c.name));
  const hasPrimaryKey = columns.some((c) => c.isPrimaryKey); const isView = selected?.table.kind === "view"; const mutationDisabled = readOnly || isView;
  const currentCountKey = selected ? countKeyOf(selected.schema, selected.table.name, appliedFilters) : "";
  const shownTotal = totalInfo && totalInfo.key === currentCountKey ? totalInfo : null;

  function setTotal(info: TotalInfo | null) { totalInfoRef.current = info; setTotalInfo(info); }
  // Puts a (sanitized) view onto the controls. Column widths are only replaced
  // when given — applying a saved view leaves the user's widths alone.
  function applyConfig(config: DataViewConfig, nextWidths?: Record<string, number>) {
    const withIds = config.filters.map((f) => ({ ...f, id: crypto.randomUUID() }));
    setSorts(config.sorts); setDraftFilters(withIds); setAppliedFilters(withIds); setPageSize(config.pageSize);
    setColumnOrder(config.columnOrder); setHidden(new Set(config.hiddenColumns)); setPage(0);
    if (nextWidths) setWidths(nextWidths);
  }
  // Opening a table (or a whole new visit) restores what was last applied to it.
  if (selected && viewKey !== effectiveKey) {
    const remembered = memory?.tables[effectiveKey];
    setViewKey(effectiveKey); setData(null); setSelectedRows(new Set()); setError("");
    applyConfig(sanitizeViewConfig(remembered, selected.table.columns), Object.fromEntries(Object.entries(remembered?.widths ?? {}).filter(([name, w]) => typeof w === "number" && selected.table.columns.some((c) => c.name === name))));
  }

  const refresh = useCallback(async (recount = false) => {
    if (!token || !selected || viewKey !== effectiveKey) return;
    abortRef.current?.abort();
    const controller = new AbortController(); abortRef.current = controller;
    const seq = ++requestSeq.current;
    const filters = appliedFilters.map(({ column, operator, value }) => ({ column, operator, value }));
    const countKey = countKeyOf(selected.schema, selected.table.name, filters);
    // Only page/sort/size changed: the server needn't count again.
    const reuseCount = !recount && totalInfoRef.current?.key === countKey;
    setLoading(true); setFetching(true); setError("");
    try {
      const result = await browseTableData(token, connection.id, { schema: selected.schema, table: selected.table.name, page, pageSize, sorts, filters, countMode: reuseCount ? "skip" : "auto" }, controller.signal);
      if (seq !== requestSeq.current) return;
      if (result.totalKind !== "skipped") { totalInfoRef.current = { total: result.total, kind: result.totalKind, key: countKey }; setTotalInfo(totalInfoRef.current); }
      setData(result); setSelectedRows(new Set());
      setColumnOrder((current) => current.length ? current.filter((name) => result.columns.some((c) => c.name === name)).concat(result.columns.filter((c) => !current.includes(c.name)).map((c) => c.name)) : result.columns.map((c) => c.name));
    } catch (err) {
      // A cancelled or superseded request is not an error — a newer one is
      // already in flight, or the user asked to stop.
      if (controller.signal.aborted || seq !== requestSeq.current) return;
      setError(errorMessage(err, "Failed to load table data."));
    } finally { if (seq === requestSeq.current) { setLoading(false); setFetching(false); } }
  }, [appliedFilters, connection.id, effectiveKey, page, pageSize, selected, sorts, token, viewKey]);
  // Leaving a table (or switching connections) invalidates whatever was loading
  // for it: cancel it and retire its sequence number before the new load starts.
  useEffect(() => { abortRef.current?.abort(); requestSeq.current++; }, [effectiveKey]);
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { void refresh(); }, [refresh]);
  // A count belongs to one table + filter set; abandon it if that changes.
  useEffect(() => { countKeyRef.current = currentCountKey; countAbortRef.current?.abort(); }, [currentCountKey]);
  // Remember the applied view per table (debounced: column resizing fires this continuously).
  useEffect(() => {
    if (!selected || viewKey !== effectiveKey) return;
    const handle = setTimeout(() => remember(connection.id, effectiveKey, { filters: appliedFilters.map(({ column, operator, value }) => ({ column, operator, value })), sorts, pageSize, columnOrder, hiddenColumns: [...hidden], widths }), 400);
    return () => clearTimeout(handle);
  }, [appliedFilters, columnOrder, connection.id, effectiveKey, hidden, pageSize, remember, selected, sorts, viewKey, widths]);

  function chooseTable(value: string) { setTableKey(value); }
  function cancelLoad() { abortRef.current?.abort(); setLoading(false); setFetching(false); setError("Loading cancelled. The grid may not match the current filters, sort, or page — refresh to reload."); }
  async function countExactly() {
    if (!token || !selected) return;
    if (counting) { countAbortRef.current?.abort(); return; }
    const controller = new AbortController(); countAbortRef.current = controller;
    const key = currentCountKey;
    setCounting(true); setError("");
    try {
      const result = await countTableData(token, connection.id, { schema: selected.schema, table: selected.table.name, filters: appliedFilters.map(({ column, operator, value }) => ({ column, operator, value })) }, controller.signal);
      if (!controller.signal.aborted && countKeyRef.current === key) setTotal({ total: result.total, kind: "exact", key });
    } catch (err) { if (!controller.signal.aborted) setError(errorMessage(err, "Could not count rows.")); } finally { if (countAbortRef.current === controller) setCounting(false); }
  }
  function currentConfig(): DataViewConfig { return { filters: appliedFilters.map(({ column, operator, value }) => ({ column, operator, value })), sorts, pageSize, columnOrder: columnOrder.length ? columnOrder : columns.map((c) => c.name), hiddenColumns: [...hidden] }; }
  function rowKey(row: (string | null)[]) { return Object.fromEntries(columns.flatMap((c, i) => c.isPrimaryKey ? [[c.name, row[i]]] : [])); }
  function rowId(row: (string | null)[]) { return JSON.stringify(rowKey(row)); }
  function selectedData() { return (data?.rows ?? []).filter((row) => selectedRows.has(rowId(row))); }
  function toggleRow(row: (string | null)[]) { const id = rowId(row); setSelectedRows((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function toggleSort(column: string) { setPage(0); setSorts((current) => current[0]?.column !== column ? [{ column, direction: "asc" }] : current[0].direction === "asc" ? [{ column, direction: "desc" }] : []); }
  function resize(name: string, event: PointerEvent) { event.preventDefault(); const x = event.clientX; const width = widths[name] ?? 180; const move = (e: globalThis.PointerEvent) => setWidths((current) => ({ ...current, [name]: Math.max(90, width + e.clientX - x) })); const done = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", done); }; window.addEventListener("pointermove", move); window.addEventListener("pointerup", done); }
  function exportData(format: "csv" | "json") { const source = selectedRows.size ? selectedData() : (data?.rows ?? []); const result = { columns: displayedColumns, rows: source.map((row) => displayedColumns.map((c) => row[columns.findIndex((item) => item.name === c.name)])), rowCount: source.length, truncated: false, durationMs: 0, command: "" }; const filename = `${selected?.table.name ?? "data"}-${selectedRows.size ? "selected" : `page-${page + 1}`}`; if (format === "csv") downloadCsv(result, `${filename}.csv`); else downloadJson(result, `${filename}.json`); }
  async function removeRows() {
    if (!token || !selected || !deleteRows) return;
    setLoading(true); setError("");
    const removed = deleteRows;
    try {
      const keys = removed.map(rowKey);
      if (keys.length === 1) await deleteTableRow(token, connection.id, { schema: selected.schema, table: selected.table.name, key: keys[0] });
      else await bulkDeleteTableRows(token, connection.id, { schema: selected.schema, table: selected.table.name, keys });
      setDeleteRows(null);
      await refresh(true);
      if (hasPrimaryKey) {
        showToast(removed.length === 1 ? "Row deleted." : `${removed.length} rows deleted.`, {
          label: "Undo",
          onAction: async () => {
            for (const row of removed) await insertTableRow(token, connection.id, { schema: selected.schema, table: selected.table.name, values: nonGeneratedValues(columns, row) });
            await refresh(true);
          },
        });
      }
    } catch (err) { setError(errorMessage(err, "Failed to delete rows.")); setLoading(false); }
  }

  if (schemaEntry?.status === "loading") return <div className="flex flex-1 items-center justify-center gap-2 text-[12px] text-text-faint"><Loader2 size={13} className="animate-spin" /> Loading tables…</div>;
  if (!selected) return <div className="flex flex-1 items-center justify-center text-[12px] text-text-faint">No tables or views found.</div>;
  // A page count is only meaningful when the total is exact or a decent estimate;
  // otherwise Next/Previous are driven by hasMore, which the server always knows.
  const totalPages = shownTotal && (shownTotal.kind === "exact" || shownTotal.kind === "estimated") ? Math.max(1, Math.ceil(shownTotal.total / pageSize)) : null;
  const shownPage = data?.page ?? page; const shownPageSize = data?.pageSize ?? pageSize;
  const tableViews = (savedViews ?? []).filter((view) => `${view.schema}.${view.table}` === effectiveKey);

  return <div className="flex min-h-0 flex-1 flex-col bg-bg-app">
    <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-border-default bg-bg-surface px-3.5 py-2">
      <TablePicker tables={tables.map((item) => ({ key: `${item.schema}.${item.table.name}`, kind: item.table.kind }))} value={effectiveKey} recent={memory?.recent ?? []} favorites={memory?.favorites ?? []} onSelect={chooseTable} onToggleFavorite={(key) => toggleFavorite(connection.id, key)} /><Button size="sm" variant="ghost" onClick={() => onOpenQuery(effectiveKey)}>Open in query</Button>
      <div className="ml-auto flex items-center gap-2">{selectedRows.size > 0 && <><span className="text-[11px] text-text-faint">{selectedRows.size} selected</span><Button size="sm" variant="danger" onClick={() => setDeleteRows(selectedData())} disabled={mutationDisabled || !hasPrimaryKey}><Trash2 size={11} /> Delete</Button></>}<Button size="sm" variant="secondary" onClick={() => setSchemaOpen(true)} disabled={readOnly}><TableProperties size={12} /> Schema</Button><Button size="sm" variant="secondary" onClick={() => setColumnsOpen(true)}><Columns3 size={12} /> Columns</Button><ViewsMenu views={tableViews} onApply={(view) => { applyConfig(sanitizeViewConfig(view.config, columns)); showToast(`Applied view “${view.name}”.`); }} onSave={async (name) => { await createView(connection.id, selected.schema, selected.table.name, name, currentConfig()); showToast(`Saved view “${name}”.`); }} onRename={async (view, name) => { await renameView(connection.id, view.id, name); showToast(`Renamed view to “${name}”.`); }} onDelete={async (view) => { try { await removeView(connection.id, view.id); } catch (err) { setError(errorMessage(err, "Could not delete the view.")); } }} /><Button size="sm" variant="secondary" onClick={() => columns[0] && setDraftFilters((current) => [...current, { id: crypto.randomUUID(), column: columns[0].name, operator: "eq", value: "" }])}><Filter size={12} /> Filter{draftFilters.length ? ` · ${draftFilters.length}` : ""}</Button><Button size="sm" variant="secondary" onClick={() => exportData("csv")} disabled={!data?.rows.length}><Download size={12} /> CSV</Button><Button size="sm" variant="secondary" onClick={() => setImportOpen(true)} disabled={mutationDisabled}><Upload size={12} /> Import</Button><Button size="sm" variant="secondary" onClick={() => fetching ? cancelLoad() : void refresh(true)} title={fetching ? "Cancel loading" : "Refresh"} aria-label={fetching ? "Cancel loading" : "Refresh"}>{fetching ? <X size={12} /> : <RefreshCw size={12} />}</Button><Button size="sm" variant="primary" onClick={() => setRowDialog({ mode: "add" })} disabled={mutationDisabled}><Plus size={12} /> Add row</Button></div>
    </div>
    {draftFilters.length > 0 && <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-default bg-bg-inset px-3.5 py-2"><span className="mr-1 text-[11px] font-medium uppercase tracking-[0.08em] text-text-ghost">Where</span>{draftFilters.map((filter) => { const noValue = filter.operator === "is-null" || filter.operator === "not-null"; const update = (patch: Partial<DataFilter>) => setDraftFilters((current) => current.map((item) => item.id === filter.id ? { ...item, ...patch } : item)); return <div key={filter.id} className="flex items-center overflow-hidden rounded-[7px] border border-border-input bg-bg-surface"><Select value={filter.column} onChange={(column) => update({ column })} options={columns.map((c) => ({ value: c.name, label: c.name }))} className="h-7 min-w-[120px] rounded-none border-0 font-mono" /><Select value={filter.operator} onChange={(operator) => update({ operator: operator as DataFilterOperator })} options={OPERATORS} className="h-7 min-w-[112px] rounded-none border-y-0 border-r-0" />{!noValue && <input value={filter.value} onChange={(e) => update({ value: e.target.value })} placeholder="value" className="h-7 w-[130px] border-l border-border-input bg-transparent px-2.5 font-mono text-[11.5px] text-text-primary outline-none" />}<button onClick={() => setDraftFilters((current) => current.filter((item) => item.id !== filter.id))} className="flex h-7 w-7 items-center justify-center border-l border-border-input text-text-faint hover:bg-bg-hover"><X size={11} /></button></div>; })}<Button size="sm" variant="primary" onClick={() => { setPage(0); setAppliedFilters(draftFilters); }}>Apply</Button><Button size="sm" variant="ghost" onClick={() => { setDraftFilters([]); setAppliedFilters([]); setPage(0); }}>Clear</Button></div>}
    {error && <div className="shrink-0 border-b border-error-border bg-error-bg px-3.5 py-2 text-[11.5px] text-error-text">{error}</div>}
    {(isView || (!hasPrimaryKey && !readOnly)) && <div className="shrink-0 border-b border-border-default bg-bg-inset px-3.5 py-2 text-[11.5px] text-text-faint">{isView ? "Views can be browsed and exported, but are read-only here." : "This table has no primary key. Adding is available, but editing and deleting existing rows is disabled."}</div>}
    <div className="min-h-0 flex-1 overflow-auto"><table className="border-collapse font-mono text-[11.5px]" style={{ tableLayout: "fixed", minWidth: "100%" }}><thead className="sticky top-0 z-10 bg-bg-inset text-left text-[11px] text-text-muted"><tr><th className="w-10 border-b border-r border-border-default px-2 py-2"><input type="checkbox" aria-label="Select page" disabled={!hasPrimaryKey} checked={!!data?.rows.length && selectedRows.size === data.rows.length} onChange={(e) => setSelectedRows(e.target.checked ? new Set((data?.rows ?? []).map(rowId)) : new Set())} /></th><th className="w-12 border-b border-r border-border-default px-3 py-2 text-text-ghost">#</th>{displayedColumns.map((column) => { const sort = sorts[0]?.column === column.name ? sorts[0] : null; return <th key={column.name} style={{ width: widths[column.name] ?? 180 }} className="relative border-b border-r border-border-default px-3 py-2 font-medium"><button className="flex w-full items-center gap-1.5 text-left" onClick={() => toggleSort(column.name)}><span className="truncate">{column.name}</span><span className="truncate text-text-ghost">{column.type}</span>{column.isPrimaryKey && <span className="text-[9px]">PK</span>}{column.references && <span className="text-[9px]">FK</span>}{sort ? sort.direction === "asc" ? <ArrowUp size={10} /> : <ArrowDown size={10} /> : <ArrowUpDown size={10} className="opacity-30" />}</button><span onPointerDown={(e) => resize(column.name, e)} className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-border-focus" /></th>; })}<th className="sticky right-0 w-16 border-b border-border-default bg-bg-inset" /></tr></thead><tbody className={cn("text-text-secondary transition-opacity", loading && "opacity-45")}>{data?.rows.map((row, rowIndex) => <tr key={hasPrimaryKey ? rowId(row) : `${shownPage}-${rowIndex}`} className={cn("group hover:bg-bg-hover/50", selectedRows.has(rowId(row)) && "bg-bg-active")}><td className="border-b border-r border-border-faint px-2 py-2 text-center"><input type="checkbox" disabled={!hasPrimaryKey} checked={selectedRows.has(rowId(row))} onChange={() => toggleRow(row)} /></td><td className="border-b border-r border-border-faint px-3 py-2 text-text-disabled">{shownPage * shownPageSize + rowIndex + 1}</td>{displayedColumns.map((column) => { const value = row[columns.findIndex((c) => c.name === column.name)]; return <td key={column.name} tabIndex={0} style={{ width: widths[column.name] ?? 180 }} className={cn("truncate border-b border-r border-border-faint px-3 py-2 outline-none focus:ring-1 focus:ring-inset focus:ring-border-focus", value === null && "italic text-text-ghost")} title={value ?? "null"} onDoubleClick={() => !mutationDisabled && hasPrimaryKey && setRowDialog({ mode: "edit", row })} onKeyDown={(e) => e.key === "Enter" && !mutationDisabled && hasPrimaryKey && setRowDialog({ mode: "edit", row })}>{value ?? "null"}</td>; })}<td className="sticky right-0 border-b border-border-faint bg-bg-app px-1.5 py-1 group-hover:bg-bg-hover"><div className="flex opacity-0 group-hover:opacity-100"><button onClick={() => setRowDialog({ mode: "edit", row })} disabled={mutationDisabled || !hasPrimaryKey} className="flex h-6 w-7 items-center justify-center rounded text-text-faint hover:bg-bg-active disabled:hidden"><Pencil size={11} /></button><button onClick={() => setDeleteRows([row])} disabled={mutationDisabled || !hasPrimaryKey} className="flex h-6 w-7 items-center justify-center rounded text-text-faint hover:bg-error-bg hover:text-error-text disabled:hidden"><Trash2 size={11} /></button></div></td></tr>)}</tbody></table>{!loading && data?.rows.length === 0 && <div className="flex h-40 items-center justify-center text-[12px] text-text-quiet">No rows match this view.</div>}</div>
    <div className="flex h-10 shrink-0 items-center gap-3 border-t border-border-default bg-bg-inset px-3.5 text-[11.5px] text-text-faint"><RowTotal info={shownTotal} counting={counting} onCount={() => void countExactly()} />{(readOnly || isView) && <span className="rounded-[5px] border border-border-input px-2 py-0.5 text-[10px] uppercase tracking-wide">Read only</span>}<button onClick={() => exportData("json")} disabled={!data?.rows.length}>Export JSON</button><div className="ml-auto flex items-center gap-2"><span>Rows per page</span><Select value={String(pageSize)} onChange={(value) => { setPageSize(Number(value)); setPage(0); }} options={PAGE_SIZES.map((value) => ({ value: String(value), label: String(value) }))} className="h-6" /><button onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={page === 0 || loading}><ChevronLeft size={13} /></button><span className="min-w-[72px] text-center text-text-secondary">{totalPages ? `${page + 1} of ${shownTotal?.kind === "estimated" ? "~" : ""}${totalPages.toLocaleString()}` : `Page ${page + 1}`}</span><button onClick={() => setPage((value) => value + 1)} disabled={!data?.hasMore || loading}><ChevronRight size={13} /></button></div></div>
    {rowDialog && <RowEditor mode={rowDialog.mode} row={rowDialog.mode === "edit" ? rowDialog.row : undefined} columns={columns} onClose={() => setRowDialog(null)} onSave={async (values) => {
      if (!token) return;
      const input = { schema: selected.schema, table: selected.table.name, values };
      if (rowDialog.mode === "add") {
        const result = await insertTableRow(token, connection.id, input);
        setRowDialog(null);
        await refresh(true);
        const key = insertedKey(columns, result);
        if (key) showToast("Row added.", { label: "Undo", onAction: async () => { await deleteTableRow(token, connection.id, { schema: selected.schema, table: selected.table.name, key }); await refresh(true); } });
      } else {
        const oldRow = rowDialog.row;
        const oldKey = rowKey(oldRow);
        const restoreValues = nonGeneratedValues(columns, oldRow);
        const newKey = { ...oldKey, ...Object.fromEntries(columns.filter((c) => c.isPrimaryKey && values[c.name] !== undefined).map((c) => [c.name, values[c.name]])) };
        await updateTableRow(token, connection.id, { ...input, key: oldKey });
        setRowDialog(null);
        await refresh(true);
        showToast("Row updated.", { label: "Undo", onAction: async () => { await updateTableRow(token, connection.id, { schema: selected.schema, table: selected.table.name, values: restoreValues, key: newKey }); await refresh(true); } });
      }
    }} />}
    {deleteRows && <Confirm title={`Delete ${deleteRows.length === 1 ? "this row" : `${deleteRows.length} rows`}?`} body="This permanently removes the selected data. This action cannot be undone." confirm="Delete" loading={loading} onCancel={() => setDeleteRows(null)} onConfirm={() => void removeRows()} />}
    {columnsOpen && <ColumnsDialog columns={columns} order={columnOrder} hidden={hidden} onClose={() => setColumnsOpen(false)} onApply={(order, nextHidden) => { setColumnOrder(order); setHidden(nextHidden); setColumnsOpen(false); }} />}
    {schemaOpen && <SchemaDialog selected={selected} tables={tables} connection={connection} onClose={() => setSchemaOpen(false)} onOpenSql={onOpenSql} onApplied={async () => { await loadSchema(connection.id); await refresh(true); }} />}
    {importOpen && <ImportDialog connectionId={connection.id} schema={selected.schema} table={selected.table.name} columns={columns} onClose={() => setImportOpen(false)} onImported={(rows) => { setImportOpen(false); showToast(`Imported ${rows.toLocaleString()} row${rows === 1 ? "" : "s"} into ${selected.schema}.${selected.table.name}.`); void refresh(true); }} />}
  </div>;
}

// The row total in the footer, honest about how it was obtained: an estimate
// or lower bound says so and offers an exact count, which the user can cancel.
function RowTotal({ info, counting, onCount }: { info: TotalInfo | null; counting: boolean; onCount: () => void }) {
  if (!info) return <span><span className="text-text-secondary">—</span> rows</span>;
  const number = info.total.toLocaleString();
  const label = info.kind === "exact" ? number : info.kind === "estimated" ? `~${number}` : info.kind === "lower-bound" ? `${number}+` : "?";
  const hint = info.kind === "estimated" ? "Estimated from table statistics; may be out of date." : info.kind === "lower-bound" ? "At least this many rows; counting stopped early." : info.kind === "unknown" ? "Counting took too long." : undefined;
  return <span className="flex items-center gap-2"><span title={hint}><span className="text-text-secondary">{label}</span> rows</span>{info.kind !== "exact" && <button onClick={onCount} className="flex items-center gap-1 rounded-[5px] border border-border-input px-1.5 py-0.5 text-[10.5px] hover:bg-bg-hover" title={counting ? "Cancel counting" : "Count every matching row (can be slow on large tables)"}>{counting ? <><Loader2 size={10} className="animate-spin" /> Counting… (cancel)</> : "Count exactly"}</button>}</span>;
}

function RowEditor({ mode, row, columns, onClose, onSave }: { mode: "add" | "edit"; row?: (string | null)[]; columns: ColumnInfo[]; onClose: () => void; onSave: (values: Record<string, string | null>) => Promise<void> }) {
  type ValueMode = "default" | "value" | "null";
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(columns.map((c, i) => [c.name, row?.[i] ?? ""]))); const [modes, setModes] = useState<Record<string, ValueMode>>(() => Object.fromEntries(columns.map((c, i) => [c.name, mode === "add" ? "default" : row?.[i] === null ? "null" : "value"]))); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  async function save() { setSaving(true); setError(""); try { const payload: Record<string, string | null> = {}; columns.forEach((c) => { if (modes[c.name] === "value") payload[c.name] = values[c.name]; if (modes[c.name] === "null") payload[c.name] = null; }); await onSave(payload); } catch (err) { setError(errorMessage(err, "Could not save the row.")); setSaving(false); } }
  return <Modal title={mode === "add" ? "Add row" : "Edit row"} onClose={onClose} locked={saving}><div className="max-h-[60vh] space-y-3 overflow-y-auto p-5">{columns.map((column) => { const generated = column.isGenerated || column.isIdentity; const valueMode = generated ? "default" : modes[column.name]; const options = [...(mode === "add" ? [{ value: "default", label: "Default" }] : []), { value: "value", label: "Value" }, ...(column.nullable ? [{ value: "null", label: "NULL" }] : [])]; return <div key={column.name} className="grid grid-cols-[145px_92px_1fr] items-center gap-3"><div className="min-w-0 font-mono text-[11.5px] text-text-secondary"><div className="truncate">{column.name}{column.isPrimaryKey && <small className="ml-1">PK</small>}{column.references && <small className="ml-1">FK</small>}</div><div className="truncate text-[10px] text-text-ghost">{column.type}{column.nullable ? " · nullable" : ""}</div></div><Select value={valueMode} onChange={(value) => setModes((current) => ({ ...current, [column.name]: value as ValueMode }))} options={options} className="w-full" />{valueMode === "value" ? <TypedInput column={column} value={values[column.name]} onChange={(value) => setValues((current) => ({ ...current, [column.name]: value }))} /> : <div className="flex h-[34px] items-center rounded-[7px] border border-border-input bg-bg-inset px-3 font-mono text-[11px] text-text-ghost">{generated ? "Generated by database" : valueMode === "null" ? "NULL" : column.defaultValue ?? "Database default"}</div>}</div>; })}{error && <div className="text-[11.5px] text-error-text">{error}</div>}</div><Actions><Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button><Button variant="primary" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : mode === "add" ? "Add row" : "Save changes"}</Button></Actions></Modal>;
}

function TypedInput({ column, value, onChange }: { column: ColumnInfo; value: string; onChange: (value: string) => void }) {
  if (column.enumValues?.length) return <Select value={value || column.enumValues[0]} onChange={onChange} options={column.enumValues.map((v) => ({ value: v, label: v }))} className="h-[34px] w-full" />;
  if (column.type === "boolean") return <Select value={value || "false"} onChange={onChange} options={[{ value: "true", label: "true" }, { value: "false", label: "false" }]} className="h-[34px] w-full" />;
  if (column.type === "json" || column.type === "jsonb") return <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder="{}" className="min-h-[56px] rounded-[7px] border border-border-input bg-bg-inset px-3 py-2 font-mono text-[12px] text-text-primary outline-none" />;
  const inputType = column.type === "date" ? "date" : column.type.includes("timestamp") ? "datetime-local" : ["integer", "bigint", "smallint", "numeric", "real", "double precision"].includes(column.type) ? "number" : "text";
  return <Input type={inputType} step={inputType === "number" ? "any" : undefined} value={inputType === "datetime-local" ? value.replace(" ", "T").slice(0, 16) : value} onChange={(e) => onChange(e.target.value)} placeholder={column.references ? `${column.references.schema}.${column.references.table}.${column.references.column}` : ""} />;
}

function ColumnsDialog({ columns, order, hidden, onClose, onApply }: { columns: ColumnInfo[]; order: string[]; hidden: Set<string>; onClose: () => void; onApply: (order: string[], hidden: Set<string>) => void }) { const [draftOrder, setDraftOrder] = useState(order.length ? order : columns.map((c) => c.name)); const [draftHidden, setDraftHidden] = useState(new Set(hidden)); const move = (index: number, delta: number) => setDraftOrder((current) => { const next = [...current]; const target = index + delta; if (target < 0 || target >= next.length) return current; [next[index], next[target]] = [next[target], next[index]]; return next; }); return <Modal title="Columns" onClose={onClose}><div className="max-h-[55vh] space-y-1 overflow-y-auto p-4">{draftOrder.map((name, index) => <div key={name} className="flex h-9 items-center rounded-[6px] px-2 hover:bg-bg-hover"><input type="checkbox" checked={!draftHidden.has(name)} onChange={(e) => setDraftHidden((current) => { const next = new Set(current); if (e.target.checked) next.delete(name); else next.add(name); return next; })} /><span className="ml-3 flex-1 font-mono text-[12px] text-text-secondary">{name}</span><button onClick={() => move(index, -1)} disabled={index === 0} className="p-1 text-text-faint disabled:opacity-20"><ArrowUp size={12} /></button><button onClick={() => move(index, 1)} disabled={index === draftOrder.length - 1} className="p-1 text-text-faint disabled:opacity-20"><ArrowDown size={12} /></button></div>)}</div><Actions><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => onApply(draftOrder, draftHidden)}>Apply</Button></Actions></Modal>; }

type SchemaAction = "create-table" | "add-column" | "create-index" | "add-relationship";
function SchemaDialog({ selected, tables, connection, onClose, onOpenSql, onApplied }: { selected: SelectedTable; tables: SelectedTable[]; connection: SavedConnection; onClose: () => void; onOpenSql: (title: string, sql: string) => void; onApplied: () => Promise<void> }) {
  const token = useAuthStore((s) => s.token); const [action, setAction] = useState<SchemaAction>("add-column"); const [name, setName] = useState(""); const [type, setType] = useState("text"); const [nullable, setNullable] = useState(true); const [primary, setPrimary] = useState(false); const [unique, setUnique] = useState(false); const [defaultValue, setDefaultValue] = useState(""); const [columnNames, setColumnNames] = useState(""); const [localColumn, setLocalColumn] = useState(selected.table.columns[0]?.name ?? ""); const tableOptions = tables.filter((t) => t.table.kind === "table"); const [targetKey, setTargetKey] = useState(tableOptions[0] ? `${tableOptions[0].schema}.${tableOptions[0].table.name}` : ""); const target = tables.find((t) => `${t.schema}.${t.table.name}` === targetKey); const [targetColumn, setTargetColumn] = useState(target?.table.columns[0]?.name ?? ""); const [onDelete, setOnDelete] = useState("NO ACTION"); const [running, setRunning] = useState(false); const [error, setError] = useState(""); const [confirm, setConfirm] = useState(false);
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { if (target && !target.table.columns.some((c) => c.name === targetColumn)) setTargetColumn(target.table.columns[0]?.name ?? ""); }, [target, targetColumn]);
  const q = (value: string) => `"${value.replaceAll('"', '""')}"`; const qualified = `${q(selected.schema)}.${q(selected.table.name)}`;
  const sql = useMemo(() => { const n = name.trim(); if (!n) return ""; if (action === "create-table") return `CREATE TABLE ${q(selected.schema)}.${q(n)} (\n  ${q(columnNames.trim() || "id")} ${type}${primary ? " PRIMARY KEY" : ""}${nullable && !primary ? "" : " NOT NULL"}${defaultValue ? ` DEFAULT ${defaultValue}` : ""}\n);`; if (action === "add-column") return `ALTER TABLE ${qualified}\nADD COLUMN ${q(n)} ${type}${nullable ? "" : " NOT NULL"}${defaultValue ? ` DEFAULT ${defaultValue}` : ""};`; if (action === "create-index") { const cols = columnNames.split(",").map((c) => c.trim()).filter(Boolean).map(q).join(", "); return cols ? `CREATE ${unique ? "UNIQUE " : ""}INDEX ${q(n)}\nON ${qualified} (${cols});` : ""; } if (!target || !localColumn || !targetColumn) return ""; return `ALTER TABLE ${qualified}\nADD CONSTRAINT ${q(n)} FOREIGN KEY (${q(localColumn)})\nREFERENCES ${q(target.schema)}.${q(target.table.name)} (${q(targetColumn)}) ON DELETE ${onDelete};`; }, [action, columnNames, defaultValue, localColumn, name, nullable, onDelete, primary, qualified, selected.schema, target, targetColumn, type, unique]);
  async function run() { if (!token || !sql) return; setRunning(true); setError(""); try { await executeSchemaChange(token, connection.id, sql); await onApplied(); onClose(); } catch (err) { setError(errorMessage(err, "Schema change failed.")); setConfirm(false); setRunning(false); } }
  return <Modal title="Schema tools" onClose={onClose} locked={running}><div className="border-b border-border-default px-5 py-3"><Select value={action} onChange={(value) => { setAction(value as SchemaAction); setName(""); }} options={[{ value: "create-table", label: "Create table" }, { value: "add-column", label: "Add column" }, { value: "create-index", label: "Create index" }, { value: "add-relationship", label: "Add relationship" }]} className="w-full" /></div><div className="grid max-h-[64vh] grid-cols-2 overflow-y-auto"><div className="space-y-3 border-r border-border-default p-5"><Field label={action === "create-table" ? "Table name" : action === "create-index" ? "Index name" : action === "add-relationship" ? "Constraint name" : "Column name"}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>{(action === "create-table" || action === "add-column") && <><Field label={action === "create-table" ? "First column and type" : "Type"}>{action === "create-table" && <Input value={columnNames} onChange={(e) => setColumnNames(e.target.value)} placeholder="id" className="mb-2 w-full" />}<Select value={type} onChange={setType} options={SQL_TYPES.map((value) => ({ value, label: value }))} className="w-full" /></Field><Check label="Nullable" checked={nullable} onChange={setNullable} />{action === "create-table" && <Check label="Primary key" checked={primary} onChange={setPrimary} />}<Field label="Default expression"><Input value={defaultValue} onChange={(e) => setDefaultValue(e.target.value)} placeholder="Optional, e.g. now()" /></Field></>}{action === "create-index" && <><Field label="Columns"><Input value={columnNames} onChange={(e) => setColumnNames(e.target.value)} placeholder="email, created_at" /></Field><Check label="Unique index" checked={unique} onChange={setUnique} /></>}{action === "add-relationship" && <><Field label="Local column"><Select value={localColumn} onChange={setLocalColumn} options={selected.table.columns.map((c) => ({ value: c.name, label: c.name }))} className="w-full" /></Field><Field label="Referenced table"><Select value={targetKey} onChange={setTargetKey} options={tableOptions.map((t) => ({ value: `${t.schema}.${t.table.name}`, label: `${t.schema}.${t.table.name}` }))} className="w-full" /></Field><Field label="Referenced column"><Select value={targetColumn} onChange={setTargetColumn} options={(target?.table.columns ?? []).map((c) => ({ value: c.name, label: c.name }))} className="w-full" /></Field><Field label="On delete"><Select value={onDelete} onChange={setOnDelete} options={["NO ACTION", "CASCADE", "SET NULL", "RESTRICT"].map((value) => ({ value, label: value }))} className="w-full" /></Field></>}</div><div className="p-5"><div className="mb-2 text-[10.5px] font-medium uppercase tracking-[0.08em] text-text-ghost">SQL preview</div><pre className="min-h-40 whitespace-pre-wrap rounded-[7px] border border-border-input bg-bg-inset p-3 font-mono text-[11px] leading-5 text-text-secondary">{sql || "Complete the form to preview the generated SQL."}</pre><p className="mt-3 text-[11px] leading-4 text-text-faint">Only this displayed statement will run. Destructive DROP operations remain in the query editor.</p>{error && <div className="mt-3 text-[11.5px] text-error-text">{error}</div>}</div></div><Actions><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="secondary" disabled={!sql} onClick={() => { onOpenSql(`schema: ${name}`, `${sql}\n`); onClose(); }}>Open in query</Button><Button variant="primary" disabled={!sql || running} onClick={() => setConfirm(true)}>Review & run</Button></Actions>{confirm && <Confirm title="Run this schema change?" body="The exact SQL shown in the preview will be executed against the connected database." confirm="Run change" loading={running} onCancel={() => setConfirm(false)} onConfirm={() => void run()} />}</Modal>;
}

// Excludes generated/identity columns from a row's values before it's used
// to reinsert that row for Undo — the database must assign those itself
// (a plain INSERT can't supply an explicit value for a GENERATED ALWAYS AS
// IDENTITY column). A row whose primary key was itself database-generated
// therefore comes back with its content intact but a new key — undoing a
// delete restores the row, not necessarily its exact old identity.
function nonGeneratedValues(columns: ColumnInfo[], row: (string | null)[]): Record<string, string | null> {
  const values: Record<string, string | null> = {};
  columns.forEach((c, i) => { if (!c.isGenerated && !c.isIdentity) values[c.name] = row[i]; });
  return values;
}

// Rebuilds the primary key of a just-inserted row from InsertTableRow's
// RETURNING-backed response, so Undo can delete the exact row even when its
// key was assigned by the database (e.g. an identity column left on
// "Default"). Returns null when the table has no primary key at all, or the
// backend didn't return row data to key off of.
function insertedKey(columns: ColumnInfo[], result: InsertRowResult): Record<string, string | null> | null {
  if (!result.row || !result.columns) return null;
  const key: Record<string, string | null> = {};
  for (const c of columns) {
    if (!c.isPrimaryKey) continue;
    const i = result.columns.indexOf(c.name);
    key[c.name] = i >= 0 ? result.row[i] : null;
  }
  return Object.keys(key).length ? key : null;
}
