import { Plus, X } from "lucide-react";
import { useWorkbenchStore } from "@/state/workbench";
import { cn } from "@/lib/utils";

export function TabStrip() {
  const { tabs, activeTabId, setActiveTab, addTab, closeTab } = useWorkbenchStore();

  return (
    <div className="flex flex-1 items-end gap-0.5 overflow-x-auto px-2">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "group flex h-[33px] shrink-0 cursor-pointer items-center gap-2 rounded-t-[7px] border border-b-0 px-3",
              active
                ? "border-border-subtle bg-bg-raised"
                : "border-transparent hover:bg-bg-hover/40",
            )}
          >
            <span
              className={cn(
                "font-mono text-[11px] font-medium",
                active ? "text-text-faint" : "text-text-ghost",
              )}
            >
              {tab.kind === "sql" ? "SQL" : "TBL"}
            </span>
            <span className={cn("text-[12.5px]", active ? "font-medium text-text-primary" : "text-text-muted")}>
              {tab.title}
            </span>
            {tab.dirty ? (
              <span className="h-[5px] w-[5px] rounded-full bg-text-faint" />
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className="text-[11px] text-text-quiet opacity-0 hover:text-text-secondary group-hover:opacity-100"
              >
                <X size={11} />
              </button>
            )}
          </div>
        );
      })}
      <button
        onClick={addTab}
        className="flex h-[33px] w-7 shrink-0 items-center justify-center text-text-faint hover:text-text-secondary"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
