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
}

const initialTabs: WorkbenchTab[] = [
  { id: "tab_1", kind: "sql", title: "churn_by_plan", sql: DEFAULT_QUERY },
  { id: "tab_2", kind: "table", title: "public.users" },
  { id: "tab_3", kind: "sql", title: "untitled 3", dirty: true, sql: "" },
];

export const useWorkbenchStore = create<WorkbenchState>()((set) => ({
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
}));
