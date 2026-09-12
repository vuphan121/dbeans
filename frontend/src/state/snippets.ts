import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Snippet {
  id: string;
  name: string;
  sql: string;
  used: string;
}

interface SnippetsState {
  snippets: Snippet[];
  addSnippet: (name: string, sql: string) => Snippet;
  updateSnippet: (id: string, sql: string) => void;
  renameSnippet: (id: string, name: string) => void;
  removeSnippet: (id: string) => void;
}

// Storage key was bumped from "dbeans.snippets" to drop browsers that still
// had the old mock-seeded demo snippets cached from before real connections
// existed — new installs and old ones both now correctly start empty.
export const useSnippetsStore = create<SnippetsState>()(
  persist(
    (set) => ({
      snippets: [],

      addSnippet: (name, sql) => {
        const snippet: Snippet = { id: `snip_${Date.now().toString(36)}`, name, sql, used: "just now" };
        set((s) => ({ snippets: [...s.snippets, snippet] }));
        return snippet;
      },

      updateSnippet: (id, sql) =>
        set((s) => ({
          snippets: s.snippets.map((sn) => (sn.id === id ? { ...sn, sql, used: "just now" } : sn)),
        })),

      renameSnippet: (id, name) =>
        set((s) => ({ snippets: s.snippets.map((sn) => (sn.id === id ? { ...sn, name } : sn)) })),

      removeSnippet: (id) => set((s) => ({ snippets: s.snippets.filter((sn) => sn.id !== id) })),
    }),
    { name: "dbeans.snippets.v2" },
  ),
);
