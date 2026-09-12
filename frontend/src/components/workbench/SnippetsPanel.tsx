import { useState } from "react";
import { ChevronRight, ChevronDown, Plus, FileCode2, Check, X } from "lucide-react";
import { useSnippetsStore } from "@/state/snippets";
import { useWorkbenchStore } from "@/state/workbench";

export function SnippetsPanel() {
  const [open, setOpen] = useState(true);
  const [naming, setNaming] = useState(false);
  const [draftName, setDraftName] = useState("");
  const { snippets, addSnippet } = useSnippetsStore();
  const { tabs, activeTabId, openSnippet } = useWorkbenchStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const canSaveCurrent = !!activeTab?.sql?.trim();

  function startNaming() {
    if (!canSaveCurrent) return;
    setDraftName(activeTab?.title && activeTab.title !== "untitled 1" ? activeTab.title : "");
    setNaming(true);
    setOpen(true);
  }

  function commitSave() {
    const name = draftName.trim();
    if (name && activeTab?.sql) {
      addSnippet(name, activeTab.sql);
    }
    setNaming(false);
    setDraftName("");
  }

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
          <span className="text-[11px] font-medium text-text-faint">Snippets</span>
          <span className="text-[10px] text-text-ghost">{snippets.length}</span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            startNaming();
          }}
          disabled={!canSaveCurrent}
          title="Save current query as a snippet"
          className="flex h-5 w-5 items-center justify-center rounded-[4px] text-text-faint hover:bg-bg-hover hover:text-text-secondary disabled:pointer-events-none disabled:opacity-30"
        >
          <Plus size={12} />
        </button>
      </div>

      {open && (
        <div className="max-h-[180px] overflow-y-auto pb-1.5">
          {naming && (
            <div className="flex items-center gap-1 px-2.5 py-1">
              <input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitSave();
                  if (e.key === "Escape") setNaming(false);
                }}
                placeholder="Snippet name…"
                className="h-6 flex-1 rounded-[4px] border border-border-focus bg-bg-inset px-1.5 text-[11px] text-text-primary outline-none"
              />
              <button onClick={commitSave} className="text-success-dim hover:text-success-text">
                <Check size={12} />
              </button>
              <button onClick={() => setNaming(false)} className="text-text-quiet hover:text-error-dim">
                <X size={12} />
              </button>
            </div>
          )}
          {snippets.length === 0 && !naming && (
            <div className="px-2.5 py-1 text-[11px] text-text-quiet">No snippets saved yet.</div>
          )}
          {snippets.map((s) => (
            <div
              key={s.id}
              onDoubleClick={() => openSnippet(s.name, s.sql)}
              title="Double-click to open"
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
