import { useEffect, useMemo } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { KeyRound, Link2, Loader2, Table2 } from "lucide-react";
import { useSchemaStore } from "@/state/schema";
import type { TableInfo } from "@/lib/types";
import { cn } from "@/lib/utils";

const NODE_WIDTH = 220;
const COL_SPACING = 300;
const ROW_GAP = 28;

// information_schema's data_type is SQL-standard-verbose ("timestamp with
// time zone"); psql's own \d shorthand is what any Postgres user actually
// thinks in, and it's short enough to never need truncating in a 220px card.
const TYPE_ABBREVIATIONS: Record<string, string> = {
  "timestamp with time zone": "timestamptz",
  "timestamp without time zone": "timestamp",
  "time with time zone": "timetz",
  "time without time zone": "time",
  "character varying": "varchar",
  "double precision": "float8",
};

function shortType(type: string): string {
  return TYPE_ABBREVIATIONS[type] ?? type;
}

interface TableNodeData extends Record<string, unknown> {
  table: TableInfo;
  fkColumnNames: Set<string>;
}

function TableNode({ data }: NodeProps<Node<TableNodeData>>) {
  const { table, fkColumnNames } = data;
  return (
    <div
      style={{ width: NODE_WIDTH }}
      className="overflow-hidden rounded-[8px] border border-border-elevated bg-bg-raised shadow-lg"
    >
      <Handle type="target" position={Position.Left} className="!border-none !bg-border-focus" />
      <Handle type="source" position={Position.Right} className="!border-none !bg-border-focus" />
      <div className="flex items-center gap-1.5 border-b border-border-default bg-bg-hover px-2.5 py-1.5">
        <Table2 size={11} className="shrink-0 text-text-faint" />
        <span className="truncate text-[12px] font-semibold text-text-primary">{table.name}</span>
        {table.kind === "view" && (
          <span className="ml-auto shrink-0 text-[9px] font-medium uppercase tracking-wide text-text-quiet">view</span>
        )}
      </div>
      <div className="divide-y divide-border-faint">
        {table.columns.map((col) => (
          <div key={col.name} className="flex min-w-0 items-center gap-1.5 px-2.5 py-1">
            <span className="flex w-3 shrink-0 items-center justify-center">
              {col.isPrimaryKey ? (
                <KeyRound size={9} className="text-accent" />
              ) : fkColumnNames.has(col.name) ? (
                <Link2 size={9} className="text-text-faint" />
              ) : null}
            </span>
            <span
              className={cn("min-w-0 flex-1 truncate text-[11px]", col.isPrimaryKey ? "font-medium text-text-primary" : "text-text-secondary")}
              title={col.name}
            >
              {col.name}
            </span>
            <span className="max-w-[92px] shrink-0 truncate font-mono text-[9.5px] text-text-quiet" title={col.type}>
              {shortType(col.type)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const nodeTypes = { table: TableNode };

// Lays tables out left-to-right by dependency depth (a table with no
// outgoing foreign keys sits at depth 0; anything referencing it sits one
// column to the right of the deepest table it references) rather than a
// plain grid — for a schema that's mostly a tree/DAG (the common case),
// this reads as an actual diagram instead of an arbitrary scatter, and it's
// deterministic so the same schema always lays out the same way.
function layoutTables(tables: TableInfo[], edges: { from: string; to: string }[]): Map<string, { x: number; y: number }> {
  const depth = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const e of edges) {
    if (e.from === e.to) continue;
    if (!outgoing.has(e.from)) outgoing.set(e.from, []);
    outgoing.get(e.from)!.push(e.to);
  }

  function depthOf(name: string, seen: Set<string>): number {
    if (depth.has(name)) return depth.get(name)!;
    if (seen.has(name)) return 0; // cycle guard
    seen.add(name);
    const targets = outgoing.get(name) ?? [];
    const d = targets.length === 0 ? 0 : 1 + Math.max(...targets.map((t) => depthOf(t, seen)));
    depth.set(name, d);
    return d;
  }
  for (const t of tables) depthOf(t.name, new Set());

  const byColumn = new Map<number, TableInfo[]>();
  for (const t of tables) {
    const d = depth.get(t.name) ?? 0;
    if (!byColumn.has(d)) byColumn.set(d, []);
    byColumn.get(d)!.push(t);
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const [col, colTables] of byColumn) {
    let y = 0;
    for (const t of colTables) {
      positions.set(t.name, { x: col * COL_SPACING, y });
      const height = 36 + t.columns.length * 24 + 8;
      y += height + ROW_GAP;
    }
  }
  return positions;
}

function DiagramInner({ connectionId }: { connectionId: string }) {
  const entry = useSchemaStore((s) => s.byConnectionId[connectionId]);
  const loadSchema = useSchemaStore((s) => s.loadSchema);

  useEffect(() => {
    if (!entry) loadSchema(connectionId);
  }, [connectionId, entry, loadSchema]);

  const allTables = useMemo(() => entry?.schema?.schemas.flatMap((s) => s.tables) ?? [], [entry]);
  const foreignKeys = entry?.schema?.foreignKeys ?? [];

  const depEdges = useMemo(() => foreignKeys.map((fk) => ({ from: fk.fromTable, to: fk.toTable })), [foreignKeys]);
  const positions = useMemo(() => layoutTables(allTables, depEdges), [allTables, depEdges]);

  const fkColumnsByTable = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const fk of foreignKeys) {
      if (!map.has(fk.fromTable)) map.set(fk.fromTable, new Set());
      map.get(fk.fromTable)!.add(fk.fromColumn);
    }
    return map;
  }, [foreignKeys]);

  const nodes: Node<TableNodeData>[] = useMemo(
    () =>
      allTables.map((table) => ({
        id: table.name,
        type: "table",
        position: positions.get(table.name) ?? { x: 0, y: 0 },
        data: { table, fkColumnNames: fkColumnsByTable.get(table.name) ?? new Set() },
        draggable: true,
      })),
    [allTables, positions, fkColumnsByTable],
  );

  const edges: Edge[] = useMemo(
    () =>
      foreignKeys.map((fk, i) => ({
        id: `${fk.fromTable}.${fk.fromColumn}->${fk.toTable}.${fk.toColumn}-${i}`,
        source: fk.fromTable,
        target: fk.toTable,
        type: "smoothstep",
        pathOptions: { borderRadius: 12 },
        markerEnd: { type: MarkerType.ArrowClosed, color: "var(--color-text-faint)" },
        style: { stroke: "var(--color-text-faint)", strokeWidth: 1.5 },
      })) as Edge[],
    [foreignKeys],
  );

  if (entry?.status === "loading" || !entry) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 size={18} className="animate-spin text-text-quiet" />
      </div>
    );
  }

  if (entry.status === "error") {
    return (
      <div className="flex flex-1 items-center justify-center text-[12.5px] text-text-faint">
        {entry.error ?? "Failed to load schema"}
      </div>
    );
  }

  if (allTables.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-[12.5px] text-text-faint">
        No tables in this database yet.
      </div>
    );
  }

  return (
    <div className="dbeans-flow relative min-h-0 flex-1">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

// The per-connection ERD: one card per table (columns, primary/foreign key
// markers) and an arrow per foreign key, laid out by dependency depth. Pure
// read model — nothing here is draggable-and-saved like the connections/jobs
// canvases, since it's a snapshot of the live schema, not a user-curated
// board (nodes are still draggable within a session for readability, just
// not persisted).
export function SchemaDiagram({ connectionId }: { connectionId: string }) {
  return (
    <ReactFlowProvider>
      <DiagramInner connectionId={connectionId} />
    </ReactFlowProvider>
  );
}
