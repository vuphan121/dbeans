import { create } from "zustand";
import type { CardLayout, ConnectionFields, SavedConnection } from "@/lib/types";
import { useAuthStore } from "@/state/auth";
import * as api from "@/lib/api";

const CARD_W = 280;
const CARD_H = 148;
const GAP = 40;
const COLS = 3;
const START = { x: 80, y: 80 };

function nextLayout(existingCount: number): CardLayout {
  const col = existingCount % COLS;
  const row = Math.floor(existingCount / COLS);
  return {
    x: START.x + col * (CARD_W + GAP),
    y: START.y + row * (CARD_H + GAP),
    width: CARD_W,
    height: CARD_H,
  };
}

interface ConnectionsState {
  connections: SavedConnection[];
  activeConnectionId: string | null;
  loaded: boolean;
  loadConnections: () => Promise<void>;
  addConnection: (name: string, fields: ConnectionFields, dsn: string) => SavedConnection;
  removeConnection: (id: string) => void;
  setActiveConnection: (id: string) => void;
  getActiveConnection: () => SavedConnection | undefined;
  updateLayout: (id: string, layout: CardLayout) => void;
}

export const useConnectionsStore = create<ConnectionsState>()((set, get) => ({
  connections: [],
  activeConnectionId: null,
  loaded: false,

  // Connections live in dbeans' own Postgres database now, scoped per
  // account — not localStorage, not seeded mock data. This fetches the
  // signed-in user's saved connections.
  loadConnections: async () => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    try {
      const connections = await api.listConnections(token);
      set((s) => ({
        connections,
        loaded: true,
        activeConnectionId: s.activeConnectionId ?? connections[0]?.id ?? null,
      }));
    } catch {
      set({ loaded: true });
    }
  },

  addConnection: (name, fields, dsn) => {
    const conn: SavedConnection = {
      id: `conn_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name,
      engine: fields.engine,
      dsn,
      lastUsed: "just now",
      fields,
      layout: nextLayout(get().connections.length),
    };
    set((s) => ({ connections: [...s.connections, conn] }));
    const token = useAuthStore.getState().token;
    if (token) api.createConnection(token, conn).catch(() => {});
    return conn;
  },

  removeConnection: (id) => {
    set((s) => ({
      connections: s.connections.filter((c) => c.id !== id),
      activeConnectionId: s.activeConnectionId === id ? null : s.activeConnectionId,
    }));
    const token = useAuthStore.getState().token;
    if (token) api.deleteConnection(token, id).catch(() => {});
  },

  setActiveConnection: (id) => set({ activeConnectionId: id }),

  getActiveConnection: () => get().connections.find((c) => c.id === get().activeConnectionId),

  updateLayout: (id, layout) => {
    set((s) => ({
      connections: s.connections.map((c) => (c.id === id ? { ...c, layout } : c)),
    }));
    const token = useAuthStore.getState().token;
    if (token) api.updateConnectionLayout(token, id, layout).catch(() => {});
  },
}));
