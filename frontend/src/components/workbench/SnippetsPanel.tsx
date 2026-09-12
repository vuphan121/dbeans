import { useState } from "react";
import { ChevronRight, ChevronDown, FileCode2 } from "lucide-react";
import { useSnippetsStore } from "@/state/snippets";
import { useWorkbenchStore } from "@/state/workbench";

export function SnippetsPanel() {
  const [open, setOpen] = useState(true);
  const { snippets } = useSnippetsStore();
  const { openSnippet } = useWorkbenchStore();

  return (
    <div className="border-t border-border-faint">
      <div
        onClick={() => setOpen((v) => !v)}
        className="flex h-[34px] cursor-pointer items-center justify-between px-2.5 hover:bg-bg-hover/60"
      >
        <div className="flex items-center gap-1.5">
          {open ? (
            <ChevronDown size={9} className="text-text-muted" />
          ) : (
            <ChevronRight size={9} className="text-text-muted" />
          )}
          <span className="text-[11px] font-medium text-text-faint">Queries</span>
          <span className="text-[10px] text-text-ghost">{snippets.length}</span>
        </div>
      </div>

      {open && (
        <div className="max-h-[180px] overflow-y-auto pb-1.5">
          {snippets.length === 0 && (
            <div className="px-2.5 py-1 text-[11px] text-text-quiet">No queries saved yet.</div>
          )}
          {snippets.map((s) => (
            <div
              key={s.id}
              onClick={() => openSnippet(s.id, s.name, s.sql)}
              title="Open in a tab"
              className="flex h-6 cursor-pointer items-center gap-1.5 px-2.5 hover:bg-bg-hover/60"
            >
              <FileCode2 size={10} className="shrink-0 text-text-ghost" />
              <span className="truncate text-[11px] text-text-secondary">{s.name}</span>
              <span className="ml-auto shrink-0 text-[10px] text-text-quiet">{s.used}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
