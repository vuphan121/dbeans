import { useState } from "react";
import { ChevronRight, ChevronDown, Search, RotateCw } from "lucide-react";
import { OTHER_TABLES, USER_COLUMNS } from "@/mock/sqlFixtures";
import { ConnectionSwitcher } from "./ConnectionSwitcher";

export function SchemaTree() {
  const [usersOpen, setUsersOpen] = useState(true);
  const [filter, setFilter] = useState("");

  return (
    <>
      <ConnectionSwitcher />
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
        <Row depth={0} label="acme_production" bold />
        <Row depth={1} label="public" count={28} />
        <Row depth={2} label="Tables" count={19} />
        <Row depth={3} label="users" bold expanded={usersOpen} onToggle={() => setUsersOpen((v) => !v)} highlight />
        {usersOpen &&
          USER_COLUMNS.filter((c) => c.name.includes(filter.toLowerCase())).map((c) => (
            <div key={c.name} className="flex h-6 items-center gap-2 pl-[72px] pr-1.5">
              <span className="font-mono text-[11px] text-text-tertiary">{c.name}</span>
              <span className="ml-auto font-mono text-[10px] text-text-ghost">{c.type}</span>
            </div>
          ))}
        {OTHER_TABLES.filter((t) => t.includes(filter.toLowerCase())).map((t) => (
          <Row key={t} depth={3} label={t} leaf />
        ))}
        <Row depth={2} label="Views" count={6} leaf />
        <Row depth={1} label="analytics" leaf />
        <Row depth={1} label="billing" leaf />
      </div>

      <div className="flex h-[34px] items-center justify-between border-t border-border-faint px-3">
        <span className="text-[11px] text-text-quiet">Snippets</span>
        <span className="text-[11px] text-text-quiet">◧</span>
      </div>
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
}: {
  depth: number;
  label: string;
  count?: number;
  bold?: boolean;
  leaf?: boolean;
  highlight?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div
      onClick={onToggle}
      style={{ paddingLeft: 6 + depth * 15 }}
      className={`flex h-[26px] cursor-pointer items-center gap-1.5 rounded-[5px] pr-1.5 ${
        highlight ? "bg-bg-hover" : ""
      }`}
    >
      <span className="w-[9px] text-[9px] text-text-muted">
        {leaf ? <ChevronRight size={9} className="text-text-disabled" /> : expanded === false ? (
          <ChevronRight size={9} />
        ) : (
          <ChevronDown size={9} />
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
