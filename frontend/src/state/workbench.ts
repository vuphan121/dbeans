import { create } from "zustand";

export type TabKind = "sql" | "table";

export interface WorkbenchTab {
  id: string;
  kind: TabKind;
  title: string;
  dirty?: boolean;
  sql?: string;
  // Set once this tab has been saved as (or opened from) a query. Editing
  // the tab never writes back to the saved query automatically — only an
  // explicit "Save" does that (see TabStrip's context menu).
  snippetId?: string;
}

interface WorkbenchState {
  tabs: WorkbenchTab[];
  activeTabId: string;
  setActiveTab: (id: string) => void;
  addTab: () => void;
  closeTab: (id: string) => void;
  updateTabSql: (id: string, sql: string) => void;
  openTable: (tableName: string) => void;
  openSnippet: (snippetId: string, name: string, sql: string) => void;
  linkTabToSnippet: (tabId: string, snippetId: string, name: string) => void;
  renameTabForSnippet: (tabId: string, name: string) => void;
  unlinkSnippetFromTab: (tabId: string) => void;
}

const initialTabs: WorkbenchTab[] = [{ id: "tab_1", kind: "sql", title: "untitled 1", sql: "" }];

export const useWorkbenchStore = create<WorkbenchState>()((set, get) => ({
  tabs: initialTabs,
  activeTabId: "tab_1",

  setActiveTab: (id) => set({ activeTabId: id }),

  linkTabToSnippet: (tabId, snippetId, name) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, snippetId, title: name } : t)) })),

  renameTabForSnippet: (tabId, name) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, title: name } : t)) })),

  unlinkSnippetFromTab: (tabId) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, snippetId: undefined } : t)) })),

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

  // tableName is a qualified "schema.table" name from the real schema tree.
  // Opens a prefilled, editable SQL tab that browses it — the user still has
  // to hit Run, same as any other query.
  openTable: (tableName) => {
    const existing = get().tabs.find((t) => t.kind === "sql" && t.title === tableName);
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    const [schema, table] = tableName.includes(".") ? tableName.split(".") : ["public", tableName];
    const id = `tab_${Date.now().toString(36)}`;
    set((s) => ({
      tabs: [
        ...s.tabs,
        { id, kind: "sql", title: tableName, sql: `select * from "${schema}"."${table}" limit 200;\n` },
      ],
      activeTabId: id,
    }));
  },

  openSnippet: (snippetId, name, sql) => {
    const existing = get().tabs.find((t) => t.snippetId === snippetId);
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    const id = `tab_${Date.now().toString(36)}`;
    set((s) => ({ tabs: [...s.tabs, { id, kind: "sql", title: name, sql, snippetId }], activeTabId: id }));
  },
}));
