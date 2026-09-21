import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { DataViewConfig } from "@/lib/types";

// What the Data view remembers for one table between visits: the applied
// view plus column widths (which are a local display preference, not part of
// a saved view).
export interface RememberedView extends DataViewConfig {
  widths: Record<string, number>;
}

interface ConnectionMemory {
  /** "schema.table" the Data view was last showing. */
  lastTable: string;
  /** Most recently viewed first. */
  recent: string[];
  favorites: string[];
  tables: Record<string, RememberedView>;
}

interface DataViewState {
  byConnection: Record<string, ConnectionMemory>;
  remember: (connectionId: string, tableKey: string, view: RememberedView) => void;
  toggleFavorite: (connectionId: string, tableKey: string) => void;
}

const MAX_RECENT = 8;
const MAX_REMEMBERED_TABLES = 40;

const emptyMemory = (): ConnectionMemory => ({ lastTable: "", recent: [], favorites: [], tables: {} });

// The Data view's per-connection memory — last table, per-table
// filter/sort/page-size/column layout, recent and favorite tables. This is
// device-local convenience state (like the graphs date range), kept in
// localStorage; named saved views, which should follow the user across
// browsers, live on the server (state/savedViews.ts).
export const useDataViewStore = create<DataViewState>()(
  persist(
    (set) => ({
      byConnection: {},

      remember: (connectionId, tableKey, view) =>
        set((s) => {
          const memory = s.byConnection[connectionId] ?? emptyMemory();
          const recent = [tableKey, ...memory.recent.filter((k) => k !== tableKey)].slice(0, MAX_RECENT);
          const tables = { ...memory.tables, [tableKey]: view };
          // Keep the map bounded: once over the cap, forget the oldest tables
          // that are neither recent nor favorite.
          const keep = new Set([...recent, ...memory.favorites]);
          for (const key of Object.keys(tables)) {
            if (Object.keys(tables).length <= MAX_REMEMBERED_TABLES) break;
            if (!keep.has(key)) delete tables[key];
          }
          return { byConnection: { ...s.byConnection, [connectionId]: { ...memory, lastTable: tableKey, recent, tables } } };
        }),

      toggleFavorite: (connectionId, tableKey) =>
        set((s) => {
          const memory = s.byConnection[connectionId] ?? emptyMemory();
          const favorites = memory.favorites.includes(tableKey) ? memory.favorites.filter((k) => k !== tableKey) : [...memory.favorites, tableKey];
          return { byConnection: { ...s.byConnection, [connectionId]: { ...memory, favorites } } };
        }),
    }),
    { name: "dbeans.dataview.v1" },
  ),
);
