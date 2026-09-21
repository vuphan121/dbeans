import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToastStore } from "@/state/toast";

// Mounted once near the app root; renders nothing when there's no active toast.
export function ToastHost() {
  const toast = useToastStore((s) => s.toast);
  const dismiss = useToastStore((s) => s.dismiss);
  if (!toast) return null;
  return (
    <div className="fixed bottom-5 left-1/2 z-[100] -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-[9px] border border-border-elevated bg-bg-raised px-4 py-2.5 text-[12.5px] text-text-primary shadow-2xl">
        <span>{toast.message}</span>
        {toast.action && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              void toast.action!.onAction();
              dismiss();
            }}
          >
            {toast.action.label}
          </Button>
        )}
        <button onClick={dismiss} className="text-text-faint hover:text-text-secondary" aria-label="Dismiss">
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
