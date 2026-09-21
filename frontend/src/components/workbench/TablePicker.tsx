import { useState } from "react";
import { Command } from "cmdk";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, Clock, Eye, Star, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PickerTable {
  /** "schema.table" */
  key: string;
  kind: "table" | "view";
}

// Rendering thousands of rows into a popover is slow, so with no search text
// only the first slice of the full list is shown; typing searches all of it.
const UNSEARCHED_LIMIT = 200;

// Substring matches rank above scattered-letter matches; a match in the table
// name itself (after the schema dot) ranks above one in the schema.
function score(key: string, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const k = key.toLowerCase();
  const name = k.slice(k.indexOf(".") + 1);
  if (name.startsWith(q)) return 3;
  if (name.includes(q)) return 2;
  if (k.includes(q)) return 1;
  let i = 0;
  for (const ch of k) if (ch === q[i]) i++;
  return i === q.length ? 0.3 : 0;
}

const GROUP_HEADING =
  "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-text-quiet";

// A searchable replacement for a plain table <select>: type to filter, arrow
// keys + Enter to pick, star tables to pin them, and recently opened tables
// are offered first. Favorites and recents only show while the search box is
// empty — once you're searching, one flat ranked list is less confusing.
export function TablePicker({
  tables,
  value,
  recent,
  favorites,
  onSelect,
  onToggleFavorite,
}: {
  tables: PickerTable[];
  value: string;
  recent: string[];
  favorites: string[];
  onSelect: (key: string) => void;
  onToggleFavorite: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const byKey = new Map(tables.map((t) => [t.key, t]));
  const favoriteTables = favorites.flatMap((k) => byKey.get(k) ?? []);
  const recentTables = recent.filter((k) => !favorites.includes(k)).flatMap((k) => byKey.get(k) ?? []);
  const searching = search.trim() !== "";
  const listed = searching ? tables : tables.slice(0, UNSEARCHED_LIMIT);

  function pick(key: string) {
    onSelect(key);
    setOpen(false);
    // Closing here is programmatic, so Popover's onOpenChange never fires to
    // clear the search box; without this the next open would start filtered.
    setSearch("");
  }

  function row(table: PickerTable, group: string) {
    const starred = favorites.includes(table.key);
    return (
      <Command.Item
        key={`${group}|${table.key}`}
        value={`${group}|${table.key}`}
        onSelect={() => pick(table.key)}
        className="group flex h-8 cursor-pointer items-center gap-2 rounded-[5px] px-2.5 text-[12px] text-text-secondary data-[selected=true]:bg-bg-hover data-[selected=true]:text-text-primary"
      >
        {group === "recent" ? <Clock size={11} className="shrink-0 text-text-ghost" /> : table.kind === "view" ? <Eye size={11} className="shrink-0 text-text-ghost" /> : <Table2 size={11} className="shrink-0 text-text-ghost" />}
        <span className={cn("truncate font-mono", table.key === value && "text-text-primary")}>{table.key}</span>
        {table.kind === "view" && <span className="shrink-0 text-[10px] text-text-ghost">view</span>}
        <button
          type="button"
          aria-label={starred ? `Unpin ${table.key}` : `Pin ${table.key}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(table.key);
          }}
          className={cn("ml-auto shrink-0 rounded p-0.5 hover:text-text-primary", starred ? "text-text-secondary" : "text-text-ghost opacity-0 group-data-[selected=true]:opacity-100")}
        >
          <Star size={11} className={starred ? "fill-current" : ""} />
        </button>
      </Command.Item>
    );
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <Popover.Trigger className="flex h-7 min-w-[210px] items-center justify-between gap-2 rounded-[7px] border border-border-input bg-bg-inset px-2.5 font-mono text-[12px] text-text-primary outline-none">
        <span className="truncate">{value}</span>
        <ChevronDown size={11} className="shrink-0 text-text-quiet" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 w-[340px] overflow-hidden rounded-[8px] border border-border-elevated bg-bg-raised shadow-2xl"
        >
          <Command
            loop
            filter={(itemValue, query) => score(itemValue.slice(itemValue.indexOf("|") + 1), query)}
          >
            <Command.Input
              autoFocus
              value={search}
              onValueChange={setSearch}
              placeholder={`Search ${tables.length} table${tables.length === 1 ? "" : "s"}…`}
              className="h-9 w-full border-b border-border-default bg-transparent px-3 text-[12.5px] text-text-primary outline-none placeholder:text-text-quiet"
            />
            <Command.List className="max-h-[320px] overflow-y-auto p-1">
              <Command.Empty className="px-3 py-5 text-center text-[12px] text-text-faint">No matching tables</Command.Empty>
              {!searching && favoriteTables.length > 0 && (
                <Command.Group heading="Pinned" className={GROUP_HEADING}>{favoriteTables.map((t) => row(t, "fav"))}</Command.Group>
              )}
              {!searching && recentTables.length > 0 && (
                <Command.Group heading="Recent" className={GROUP_HEADING}>{recentTables.map((t) => row(t, "recent"))}</Command.Group>
              )}
              <Command.Group heading={searching ? "Results" : "All tables"} className={GROUP_HEADING}>{listed.map((t) => row(t, "all"))}</Command.Group>
              {!searching && tables.length > UNSEARCHED_LIMIT && (
                <div className="px-3 py-2 text-[11px] text-text-faint">Showing {UNSEARCHED_LIMIT} of {tables.length}</div>
              )}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
