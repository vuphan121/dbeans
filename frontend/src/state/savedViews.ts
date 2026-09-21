import { create } from "zustand";
import * as api from "@/lib/api";
import type { DataViewConfig, SavedView } from "@/lib/types";
import { useAuthStore } from "@/state/auth";

interface SavedViewsState {
  byConnectionId: Record<string, SavedView[]>;
  loadViews: (connectionId: string) => Promise<void>;
  /** Throws an ApiError (e.g. 409 for a duplicate name) for the caller to show. */
  createView: (connectionId: string, schema: string, table: string, name: string, config: DataViewConfig) => Promise<SavedView>;
  /** Throws an ApiError (e.g. 409 for a name already used on that table) for the caller to show. */
  renameView: (connectionId: string, viewId: string, name: string) => Promise<void>;
  /** Replaces a saved view's filters/sort/columns with the given config. Throws an ApiError for the caller to show. */
  updateViewConfig: (connectionId: string, viewId: string, config: DataViewConfig) => Promise<void>;
  removeView: (connectionId: string, viewId: string) => Promise<void>;
}

// Named Data-browser presets, kept on the server per user + connection so they
// follow the user across browsers. Not optimistic: saving a view is rare and
// a duplicate name has to be reported before the view is shown as saved.
export const useSavedViewsStore = create<SavedViewsState>()((set) => ({
  byConnectionId: {},

  loadViews: async (connectionId) => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    try {
      const views = await api.listSavedViews(token, connectionId);
      set((s) => ({ byConnectionId: { ...s.byConnectionId, [connectionId]: views } }));
    } catch {
      /* the Views menu just stays empty; nothing else depends on it */
    }
  },

  createView: async (connectionId, schema, table, name, config) => {
    const token = useAuthStore.getState().token;
    if (!token) throw new Error("Not signed in.");
    const id = `view_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const view = await api.createSavedView(token, connectionId, { id, schema, table, name, config });
    set((s) => ({ byConnectionId: { ...s.byConnectionId, [connectionId]: [...(s.byConnectionId[connectionId] ?? []), view] } }));
    return view;
  },

  renameView: async (connectionId, viewId, name) => {
    const token = useAuthStore.getState().token;
    if (!token) throw new Error("Not signed in.");
    await api.updateSavedView(token, connectionId, viewId, { name });
    set((s) => ({ byConnectionId: { ...s.byConnectionId, [connectionId]: (s.byConnectionId[connectionId] ?? []).map((v) => (v.id === viewId ? { ...v, name } : v)) } }));
  },

  updateViewConfig: async (connectionId, viewId, config) => {
    const token = useAuthStore.getState().token;
    if (!token) throw new Error("Not signed in.");
    await api.updateSavedView(token, connectionId, viewId, { config });
    const updatedAt = new Date().toISOString();
    set((s) => ({ byConnectionId: { ...s.byConnectionId, [connectionId]: (s.byConnectionId[connectionId] ?? []).map((v) => (v.id === viewId ? { ...v, config, updatedAt } : v)) } }));
  },

  removeView: async (connectionId, viewId) => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    await api.deleteSavedView(token, connectionId, viewId);
    set((s) => ({ byConnectionId: { ...s.byConnectionId, [connectionId]: (s.byConnectionId[connectionId] ?? []).filter((v) => v.id !== viewId) } }));
  },
}));
