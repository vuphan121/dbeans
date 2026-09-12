import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { ConnectionSwitcher } from "../ConnectionSwitcher";
import { useKafkaStore } from "@/state/kafka";
import { cn } from "@/lib/utils";

export function TopicBrowser() {
  const { topics, selectedTopic, select } = useKafkaStore();
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return topics;
    return topics.filter((t) => t.name.toLowerCase().includes(q));
  }, [topics, filter]);

  return (
    <>
      <ConnectionSwitcher />
      <div className="px-2.5 pb-1.5 pt-2">
        <div className="flex h-7 items-center gap-1.5 rounded-[6px] border border-border-default bg-bg-inset px-2">
          <Search size={10} className="text-text-ghost" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter topics"
            className="w-full bg-transparent text-[11.5px] text-text-primary placeholder:text-text-ghost outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 py-1">
        {filtered.map((t) => (
          <div
            key={t.name}
            onClick={() => select(t.name)}
            className={cn(
              "flex cursor-pointer flex-col gap-0.5 rounded-[6px] px-2.5 py-1.5",
              selectedTopic === t.name ? "bg-bg-hover" : "hover:bg-bg-hover/50",
            )}
          >
            <span className="truncate font-mono text-[11.5px] text-text-secondary">{t.name}</span>
            <span className="text-[10px] text-text-quiet">
              {t.partitions} partitions · ~{t.approxMessages} msgs
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
