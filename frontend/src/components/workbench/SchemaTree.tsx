import { useEffect, useState } from "react";
import { ChevronRight, ChevronDown, Search, RotateCw, Loader2 } from "lucide-react";
import { useSchemaStore } from "@/state/schema";
import { useWorkbenchStore } from "@/state/workbench";
import { SnippetsPanel } from "./SnippetsPanel";

export function SchemaTree({ connectionId }: { connectionId: string }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const openTable = useWorkbenchStore((s) => s.openTable);
  const entry = useSchemaStore((s) => s.byConnectionId[connectionId]);
  const loadSchema = useSchemaStore((s) => s.loadSchema);

  useEffect(() => {
    if (!entry) loadSchema(connectionId);
  }, [connectionId, entry, loadSchema]);

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const schemaGroups = entry?.schema?.schemas ?? [];
  const matches = (name: string) => name.toLowerCase().includes(filter.toLowerCase());

  return (
    <>
      <div className="flex items-center gap-1.5 px-2.5 pb-1.5 pt-2">
        <div className="flex h-7 flex-1 items-center gap-1.5 rounded-[6px] border border-border-default bg-bg-inset px-2">
          <Search size={10} className="text-text-ghost" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter objects"
            className="w-full bg-transparent text-[11.5px] text-text-primary placeholder:text-text-ghost outline-none"
          />
        </div>
        <button
          onClick={() => loadSchema(connectionId)}
          disabled={entry?.status === "loading"}
          className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-border-default text-text-faint hover:bg-bg-hover disabled:opacity-50"
        >
          <RotateCw size={11} className={entry?.status === "loading" ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 py-1">
        {entry?.status === "loading" && (
          <div className="flex items-center gap-2 px-2.5 py-2 text-[11.5px] text-text-faint">
            <Loader2 size={11} className="animate-spin" /> Loading schema…
          </div>
        )}
        {entry?.status === "error" && (
          <div className="px-2.5 py-2 text-[11.5px] text-error-dim">
            Couldn't load schema: {entry.error}
          </div>
        )}
        {entry?.status === "ready" && schemaGroups.length === 0 && (
          <div className="px-2.5 py-2 text-[11.5px] text-text-quiet">No tables or views found.</div>
        )}
        {entry?.status === "ready" &&
          schemaGroups.map((group) => {
            const groupKey = `schema:${group.name}`;
            const visibleTables = group.tables.filter((t) => matches(t.name));
            const tables = visibleTables.filter((t) => t.kind === "table");
            const views = visibleTables.filter((t) => t.kind === "view");
            return (
              <div key={group.name}>
                <Row
                  depth={0}
                  label={group.name}
                  bold
                  count={group.tables.length}
                  expanded={expanded.has(groupKey)}
                  onToggle={() => toggle(groupKey)}
                />
                {expanded.has(groupKey) && (
                  <>
                    {tables.length > 0 && (
                      <>
                        <Row
                          depth={1}
                          label="Tables"
                          count={tables.length}
                          expanded={expanded.has(`${groupKey}:tables`)}
                          onToggle={() => toggle(`${groupKey}:tables`)}
                        />
                        {expanded.has(`${groupKey}:tables`) &&
                          tables.map((t) => {
                            const tKey = `${groupKey}:${t.name}`;
                            return (
                              <div key={tKey}>
                                <Row
                                  depth={2}
                                  label={t.name}
                                  expanded={expanded.has(tKey)}
                                  onToggle={() => toggle(tKey)}
                                  onOpen={() => openTable(`${group.name}.${t.name}`)}
                                />
                                {expanded.has(tKey) &&
                                  t.columns.map((col) => (
                                    <div
                                      key={col.name}
                                      title={`${col.name} · ${col.type}`}
                                      className="flex h-6 items-center gap-2 pl-[62px] pr-1.5"
                                    >
                                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-tertiary">
                                        {col.name}
                                      </span>
                                      <span className="max-w-[42%] shrink-0 truncate font-mono text-[10px] text-text-ghost">
                                        {col.type}
                                      </span>
                                    </div>
                                  ))}
                              </div>
                            );
                          })}
                      </>
                    )}
                    {views.length > 0 && (
                      <>
                        <Row
                          depth={1}
                          label="Views"
                          count={views.length}
                          expanded={expanded.has(`${groupKey}:views`)}
                          onToggle={() => toggle(`${groupKey}:views`)}
                        />
                        {expanded.has(`${groupKey}:views`) &&
                          views.map((v) => (
                            <Row
                              key={v.name}
                              depth={2}
                              label={v.name}
                              leaf
                              onOpen={() => openTable(`${group.name}.${v.name}`)}
                            />
                          ))}
                      </>
                    )}
                  </>
                )}
              </div>
            );
          })}
      </div>

      <SnippetsPanel />
    </>
  );
}

function Row({
  depth,
  label,
  count,
  bold,
  leaf,
  highlight,
  expanded,
  onToggle,
  onOpen,
}: {
  depth: number;
  label: string;
  count?: number;
  bold?: boolean;
  leaf?: boolean;
  highlight?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  onOpen?: () => void;
}) {
  return (
    <div
      onClick={onToggle}
      onDoubleClick={onOpen}
      title={onOpen ? "Double-click to open" : undefined}
      style={{ paddingLeft: 6 + depth * 15 }}
      className={`flex h-[26px] cursor-pointer items-center gap-1.5 rounded-[5px] pr-1.5 hover:bg-bg-hover/60 ${
        highlight ? "bg-bg-hover" : ""
      }`}
    >
      <span className="w-[9px] text-[9px] text-text-muted">
        {leaf ? (
          <ChevronRight size={9} className="text-text-disabled" />
        ) : expanded ? (
          <ChevronDown size={9} />
        ) : (
          <ChevronRight size={9} />
        )}
      </span>
      <span
        className={`min-w-0 flex-1 truncate font-mono text-[11.5px] ${bold ? "font-medium text-text-primary" : "text-text-secondary"}`}
      >
        {label}
      </span>
      {count != null && <span className="ml-auto shrink-0 pl-1.5 text-[10px] text-text-ghost">{count}</span>}
    </div>
  );
}
