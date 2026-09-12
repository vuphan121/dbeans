import { useState } from "react";
import { ChevronRight, ChevronDown, Search, RotateCw } from "lucide-react";
import { OTHER_TABLES, TABLE_COLUMNS, USER_COLUMNS, VIEWS } from "@/mock/sqlFixtures";
import { useWorkbenchStore } from "@/state/workbench";
import { SnippetsPanel } from "./SnippetsPanel";

const ALL_TABLES = ["users", ...OTHER_TABLES];

export function SchemaTree() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["db", "public", "tables", "users"]));
  const [filter, setFilter] = useState("");
  const openTable = useWorkbenchStore((s) => s.openTable);

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const tableMatches = (name: string) => name.toLowerCase().includes(filter.toLowerCase());
  const visibleTables = ALL_TABLES.filter(tableMatches);
  const visibleViews = VIEWS.filter((v) => v.toLowerCase().includes(filter.toLowerCase()));

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
        <button className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-border-default text-text-faint hover:bg-bg-hover">
          <RotateCw size={11} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 py-1">
        <Row depth={0} label="acme_production" bold expanded={expanded.has("db")} onToggle={() => toggle("db")} />
        {expanded.has("db") && (
          <>
            <Row
              depth={1}
              label="public"
              count={28}
              expanded={expanded.has("public")}
              onToggle={() => toggle("public")}
            />
            {expanded.has("public") && (
              <>
                <Row
                  depth={2}
                  label="Tables"
                  count={ALL_TABLES.length}
                  expanded={expanded.has("tables")}
                  onToggle={() => toggle("tables")}
                />
                {expanded.has("tables") &&
                  visibleTables.map((t) => {
                    const columns = t === "users" ? USER_COLUMNS : TABLE_COLUMNS[t];
                    return (
                      <div key={t}>
                        <Row
                          depth={3}
                          label={t}
                          bold={t === "users"}
                          highlight={t === "users"}
                          expanded={expanded.has(t)}
                          onToggle={() => toggle(t)}
                          onOpen={() => openTable(t)}
                        />
                        {expanded.has(t) &&
                          columns.map((col) => (
                            <div key={col.name} className="flex h-6 items-center gap-2 pl-[72px] pr-1.5">
                              <span className="font-mono text-[11px] text-text-tertiary">{col.name}</span>
                              <span className="ml-auto font-mono text-[10px] text-text-ghost">{col.type}</span>
                            </div>
                          ))}
                      </div>
                    );
                  })}
                <Row
                  depth={2}
                  label="Views"
                  count={VIEWS.length}
                  expanded={expanded.has("views")}
                  onToggle={() => toggle("views")}
                />
                {expanded.has("views") &&
                  visibleViews.map((v) => (
                    <Row key={v} depth={3} label={v} leaf onOpen={() => openTable(v)} />
                  ))}
              </>
            )}
          </>
        )}
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
        className={`font-mono text-[11.5px] ${bold ? "font-medium text-text-primary" : "text-text-secondary"}`}
      >
        {label}
      </span>
      {count != null && <span className="ml-auto text-[10px] text-text-ghost">{count}</span>}
    </div>
  );
}
