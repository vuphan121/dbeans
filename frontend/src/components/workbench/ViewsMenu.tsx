import { useRef, useState } from "react";
import { Bookmark, BookmarkPlus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/DropdownMenu";
import { Input } from "@/components/ui/Input";
import { errorMessage } from "@/lib/api";
import { describeView } from "@/lib/dataView";
import type { SavedView } from "@/lib/types";
import { Actions, Field, Modal } from "./DataDialogs";

// Named presets for the table being browsed: pick one to apply its filters,
// sort, page size and column layout, rename or delete it, or save what's on
// screen as a new one.
export function ViewsMenu({
  views,
  onApply,
  onSave,
  onRename,
  onDelete,
}: {
  views: SavedView[];
  onApply: (view: SavedView) => void;
  /** Rejects with an ApiError (e.g. a duplicate name) the dialog shows inline. */
  onSave: (name: string) => Promise<void>;
  /** Same contract as onSave; only called when the name actually changed. */
  onRename: (view: SavedView, name: string) => Promise<void>;
  onDelete: (view: SavedView) => Promise<void>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState<SavedView | null>(null);
  // Set when a menu action opens a dialog, so closing the menu doesn't return
  // focus to the Views button and pull it out of the dialog.
  const openingDialog = useRef(false);

  function startRename(view: SavedView) {
    openingDialog.current = true;
    setMenuOpen(false);
    setRenaming(view);
  }

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="secondary"><Bookmark size={12} /> Views{views.length ? ` · ${views.length}` : ""}</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent onCloseAutoFocus={(event) => { if (openingDialog.current) { event.preventDefault(); openingDialog.current = false; } }}>
          <div className="max-h-[280px] min-w-[260px] overflow-y-auto">
            {views.length === 0 && <div className="px-2.5 py-2 text-[11.5px] text-text-faint">No saved views for this table yet.</div>}
            {views.map((view) => (
              <DropdownMenuItem
                key={view.id}
                onSelect={() => onApply(view)}
                // The row buttons below aren't reachable with the arrow keys, so
                // F2 on the highlighted row is the keyboard route to rename.
                onKeyDown={(event) => { if (event.key === "F2") { event.preventDefault(); startRename(view); } }}
                className="group flex items-center gap-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate">{view.name}</div>
                  <div className="truncate text-[10.5px] text-text-ghost">{describeView(view.config)}</div>
                </div>
                <button
                  type="button"
                  aria-label={`Rename view ${view.name}`}
                  title="Rename (F2)"
                  onClick={(e) => {
                    e.stopPropagation();
                    startRename(view);
                  }}
                  className="shrink-0 rounded p-1 text-text-ghost opacity-0 hover:bg-bg-active hover:text-text-primary group-data-[highlighted]:opacity-100"
                >
                  <Pencil size={11} />
                </button>
                <button
                  type="button"
                  aria-label={`Delete view ${view.name}`}
                  title="Delete"
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
      {saving && (
        <NameDialog
          title="Save view"
          hint="Saves the applied filters, sort, rows per page, and column layout for this table."
          placeholder="e.g. Failed payments this week"
          submitLabel="Save view"
          busyLabel="Saving…"
          failure="Could not save the view."
          onClose={() => setSaving(false)}
          onSubmit={onSave}
        />
      )}
      {renaming && (
        <NameDialog
          title="Rename view"
          initial={renaming.name}
          submitLabel="Rename"
          busyLabel="Renaming…"
          failure="Could not rename the view."
          onClose={() => setRenaming(null)}
          // Renaming to the same name is a no-op, not a request the server
          // would have to (harmlessly) accept.
          onSubmit={async (name) => { if (name !== renaming.name) await onRename(renaming, name); }}
        />
      )}
    </>
  );
}

function NameDialog({
  title,
  initial = "",
  hint,
  placeholder,
  submitLabel,
  busyLabel,
  failure,
  onClose,
  onSubmit,
}: {
  title: string;
  initial?: string;
  hint?: string;
  placeholder?: string;
  submitLabel: string;
  busyLabel: string;
  failure: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit(trimmed);
      onClose();
    } catch (err) {
      setError(errorMessage(err, failure));
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} locked={busy} width={420}>
      <div className="space-y-3 p-5">
        <Field label="Name">
          <Input data-autofocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void submit()} placeholder={placeholder} maxLength={100} className="w-full" mono={false} />
        </Field>
        {hint && <p className="text-[11px] leading-4 text-text-faint">{hint}</p>}
        {error && <div className="text-[11.5px] text-error-text">{error}</div>}
      </div>
      <Actions>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={() => void submit()} disabled={busy || !name.trim()}>{busy ? busyLabel : submitLabel}</Button>
      </Actions>
    </Modal>
  );
}
