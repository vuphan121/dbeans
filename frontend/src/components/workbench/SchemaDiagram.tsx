import { useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  Handle,
  Position,
  BaseEdge,
  getSmoothStepPath,
  useInternalNode,
  type Node,
  type Edge,
  type NodeProps,
  type EdgeProps,
  type InternalNode,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { KeyRound, Link2, Loader2, Table2 } from "lucide-react";
import { useSchemaStore } from "@/state/schema";
import type { TableInfo } from "@/lib/types";
import { cn } from "@/lib/utils";

const NODE_WIDTH = 220;

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
      {/* Invisible — floating edges below compute their own attachment point
          per-edge based on where the other table actually sits, rather than
          funneling every connection through one fixed side of the node.
          React Flow still needs a real source/target handle to exist. */}
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
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

// "Floating" edges — React Flow's own documented pattern for exactly the
// problem a hub table causes (many tables referencing one, e.g. "users"):
// with fixed Left/Right handles every one of those edges funnels through
// the same single point on the hub's border, reading as a tangled knot no
// matter how the layout spaces the columns. Instead, each edge's endpoint
// is computed per-render from where the *other* node's center actually is
// — the intersection of the line between the two node centers with the
// node's own rectangle — so connections spread around the hub's border
// roughly where they're coming from, the way a hand-drawn ERD would.
function getNodeIntersection(intersectionNode: InternalNode, targetNode: InternalNode) {
  const { width, height } = intersectionNode.measured as { width: number; height: number };
  const intersectionPos = intersectionNode.internals.positionAbsolute;
  const targetPos = targetNode.internals.positionAbsolute;
  const targetMeasured = targetNode.measured as { width: number; height: number };

  const w = width / 2;
  const h = height / 2;
  const x2 = intersectionPos.x + w;
  const y2 = intersectionPos.y + h;
  const x1 = targetPos.x + targetMeasured.width / 2;
  const y1 = targetPos.y + targetMeasured.height / 2;

  const xx1 = (x1 - x2) / (2 * w) - (y1 - y2) / (2 * h);
  const yy1 = (x1 - x2) / (2 * w) + (y1 - y2) / (2 * h);
  const a = 1 / (Math.abs(xx1) + Math.abs(yy1) || 1);
  const xx3 = a * xx1;
  const yy3 = a * yy1;

  return { x: w * (xx3 + yy3) + x2, y: h * (-xx3 + yy3) + y2 };
}

function getEdgePosition(node: InternalNode, intersectionPoint: { x: number; y: number }): Position {
  const pos = node.internals.positionAbsolute;
  const measured = node.measured as { width: number; height: number };
  const nx = Math.round(pos.x);
  const ny = Math.round(pos.y);
  const px = Math.round(intersectionPoint.x);
  const py = Math.round(intersectionPoint.y);

  if (px <= nx + 1) return Position.Left;
  if (px >= nx + measured.width - 1) return Position.Right;
  if (py <= ny + 1) return Position.Top;
  if (py >= ny + measured.height - 1) return Position.Bottom;
  return Position.Top;
}

function FloatingEdge({ id, source, target, markerEnd, style }: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (!sourceNode || !targetNode) return null;

  const sourceIntersection = getNodeIntersection(sourceNode, targetNode);
  const targetIntersection = getNodeIntersection(targetNode, sourceNode);
  const sourcePos = getEdgePosition(sourceNode, sourceIntersection);
  const targetPos = getEdgePosition(targetNode, targetIntersection);

  const [path] = getSmoothStepPath({
    sourceX: sourceIntersection.x,
    sourceY: sourceIntersection.y,
    sourcePosition: sourcePos,
    targetX: targetIntersection.x,
    targetY: targetIntersection.y,
    targetPosition: targetPos,
    borderRadius: 12,
  });

  return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />;
}

const edgeTypes = { floating: FloatingEdge };

function tableNodeHeight(table: TableInfo): number {
  return 36 + table.columns.length * 24 + 8;
}

// Lays tables out left-to-right by dependency (a table nothing references
// sits leftmost; anything referencing it sits to the right) using dagre's
// layered-graph algorithm rather than a hand-rolled column stack — dagre
// also reorders nodes *within* each layer (the barycenter heuristic) to
// minimize edge crossings, which a plain "depth column, alphabetical
// order" layout has no way to do: two tables in the same column with
// crisscrossing dependents just looks tangled no matter how the arrows
// themselves are drawn. `edges` are dependency edges (from = the
// referencing table, to = the table it references) — dagre is fed the
// reverse (to, from) so the referenced table lands in an earlier/left
// rank, matching how the actual FK arrows are drawn separately.
function layoutTables(tables: TableInfo[], edges: { from: string; to: string }[]): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 24, ranksep: 90, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const t of tables) {
    g.setNode(t.name, { width: NODE_WIDTH, height: tableNodeHeight(t) });
  }
  const seen = new Set<string>();
  for (const e of edges) {
    if (e.from === e.to) continue;
    const key = `${e.to}->${e.from}`;
    if (seen.has(key)) continue; // dagre errors on duplicate edges between the same pair
    seen.add(key);
    g.setEdge(e.to, e.from);
  }

  dagre.layout(g);

  const positions = new Map<string, { x: number; y: number }>();
  for (const t of tables) {
    const n = g.node(t.name);
    if (n) positions.set(t.name, { x: n.x - n.width / 2, y: n.y - n.height / 2 });
  }
  return positions;
}

function DiagramInner({ connectionId }: { connectionId: string }) {
  const entry = useSchemaStore((s) => s.byConnectionId[connectionId]);
  const loadSchema = useSchemaStore((s) => s.loadSchema);

  useEffect(() => {
    if (!entry) loadSchema(connectionId);
  }, [connectionId, entry, loadSchema]);

  // Switching to this tab swaps a live DOM subtree in place (unlike
  // Connections/Jobs, which mount React Flow on a fresh route navigation
  // into an already-stable layout) — React Flow's first measurement can
  // land mid-reflow, read a 0×0 container, and then never draw edges again
  // even once the container settles (nodes still render since their CSS
  // position doesn't depend on the same measurement). Mounting <ReactFlow>
  // itself only after a post-paint frame sidesteps the race outright,
  // instead of trying to coax a bad first measurement into a good one.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(raf);
  }, []);

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
        type: "floating",
        markerEnd: { type: MarkerType.ArrowClosed, color: "var(--color-text-faint)" },
        style: { stroke: "var(--color-text-faint)", strokeWidth: 1.5 },
      })) as Edge[],
    [foreignKeys],
  );

  if (!ready || entry?.status === "loading" || !entry) {
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
    <div className="dbeans-flow relative min-h-0 flex-1" style={{ width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
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
