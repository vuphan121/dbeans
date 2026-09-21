import { create } from "zustand";

export interface ToastAction {
  label: string;
  onAction: () => void | Promise<void>;
}

export interface Toast {
  id: string;
  message: string;
  action?: ToastAction;
}

interface ToastState {
  toast: Toast | null;
  show: (message: string, action?: ToastAction) => void;
  dismiss: () => void;
}

const TOAST_MS = 8000;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;

// A single-slot toast (one at a time, replacing whatever's showing) is all
// the app currently needs it for — the Data editor's post-mutation "Undo"
// prompt. Auto-dismisses after TOAST_MS unless replaced or dismissed first.
export const useToastStore = create<ToastState>()((set) => ({
  toast: null,
  show: (message, action) => {
    const id = `toast_${Date.now().toString(36)}`;
    if (dismissTimer) clearTimeout(dismissTimer);
    set({ toast: { id, message, action } });
    dismissTimer = setTimeout(() => {
      set((s) => (s.toast?.id === id ? { toast: null } : s));
    }, TOAST_MS);
  },
  dismiss: () => {
    if (dismissTimer) clearTimeout(dismissTimer);
    set({ toast: null });
  },
}));
