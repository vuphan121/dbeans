import { create } from "zustand";
import * as api from "@/lib/api";
import { useAuthStore } from "@/state/auth";
import { useToastStore } from "@/state/toast";

export interface Snippet {
  id: string;
  name: string;
  sql: string;
  updatedAt: string;
}

interface SnippetsState {
  snippets: Snippet[];
  loaded: boolean;
  loadSnippets: () => Promise<void>;
  /** Resolves to null (after showing an error toast) if the save failed. */
  addSnippet: (name: string, sql: string) => Promise<Snippet | null>;
  updateSnippet: (id: string, sql: string) => void;
  renameSnippet: (id: string, name: string) => void;
  removeSnippet: (id: string) => void;
}

// Where saved queries lived before they moved to the server (zustand persist's
// storage key). Read once by loadSnippets to migrate them, then removed.
const LEGACY_STORAGE_KEY = "dbeans.snippets.v2";

function readLegacySnippets(): { id: string; name: string; sql: string }[] {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return [];
    const list = (JSON.parse(raw) as { state?: { snippets?: unknown } })?.state?.snippets;
    if (!Array.isArray(list)) return [];
    return list.flatMap((s) =>
      s && typeof s.id === "string" && typeof s.name === "string" && typeof s.sql === "string"
        ? [{ id: s.id, name: s.name, sql: s.sql }]
        : [],
    );
  } catch {
    return [];
  }
}

function clearLegacySnippets() {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* storage blocked — the server-side import is idempotent, so a repeat is harmless */
  }
}

// Saved queries live in the operator database, per user. Edits apply to the
// list immediately and sync in the background; if the server rejects one, the
// list is reloaded from the server so the UI never keeps a change that didn't
// stick.
export const useSnippetsStore = create<SnippetsState>()((set, get) => {
  function failed(message: string) {
    useToastStore.getState().show(message);
    void get().loadSnippets();
  }

  return {
    snippets: [],
    loaded: false,

    loadSnippets: async () => {
      const token = useAuthStore.getState().token;
      if (!token) return;
      try {
        set({ snippets: await api.listSavedQueries(token), loaded: true });
      } catch {
        set({ loaded: true });
        return;
      }
      // One-time migration of queries saved in this browser before saved
      // queries moved server-side. If it fails, they stay in localStorage and
      // are retried on the next load.
      const legacy = readLegacySnippets();
      if (legacy.length) {
        try {
          set({ snippets: await api.importSavedQueries(token, legacy) });
          clearLegacySnippets();
        } catch {
          /* keep them in localStorage for the next attempt */
        }
      }
    },

    addSnippet: async (name, sql) => {
      const token = useAuthStore.getState().token;
      if (!token) return null;
      const id = `snip_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      try {
        const created = await api.createSavedQuery(token, { id, name, sql });
        set((s) => ({ snippets: [...s.snippets, created] }));
        return created;
      } catch (err) {
        useToastStore.getState().show(err instanceof Error ? err.message : "Could not save the query.");
        return null;
      }
    },

    updateSnippet: (id, sql) => {
      const token = useAuthStore.getState().token;
      if (!token) return;
      const updatedAt = new Date().toISOString();
      set((s) => ({ snippets: s.snippets.map((sn) => (sn.id === id ? { ...sn, sql, updatedAt } : sn)) }));
      api.updateSavedQuery(token, id, { sql }).catch(() => failed("Could not save the query."));
    },

    renameSnippet: (id, name) => {
      const token = useAuthStore.getState().token;
      if (!token) return;
      set((s) => ({ snippets: s.snippets.map((sn) => (sn.id === id ? { ...sn, name } : sn)) }));
      api.updateSavedQuery(token, id, { name }).catch(() => failed("Could not rename the query."));
    },

    removeSnippet: (id) => {
      const token = useAuthStore.getState().token;
      if (!token) return;
      set((s) => ({ snippets: s.snippets.filter((sn) => sn.id !== id) }));
      api.deleteSavedQuery(token, id).catch(() => failed("Could not delete the query."));
    },
  };
});
