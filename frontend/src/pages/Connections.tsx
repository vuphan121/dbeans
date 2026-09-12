import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  applyNodeChanges,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Search, Settings as SettingsIcon, Plus } from "lucide-react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { useConnectionsStore } from "@/state/connections";
import { useUiStore } from "@/state/ui";
import { requestOpenConnection } from "@/lib/openConnection";
import { comboLabel, isModPressed, isTypingTarget } from "@/lib/platform";
import { CANVAS_BOUNDS, FIELD_CENTER, GRID_UNIT, snapToGrid } from "@/lib/canvasBounds";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ConnectionCard } from "@/components/connections/ConnectionCard";

const nodeTypes = { connectionCard: ConnectionCard };

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 1.5;

function buildNode(connectionId: string, layout: { x: number; y: number; width: number; height: number }): Node {
  return {
    id: connectionId,
    type: "connectionCard",
    position: { x: layout.x, y: layout.y },
    width: layout.width,
    height: layout.height,
    data: { connectionId },
  };
}

export default function Connections() {
  const navigate = useNavigate();
  const connections = useConnectionsStore((s) => s.connections);
  const updateLayout = useConnectionsStore((s) => s.updateLayout);
  const setActiveConnection = useConnectionsStore((s) => s.setActiveConnection);
  const pingConnection = useConnectionsStore((s) => s.pingConnection);
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  function focusSearch() {
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }

  // Ping each connection once per page visit. The backend caches results
  // for ~60s, so this is cheap even if you refresh repeatedly — only ping
  // ids we haven't already asked about this mount, since a ping's own
  // status update touches `connections` and would otherwise re-trigger.
  const pingedIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const c of connections) {
      if (!pingedIdsRef.current.has(c.id)) {
        pingedIdsRef.current.add(c.id);
        pingConnection(c.id);
      }
    }
  }, [connections, pingConnection]);

  // Defensive reset: if a previous "open" got interrupted (e.g. browser
  // back-navigation mid-transition), don't leave the board stuck refusing
  // clicks because openingConnectionId is still set from last time.
  useEffect(() => {
    useUiStore.getState().setOpeningConnectionId(null);
  }, []);
  const [nodes, setNodes] = useState<Node[]>(() =>
    connections.map((c) => buildNode(c.id, c.layout)),
  );

  // Resync when connections are added/removed, without clobbering the live
  // (possibly mid-drag) position/size of nodes that already exist.
  useEffect(() => {
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      return connections.map((c) => byId.get(c.id) ?? buildNode(c.id, c.layout));
    });
  }, [connections]);

  const matchesQuery = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return new Set(
      connections.filter((c) => c.name.toLowerCase().includes(q) || c.dsn.toLowerCase().includes(q)).map((c) => c.id),
    );
  }, [connections, query]);

  const visibleNodes = useMemo(
    () => (matchesQuery ? nodes.filter((n) => matchesQuery.has(n.id)) : nodes),
    [nodes, matchesQuery],
  );

  // Snap drag and resize live (not just at drag-end) — round each
  // in-progress position/dimensions change to the (offset) grid so the box
  // edge tracks a dot the whole time you're dragging, not just once you let
  // go. This is done by hand rather than via React Flow's own snapToGrid
  // prop because that snaps to bare multiples of the grid unit, and the
  // actual dot grid sits half a cell off from that (see canvasBounds.ts).
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

  // `fitView` only has something to fit once there are cards — with none,
  // land on the middle of the field instead of wherever the default
  // viewport happens to be.
  const onInit = useCallback(
    (instance: ReactFlowInstance) => {
      if (connections.length === 0) {
        instance.setCenter(FIELD_CENTER.x, FIELD_CENTER.y, { zoom: 1 });
      }
    },
    [connections.length],
  );

  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      updateLayout(node.id, {
        x: snapToGrid(node.position.x),
        y: snapToGrid(node.position.y),
        width: node.width ?? 280,
        height: node.height ?? 148,
      });
    },
    [updateLayout],
  );

  // React Flow's own click detection (vs. drag) is far more reliable here
  // than a native dblclick on the card — that one could silently swallow
  // the second click if there was any pointer movement between the two.
  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      requestOpenConnection(node.id, navigate, setActiveConnection);
    },
    [navigate, setActiveConnection],
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Bare "N", not Ctrl/Cmd+N — that combo is reserved by every browser
      // for "new window" and can't be intercepted from the page.
      if (e.key.toLowerCase() === "n" && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault();
        navigate("/connections/new");
        return;
      }
      // Ctrl/Cmd+K jumps into search here — has to preventDefault or Chrome
      // hijacks it to focus the address bar for a web search instead.
      if (isModPressed(e) && e.key.toLowerCase() === "k") {
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
        <Logo size={20} onClick={() => navigate("/connections")} />
        <div className="flex items-center gap-2">
          <button
            onClick={focusSearch}
            className="rounded-[5px] border border-border-strong px-[7px] py-1 font-mono text-[11px] font-medium text-text-faint hover:bg-bg-hover"
          >
            {comboLabel("K")}
          </button>
          <ThemeToggle />
          <IconButton onClick={() => navigate("/settings")} aria-label="Settings">
            <SettingsIcon size={13} />
          </IconButton>
        </div>
      </header>

      <div className="dbeans-flow relative min-h-0 flex-1">
        <ReactFlowProvider>
          <ReactFlow
            nodes={visibleNodes}
            edges={[]}
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
                    placeholder="Search connections"
                    className="w-full bg-transparent text-[12.5px] text-text-primary placeholder:text-text-quiet outline-none"
                  />
                </div>
                <Button variant="primary" size="sm" onClick={() => navigate("/connections/new")}>
                  <Plus size={13} /> Add
                </Button>
              </div>
            </Panel>
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </div>
  );
}
