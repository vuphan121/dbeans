import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ConnectionFields, SavedConnection } from "@/lib/types";
import { SEED_CONNECTIONS } from "@/mock/connectionFixtures";

interface ConnectionsState {
  connections: SavedConnection[];
  activeConnectionId: string | null;
  addConnection: (name: string, fields: ConnectionFields, dsn: string) => SavedConnection;
  removeConnection: (id: string) => void;
  setActiveConnection: (id: string) => void;
  getActiveConnection: () => SavedConnection | undefined;
}

export const useConnectionsStore = create<ConnectionsState>()(
  persist(
    (set, get) => ({
      connections: SEED_CONNECTIONS,
      activeConnectionId: SEED_CONNECTIONS[0]?.id ?? null,

      addConnection: (name, fields, dsn) => {
        const conn: SavedConnection = {
          id: `conn_${Date.now().toString(36)}`,
          name,
          engine: fields.engine,
          dsn,
          lastUsed: "just now",
          fields,
        };
        set((s) => ({ connections: [...s.connections, conn] }));
        return conn;
      },

      removeConnection: (id) =>
        set((s) => ({
          connections: s.connections.filter((c) => c.id !== id),
          activeConnectionId: s.activeConnectionId === id ? null : s.activeConnectionId,
        })),

      setActiveConnection: (id) => set({ activeConnectionId: id }),

      getActiveConnection: () => get().connections.find((c) => c.id === get().activeConnectionId),
    }),
    { name: "dbeans.connections" },
  ),
);
