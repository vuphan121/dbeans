import { useMemo, useState } from "react";
import { Search, Plus } from "lucide-react";
import { ConnectionSwitcher } from "../ConnectionSwitcher";
import { useRedisStore } from "@/state/redis";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<string, string> = {
  string: "str",
  hash: "hash",
  list: "list",
  set: "set",
  zset: "zset",
};

export function KeyBrowser({ onNewKey }: { onNewKey: () => void }) {
  const { keys, selectedKey, select } = useRedisStore();
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return keys;
    return keys.filter((k) => k.key.toLowerCase().includes(q));
  }, [keys, filter]);

  return (
    <>
      <ConnectionSwitcher />
      <div className="flex items-center gap-1.5 px-2.5 pb-1.5 pt-2">
        <div className="flex h-7 flex-1 items-center gap-1.5 rounded-[6px] border border-border-default bg-bg-inset px-2">
          <Search size={10} className="text-text-ghost" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter keys (pattern)"
            className="w-full bg-transparent text-[11.5px] text-text-primary placeholder:text-text-ghost outline-none"
          />
        </div>
        <button
          onClick={onNewKey}
          className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-border-default text-text-faint hover:bg-bg-hover"
        >
          <Plus size={12} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 py-1">
        {filtered.map((k) => (
          <div
            key={k.key}
            onClick={() => select(k.key)}
            className={cn(
              "flex h-[30px] cursor-pointer items-center gap-2 rounded-[5px] px-2",
              selectedKey === k.key ? "bg-bg-hover" : "hover:bg-bg-hover/50",
            )}
          >
            <span className="w-9 shrink-0 rounded-[4px] bg-bg-active px-1 py-0.5 text-center font-mono text-[9px] font-medium text-text-tertiary">
              {TYPE_LABEL[k.value.type]}
            </span>
            <span className="truncate font-mono text-[11.5px] text-text-secondary">{k.key}</span>
            {k.ttl != null && (
              <span className="ml-auto shrink-0 font-mono text-[9.5px] text-text-quiet">{k.ttl}s</span>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
