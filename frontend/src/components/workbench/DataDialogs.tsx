import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";

// Dialog building blocks shared by the Data view's dialogs (row editor,
// schema tools, import, saved views).

// The close button precedes a Modal's content, so Radix would focus it first.
// A dialog can nominate the field that should take focus instead by marking it
// data-autofocus.
function focusMarkedField(event: Event) {
  const field = (event.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-autofocus]");
  if (!field) return;
  event.preventDefault();
  field.focus();
  if (field instanceof HTMLInputElement) field.select();
}

export function Modal({ title, onClose, locked = false, width = 760, children }: { title: string; onClose: () => void; locked?: boolean; width?: number; children: ReactNode }) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && !locked && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content aria-describedby={undefined} style={{ width }} onOpenAutoFocus={focusMarkedField} className="fixed left-1/2 top-1/2 z-50 max-w-[94vw] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[10px] border border-border-elevated bg-bg-raised shadow-2xl">
          <div className="flex items-center border-b border-border-default px-5 py-4">
            <Dialog.Title className="text-[14px] font-semibold text-text-primary">{title}</Dialog.Title>
            <Dialog.Close className="ml-auto text-text-faint"><X size={15} /></Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Confirm({ title, body, confirm, tone = "danger", loading, onCancel, onConfirm }: { title: string; body: string; confirm: string; tone?: "danger" | "primary"; loading: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && !loading && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[70] w-[420px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-[10px] border border-border-elevated bg-bg-raised p-5 shadow-2xl">
          <Dialog.Title className="text-[14px] font-semibold text-text-primary">{title}</Dialog.Title>
          <p className="mt-2 text-[12px] leading-5 text-text-muted">{body}</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={onCancel} disabled={loading}>Cancel</Button>
            <Button variant={tone} onClick={onConfirm} disabled={loading}>{loading ? "Working…" : confirm}</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Actions({ children }: { children: ReactNode }) {
  return <div className="flex justify-end gap-2 border-t border-border-default px-5 py-3.5">{children}</div>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-[11px] text-text-faint">{label}</span>{children}</label>;
}

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex items-center gap-2 text-[11.5px] text-text-muted"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}</label>;
}
