import { useRef, useState } from "react";
import { Bookmark, BookmarkPlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/DropdownMenu";
import { Input } from "@/components/ui/Input";
import { errorMessage } from "@/lib/api";
import { describeView } from "@/lib/dataView";
import type { SavedView } from "@/lib/types";
import { Actions, Field, Modal } from "./DataDialogs";

// Named presets for the table being browsed: pick one to apply its filters,
// sort, page size and column layout, or save what's on screen as a new one.
export function ViewsMenu({
  views,
  onApply,
  onSave,
  onDelete,
}: {
  views: SavedView[];
  onApply: (view: SavedView) => void;
  /** Rejects with an ApiError (e.g. a duplicate name) the dialog shows inline. */
  onSave: (name: string) => Promise<void>;
  onDelete: (view: SavedView) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  // Set when a menu item opens the save dialog, so closing the menu doesn't
  // return focus to the Views button and pull it out of the dialog.
  const openingDialog = useRef(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="secondary"><Bookmark size={12} /> Views{views.length ? ` · ${views.length}` : ""}</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent onCloseAutoFocus={(event) => { if (openingDialog.current) { event.preventDefault(); openingDialog.current = false; } }}>
          <div className="max-h-[280px] min-w-[240px] overflow-y-auto">
            {views.length === 0 && <div className="px-2.5 py-2 text-[11.5px] text-text-faint">No saved views for this table yet.</div>}
            {views.map((view) => (
              <DropdownMenuItem key={view.id} onSelect={() => onApply(view)} className="group flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate">{view.name}</div>
                  <div className="truncate text-[10.5px] text-text-ghost">{describeView(view.config)}</div>
                </div>
                <button
                  type="button"
                  aria-label={`Delete view ${view.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void onDelete(view);
                  }}
                  className="shrink-0 rounded p-1 text-text-ghost opacity-0 hover:bg-error-bg hover:text-error-text group-data-[highlighted]:opacity-100"
                >
                  <Trash2 size={11} />
                </button>
              </DropdownMenuItem>
            ))}
          </div>
          <div className="my-1 h-px bg-border-default" />
          <DropdownMenuItem onSelect={() => { openingDialog.current = true; setSaving(true); }} className="flex items-center gap-2"><BookmarkPlus size={12} /> Save current view…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {saving && <SaveViewDialog onClose={() => setSaving(false)} onSave={onSave} />}
    </>
  );
}

function SaveViewDialog({ onClose, onSave }: { onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError("");
    try {
      await onSave(trimmed);
      onClose();
    } catch (err) {
      setError(errorMessage(err, "Could not save the view."));
      setBusy(false);
    }
  }

  return (
    <Modal title="Save view" onClose={onClose} locked={busy} width={420}>
      <div className="space-y-3 p-5">
        <Field label="Name">
          <Input data-autofocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void submit()} placeholder="e.g. Failed payments this week" maxLength={100} className="w-full" mono={false} />
        </Field>
        <p className="text-[11px] leading-4 text-text-faint">Saves the applied filters, sort, rows per page, and column layout for this table.</p>
        {error && <div className="text-[11.5px] text-error-text">{error}</div>}
      </div>
      <Actions>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={() => void submit()} disabled={busy || !name.trim()}>{busy ? "Saving…" : "Save view"}</Button>
      </Actions>
    </Modal>
  );
}
