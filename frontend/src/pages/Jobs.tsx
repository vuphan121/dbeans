import { useEffect, useMemo, useRef, useState, useCallback, type MouseEvent as ReactMouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  applyNodeChanges,
  MarkerType,
  type Edge,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Search, Plus } from "lucide-react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/Button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useJobsStore } from "@/state/jobs";
import { comboLabel, isTypingTarget } from "@/lib/platform";
import { CANVAS_BOUNDS, FIELD_CENTER, GRID_UNIT, snapToGrid } from "@/lib/canvasBounds";
import { JobCard } from "@/components/jobs/JobCard";
import { shouldSuppressNodeClick } from "@/lib/contextMenuGuard";

const nodeTypes = { jobCard: JobCard };

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 1.5;

function buildNode(jobId: string, layout: { x: number; y: number; width: number; height: number }): Node {
  return {
    id: jobId,
    type: "jobCard",
    position: { x: layout.x, y: layout.y },
    width: layout.width,
    height: layout.height,
    data: { jobId },
  };
}

export default function Jobs() {
  const navigate = useNavigate();
  const jobs = useJobsStore((s) => s.jobs);
  const loadJobs = useJobsStore((s) => s.loadJobs);
  const updateLayout = useJobsStore((s) => s.updateLayout);
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  function focusSearch() {
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }

  const [nodes, setNodes] = useState<Node[]>(() => jobs.map((j) => buildNode(j.id, j.layout)));

  useEffect(() => {
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      return jobs.map((j) => byId.get(j.id) ?? buildNode(j.id, j.layout));
    });
  }, [jobs]);

  const matchesQuery = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return new Set(jobs.filter((j) => j.name.toLowerCase().includes(q)).map((j) => j.id));
  }, [jobs, query]);

  const visibleNodes = useMemo(
    () => (matchesQuery ? nodes.filter((n) => matchesQuery.has(n.id)) : nodes),
    [nodes, matchesQuery],
  );

  // One arrow per dependency, drawn from the dependency job to the job that
  // depends on it, so the canvas doubles as a DAG view of the pipeline.
  const edges = useMemo<Edge[]>(() => {
    const visibleIds = new Set(visibleNodes.map((n) => n.id));
    const result: Edge[] = [];
    for (const job of jobs) {
      if (!visibleIds.has(job.id)) continue;
      for (const depId of job.dependsOn) {
        if (!visibleIds.has(depId)) continue;
        result.push({
          id: `${depId}->${job.id}`,
          source: depId,
          target: job.id,
          // Freeform bezier curves converging on the same target handle from
          // several sources tangle visually — smoothstep's orthogonal
          // routing (what n8n/Dagster-style DAG views use) reads as
          // organized even when multiple edges land on one node.
          type: "smoothstep",
          pathOptions: { borderRadius: 12 },
          markerEnd: { type: MarkerType.ArrowClosed, color: "var(--color-text-faint)" },
          style: { stroke: "var(--color-text-faint)", strokeWidth: 1.5 },
        } as Edge);
      }
    }
    return result;
  }, [jobs, visibleNodes]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const snapped = changes.map((c) => {
      if (c.type === "dimensions" && c.dimensions) {
        return { ...c, dimensions: { width: snapToGrid(c.dimensions.width), height: snapToGrid(c.dimensions.height) } };
      }
      if (c.type === "position" && c.position) {
        return { ...c, position: { x: snapToGrid(c.position.x), y: snapToGrid(c.position.y) } };
      }
      return c;
    });
    setNodes((nds) => applyNodeChanges(snapped, nds));
  }, []);

  const onInit = useCallback(
    (instance: ReactFlowInstance) => {
      if (jobs.length === 0) {
        instance.setCenter(FIELD_CENTER.x, FIELD_CENTER.y, { zoom: 1 });
      }
    },
    [jobs.length],
  );

  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      updateLayout(node.id, {
        x: snapToGrid(node.position.x),
        y: snapToGrid(node.position.y),
        width: node.width ?? 280,
        height: node.height ?? 160,
      });
    },
    [updateLayout],
  );

  // Guard against event.button !== 0: React Flow's onNodeClick fires on any
  // pointerup regardless of mouse button, so without this a right-click to
  // open the card's context menu would also navigate to the edit page.
  const onNodeClick = useCallback(
    (event: ReactMouseEvent, node: Node) => {
      if (event.button !== 0 || shouldSuppressNodeClick()) return;
      navigate(`/jobs/${node.id}/edit`);
    },
    [navigate],
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "n" && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault();
        navigate("/jobs/new");
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        focusSearch();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);

  return (
    <div className="flex h-full flex-col bg-bg-app">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border-subtle px-4">
        <div className="flex items-center gap-3">
          <Logo size={20} onClick={() => navigate("/connections")} />
          <div className="h-4 w-px bg-border-subtle" />
          <div className="text-[13px] font-medium text-text-secondary">Scheduled queries</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={focusSearch}
            className="rounded-[5px] border border-border-strong px-[7px] py-1 font-mono text-[11px] font-medium text-text-faint hover:bg-bg-hover"
          >
            {comboLabel("K")}
          </button>
          <ThemeToggle />
        </div>
      </header>

      <div className="dbeans-flow relative min-h-0 flex-1">
        <ReactFlowProvider>
          <ReactFlow
            nodes={visibleNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={onNodeClick}
            onInit={onInit}
            fitView
            fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            translateExtent={CANVAS_BOUNDS}
            nodeExtent={CANVAS_BOUNDS}
            proOptions={{ hideAttribution: true }}
            panOnScroll
            selectionOnDrag={false}
          >
            <Background variant={BackgroundVariant.Dots} gap={GRID_UNIT} size={2} color="var(--color-text-ghost)" />
            <Controls showInteractive={false} />
            <Panel position="top-right">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-[220px] items-center gap-1.5 rounded-[7px] border border-border-strong bg-bg-surface/90 px-2.5 backdrop-blur">
                  <Search size={11} className="text-text-quiet" />
                  <input
                    ref={searchInputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search scheduled queries"
                    className="w-full bg-transparent text-[12.5px] text-text-primary placeholder:text-text-quiet outline-none"
                  />
                </div>
                <Button variant="primary" size="sm" onClick={() => navigate("/jobs/new")}>
                  <Plus size={13} /> New job
                </Button>
              </div>
            </Panel>
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </div>
  );
}
