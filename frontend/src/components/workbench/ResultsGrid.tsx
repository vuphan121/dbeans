import { useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { QueryResult } from "@/lib/types";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/utils";

const PAGE_SIZE_OPTIONS = [50, 100, 500, 1000];
const INDEX_COL_WIDTH = 52;
const MIN_COL_WIDTH = 140;

export function ResultsGrid({ result }: { result?: QueryResult }) {
  const [pageSize, setPageSize] = useState(100);
  const [page, setPage] = useState(0);
  const parentRef = useRef<HTMLDivElement>(null);

  const rows = result?.rows ?? [];
  const columns = result?.columns ?? [];

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
                  {row.map((cell, i) => (
                    <div
                      key={i}
                      className={cn(
                        "truncate border-l border-border-faint px-2.5",
                        cell === null && "italic text-text-ghost",
                      )}
                    >
                      {cell === null ? "null" : cell}
                    </div>
                  ))}
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
    </div>
  );
}
