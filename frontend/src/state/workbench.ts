import { create } from "zustand";
import { DEFAULT_QUERY } from "@/mock/sqlFixtures";

export type TabKind = "sql" | "table";

export interface WorkbenchTab {
  id: string;
  kind: TabKind;
  title: string;
  dirty?: boolean;
  sql?: string;
}

interface WorkbenchState {
  tabs: WorkbenchTab[];
  activeTabId: string;
  setActiveTab: (id: string) => void;
  addTab: () => void;
  closeTab: (id: string) => void;
  updateTabSql: (id: string, sql: string) => void;
  openTable: (tableName: string) => void;
  openSnippet: (name: string, sql: string) => void;
}

const initialTabs: WorkbenchTab[] = [
  { id: "tab_1", kind: "sql", title: "churn_by_plan", sql: DEFAULT_QUERY },
  { id: "tab_2", kind: "table", title: "public.users" },
  { id: "tab_3", kind: "sql", title: "untitled 3", dirty: true, sql: "" },
];

export const useWorkbenchStore = create<WorkbenchState>()((set, get) => ({
  tabs: initialTabs,
  activeTabId: "tab_1",

  setActiveTab: (id) => set({ activeTabId: id }),

  addTab: () =>
    set((s) => {
      const id = `tab_${Date.now().toString(36)}`;
      const n = s.tabs.filter((t) => t.kind === "sql").length + 1;
      return {
        tabs: [...s.tabs, { id, kind: "sql", title: `untitled ${n}`, sql: "" }],
        activeTabId: id,
      };
    }),

  closeTab: (id) =>
    set((s) => {
      const remaining = s.tabs.filter((t) => t.id !== id);
      const activeTabId =
        s.activeTabId === id ? (remaining[remaining.length - 1]?.id ?? "") : s.activeTabId;
      return { tabs: remaining, activeTabId };
    }),

  updateTabSql: (id, sql) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, sql, dirty: true } : t)),
    })),

  // "users" has real mock rows, so it opens as a browsable table tab like the
  // design shows. Every other table doesn't have seeded row data yet, so it
  // opens as a prefilled SQL tab instead — still real, just honest about
  // there being no live query engine behind it yet.
  openTable: (tableName) => {
    if (tableName === "users") {
      const existing = get().tabs.find((t) => t.kind === "table" && t.title === "public.users");
      if (existing) {
        set({ activeTabId: existing.id });
        return;
      }
      const id = `tab_${Date.now().toString(36)}`;
      set((s) => ({ tabs: [...s.tabs, { id, kind: "table", title: "public.users" }], activeTabId: id }));
      return;
    }
    const existing = get().tabs.find((t) => t.kind === "sql" && t.title === tableName);
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    const id = `tab_${Date.now().toString(36)}`;
    set((s) => ({
      tabs: [...s.tabs, { id, kind: "sql", title: tableName, sql: `select * from public.${tableName} limit 100;\n` }],
      activeTabId: id,
    }));
  },

  openSnippet: (name, sql) => {
    const existing = get().tabs.find((t) => t.kind === "sql" && t.title === name);
    if (existing) {
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === existing.id ? { ...t, sql } : t)), activeTabId: existing.id }));
      return;
    }
    const id = `tab_${Date.now().toString(36)}`;
    set((s) => ({ tabs: [...s.tabs, { id, kind: "sql", title: name, sql }], activeTabId: id }));
  },
}));
