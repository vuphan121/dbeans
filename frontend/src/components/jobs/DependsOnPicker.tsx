import { useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface JobOption {
  id: string;
  name: string;
}

// A searchable multi-select for "depends on": staying open across clicks
// (Radix Popover, not DropdownMenu, since DropdownMenu items close the menu
// on select by default) so the user can check several jobs in one go.
export function DependsOnPicker({
  jobs,
  selected,
  onToggle,
}: {
  jobs: JobOption[];
  selected: string[];
  onToggle: (jobId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter((j) => j.name.toLowerCase().includes(q));
  }, [jobs, query]);

  const selectedNames = jobs.filter((j) => selected.includes(j.id)).map((j) => j.name);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex h-[34px] w-full items-center justify-between rounded-[7px] border border-border-input bg-bg-inset px-[11px] text-left text-[12.5px] outline-none focus:border-border-focus focus:ring-2 focus:ring-white/[0.04]"
        >
          <span className={cn("truncate", selectedNames.length === 0 && "text-text-quiet")}>
            {selectedNames.length === 0
              ? "None"
              : selectedNames.length <= 2
                ? selectedNames.join(", ")
                : `${selectedNames.length} selected`}
          </span>
          <ChevronDown size={12} className="shrink-0 text-text-quiet" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 w-[--radix-popover-trigger-width] min-w-[240px] overflow-hidden rounded-[8px] border border-border-elevated bg-bg-raised shadow-2xl"
        >
          <div className="flex items-center gap-1.5 border-b border-border-faint px-2.5 py-2">
            <Search size={11} className="shrink-0 text-text-ghost" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search jobs…"
              className="w-full bg-transparent text-[12px] text-text-primary placeholder:text-text-quiet outline-none"
            />
          </div>
          <div className="max-h-[220px] overflow-y-auto p-1">
            {filtered.length === 0 && (
              <div className="px-2.5 py-2 text-[11.5px] text-text-quiet">No matching jobs.</div>
            )}
            {filtered.map((job) => {
              const checked = selected.includes(job.id);
              return (
                <label
                  key={job.id}
                  className="flex cursor-pointer items-center gap-2.5 rounded-[5px] px-2.5 py-1.5 text-[12.5px] text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                >
                  <span
                    className={cn(
                      "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border",
                      checked ? "border-inverse-bg bg-inverse-bg text-inverse-text" : "border-border-control",
                    )}
                  >
                    {checked && <Check size={10} strokeWidth={3} />}
                  </span>
                  <input type="checkbox" checked={checked} onChange={() => onToggle(job.id)} className="hidden" />
                  <span className="truncate">{job.name}</span>
                </label>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
