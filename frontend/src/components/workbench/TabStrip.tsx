import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Plus, X } from "lucide-react";
import { useWorkbenchStore, type WorkbenchTab } from "@/state/workbench";
import { useSnippetsStore } from "@/state/snippets";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/ContextMenu";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";

export function TabStrip() {
  const { tabs, activeTabId, setActiveTab, addTab, closeTab, linkTabToSnippet, renameTabForSnippet, unlinkSnippetFromTab } =
    useWorkbenchStore();
  const { snippets, addSnippet, updateSnippet, renameSnippet, removeSnippet } = useSnippetsStore();
  const [pendingCloseTab, setPendingCloseTab] = useState<WorkbenchTab | null>(null);
  const [pendingDeleteTab, setPendingDeleteTab] = useState<WorkbenchTab | null>(null);
  const [renameTab, setRenameTab] = useState<WorkbenchTab | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  function snippetFor(tab: WorkbenchTab) {
    return tab.snippetId ? snippets.find((s) => s.id === tab.snippetId) : undefined;
  }

  // Saving never prompts for a name — it uses the tab's current title
  // as-is (e.g. "untitled 1"), so it's a single click. Use "Rename" first
  // (or after) if you want something more descriptive.
  function handleSave(tab: WorkbenchTab) {
    if (!tab.sql?.trim()) return;
    if (tab.snippetId) {
      updateSnippet(tab.snippetId, tab.sql);
    } else {
      const snippet = addSnippet(tab.title, tab.sql);
      linkTabToSnippet(tab.id, snippet.id, tab.title);
    }
  }

  function openRename(tab: WorkbenchTab) {
    setRenameDraft(tab.title);
    setRenameTab(tab);
  }

  function confirmRename() {
    const name = renameDraft.trim();
    if (!renameTab || !name) {
      setRenameTab(null);
      return;
    }
    if (renameTab.snippetId) renameSnippet(renameTab.snippetId, name);
    renameTabForSnippet(renameTab.id, name);
    setRenameTab(null);
  }

  // Deleting a tab that was never saved just closes it (same as the ×
  // button) — there's no saved query to lose, so nothing to confirm.
  function requestDelete(tab: WorkbenchTab) {
    if (tab.snippetId) {
      setPendingDeleteTab(tab);
    } else {
      closeTab(tab.id);
    }
  }

  function confirmDelete() {
    if (!pendingDeleteTab?.snippetId) return;
    removeSnippet(pendingDeleteTab.snippetId);
    unlinkSnippetFromTab(pendingDeleteTab.id);
    closeTab(pendingDeleteTab.id);
    setPendingDeleteTab(null);
  }

  // Closing a tab that was saved, but whose current SQL no longer matches
  // what's saved, asks first — plain scratch tabs (never saved) just close
  // immediately.
  function requestClose(tab: WorkbenchTab) {
    const snippet = snippetFor(tab);
    if (snippet && snippet.sql !== (tab.sql ?? "")) {
      setPendingCloseTab(tab);
      return;
    }
    closeTab(tab.id);
  }

  function confirmSaveAndClose() {
    if (!pendingCloseTab?.snippetId) return;
    updateSnippet(pendingCloseTab.snippetId, pendingCloseTab.sql ?? "");
    closeTab(pendingCloseTab.id);
    setPendingCloseTab(null);
  }

  function confirmDiscardAndClose() {
    if (!pendingCloseTab) return;
    closeTab(pendingCloseTab.id);
    setPendingCloseTab(null);
  }

  return (
    <div className="flex flex-1 items-end gap-0.5 overflow-x-auto px-2">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        const canSave = !!tab.sql?.trim();
        return (
          <ContextMenu key={tab.id}>
            <ContextMenuTrigger asChild>
              <div
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
                <span className="relative flex h-[11px] w-[11px] shrink-0 items-center justify-center">
                  {tab.dirty && (
                    <span className="pointer-events-none absolute h-[5px] w-[5px] rounded-full bg-text-faint group-hover:opacity-0" />
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      requestClose(tab);
                    }}
                    className="absolute text-text-quiet opacity-0 hover:text-text-secondary group-hover:opacity-100"
                  >
                    <X size={11} />
                  </button>
                </span>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem
                onClick={() => canSave && handleSave(tab)}
                className={!canSave ? "pointer-events-none opacity-40" : undefined}
              >
                Save
              </ContextMenuItem>
              <ContextMenuItem onClick={() => openRename(tab)}>Rename</ContextMenuItem>
              <ContextMenuItem
                onClick={() => requestDelete(tab)}
                className="text-error-dim data-[highlighted]:text-error-text"
              >
                Delete
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
      <button
        onClick={addTab}
        className="flex h-[33px] w-7 shrink-0 items-center justify-center text-text-faint hover:text-text-secondary"
      >
        <Plus size={14} />
      </button>

      <Dialog.Root open={!!renameTab} onOpenChange={(v) => !v && setRenameTab(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed left-1/2 top-1/2 z-50 w-[380px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border-elevated bg-bg-raised p-5 shadow-2xl"
          >
            <Dialog.Title className="text-[14px] font-semibold text-text-primary">Rename</Dialog.Title>
            <Input
              autoFocus
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmRename();
                if (e.key === "Escape") setRenameTab(null);
              }}
              className="mt-3 w-full"
            />
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setRenameTab(null)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={confirmRename} disabled={!renameDraft.trim()}>
                Rename
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={!!pendingCloseTab} onOpenChange={(v) => !v && setPendingCloseTab(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed left-1/2 top-1/2 z-50 w-[380px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border-elevated bg-bg-raised p-5 shadow-2xl"
          >
            <Dialog.Title className="text-[14px] font-semibold text-text-primary">Save changes?</Dialog.Title>
            <div className="mt-2 text-[12.5px] text-text-faint">
              "{pendingCloseTab?.title}" has unsaved changes. Save them before closing this tab?
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setPendingCloseTab(null)}>
                Cancel
              </Button>
              <Button variant="secondary" size="sm" onClick={confirmDiscardAndClose}>
                Don't save
              </Button>
              <Button variant="primary" size="sm" onClick={confirmSaveAndClose}>
                Save
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={!!pendingDeleteTab} onOpenChange={(v) => !v && setPendingDeleteTab(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed left-1/2 top-1/2 z-50 w-[380px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border-elevated bg-bg-raised p-5 shadow-2xl"
          >
            <Dialog.Title className="text-[14px] font-semibold text-text-primary">Delete query?</Dialog.Title>
            <div className="mt-2 text-[12.5px] text-text-faint">
              "{pendingDeleteTab?.title}" will be permanently deleted and its tab closed. This can't be undone.
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setPendingDeleteTab(null)}>
                Cancel
              </Button>
              <Button variant="danger" size="sm" onClick={confirmDelete}>
                Delete
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
