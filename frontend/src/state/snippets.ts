import { create } from "zustand";
import { persist } from "zustand/middleware";
import { SNIPPETS } from "@/mock/sqlFixtures";

export interface Snippet {
  id: string;
  name: string;
  sql: string;
  used: string;
}

interface SnippetsState {
  snippets: Snippet[];
  addSnippet: (name: string, sql: string) => void;
  removeSnippet: (id: string) => void;
}

export const useSnippetsStore = create<SnippetsState>()(
  persist(
    (set) => ({
      snippets: SNIPPETS,
      addSnippet: (name, sql) =>
        set((s) => ({
          snippets: [
            ...s.snippets,
            { id: `snip_${Date.now().toString(36)}`, name, sql, used: "just now" },
          ],
        })),
      removeSnippet: (id) => set((s) => ({ snippets: s.snippets.filter((sn) => sn.id !== id) })),
    }),
    { name: "dbeans.snippets" },
  ),
);
