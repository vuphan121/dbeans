import { useMemo, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { UserRow } from "@/mock/sqlFixtures";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/utils";
import { comboLabel } from "@/lib/platform";

const COLUMNS = "52px 240px 110px 96px 170px 120px 1fr";
const PAGE_SIZE_OPTIONS = [50, 100, 500, 1000];

interface PendingEdit {
  rowIndex: number;
  field: keyof UserRow;
  value: string;
}

export function ResultsGrid({ rows: initialRows }: { rows: UserRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [editing, setEditing] = useState<{ rowIndex: number; field: keyof UserRow } | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<PendingEdit | null>(null);
  const [pageSize, setPageSize] = useState(100);
  const [page, setPage] = useState(0);
  const parentRef = useRef<HTMLDivElement>(null);

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

  const editableFields: (keyof UserRow)[] = useMemo(() => ["plan", "status"], []);

  function startEdit(rowIndex: number, field: keyof UserRow) {
    if (!editableFields.includes(field)) return;
    setEditing({ rowIndex, field });
    setDraft(rows[rowIndex][field]);
  }

  function commitEdit() {
    if (!editing) return;
    const original = rows[editing.rowIndex][editing.field];
    if (draft !== original) {
      setPending({ rowIndex: editing.rowIndex, field: editing.field, value: draft });
    }
    setEditing(null);
  }

  function savePending() {
    if (!pending) return;
    setRows((r) =>
      r.map((row, i) => (i === pending.rowIndex ? { ...row, [pending.field]: pending.value } : row)),
    );
    setPending(null);
  }

  function discardPending() {
    setPending(null);
  }

  function goToPage(next: number) {
    setPage(Math.min(totalPages - 1, Math.max(0, next)));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg-app">
      <div
        style={{ gridTemplateColumns: COLUMNS }}
        className="grid h-[30px] shrink-0 items-center border-b border-border-default bg-bg-inset font-mono text-[11px] font-medium text-text-muted"
      >
        <div className="px-2.5 text-text-ghost">#</div>
        <div className="border-l border-border-default px-2.5">email</div>
        <div className="border-l border-border-default px-2.5">plan</div>
        <div className="border-l border-border-default px-2.5 text-right">mrr</div>
        <div className="border-l border-border-default px-2.5">created_at</div>
        <div className="border-l border-border-default px-2.5">status</div>
        <div className="border-l border-border-default" />
      </div>

      <div ref={parentRef} className="flex-1 overflow-y-auto">
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((vRow) => {
            const globalIndex = pageStart + vRow.index;
            const row = pageRows[vRow.index];
            const isEditedRow = pending?.rowIndex === globalIndex;
            return (
              <div
                key={vRow.key}
                style={{
                  gridTemplateColumns: COLUMNS,
                  transform: `translateY(${vRow.start}px)`,
                }}
                className={cn(
                  "absolute left-0 top-0 grid h-[30px] w-full items-center border-b border-border-faint font-mono text-[11.5px] text-text-secondary",
                  isEditedRow && "bg-bg-inset text-text-primary",
                )}
              >
                <div className="px-2.5 text-text-disabled">{row.n}</div>
                <Cell>{row.email}</Cell>
                <EditableCell
                  editing={editing?.rowIndex === globalIndex && editing.field === "plan"}
                  draft={draft}
                  onDraftChange={setDraft}
                  onStart={() => startEdit(globalIndex, "plan")}
                  onCommit={commitEdit}
                >
                  {row.plan}
                </EditableCell>
                <Cell align="right">{row.mrr}</Cell>
                <Cell muted>{row.created}</Cell>
                <EditableCell
                  editing={editing?.rowIndex === globalIndex && editing.field === "status"}
                  draft={draft}
                  onDraftChange={setDraft}
                  onStart={() => startEdit(globalIndex, "status")}
                  onCommit={commitEdit}
                  muted
                >
                  {row.status}
                </EditableCell>
                <div className="border-l border-border-faint" />
              </div>
            );
          })}
        </div>
      </div>

      {pending && (
        <div className="flex h-10 shrink-0 items-center gap-2.5 border-t border-border-strong bg-bg-inset px-3.5">
          <span className="h-1.5 w-1.5 rounded-full bg-text-secondary" />
          <span className="text-[12px] font-medium text-text-primary">1 pending change</span>
          <span className="font-mono text-[11px] text-text-faint">
            public.users · row {rows[pending.rowIndex].n} · {pending.field} → {pending.value}
          </span>
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" size="sm" onClick={discardPending}>
              Discard
            </Button>
            <Button variant="primary" size="sm" onClick={savePending}>
              Save <span className="font-mono opacity-55">{comboLabel("S")}</span>
            </Button>
          </div>
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

function Cell({
  children,
  align,
  muted,
}: {
  children: ReactNode;
  align?: "right";
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "truncate border-l border-border-faint px-2.5",
        align === "right" && "text-right",
        muted && "text-text-muted",
      )}
    >
      {children}
    </div>
  );
}

function EditableCell({
  children,
  editing,
  draft,
  onDraftChange,
  onStart,
  onCommit,
  muted,
}: {
  children: ReactNode;
  editing: boolean;
  draft: string;
  onDraftChange: (v: string) => void;
  onStart: () => void;
  onCommit: () => void;
  muted?: boolean;
}) {
  if (editing) {
    return (
      <div className="relative border-l border-border-faint px-0.5">
        <input
          autoFocus
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onBlur={onCommit}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommit();
            if (e.key === "Escape") onCommit();
          }}
          className="h-[26px] w-full rounded-[4px] border-[1.5px] border-inverse-bg bg-bg-selected px-1.5 text-text-primary outline-none ring-2 ring-white/[0.09]"
        />
      </div>
    );
  }
  return (
    <div
      onDoubleClick={onStart}
      className={cn(
        "cursor-text truncate border-l border-border-faint px-2.5",
        muted && "text-text-muted",
      )}
    >
      {children}
    </div>
  );
}
