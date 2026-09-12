import { create } from "zustand";
import type { CardLayout, ConnectionFields, SavedConnection } from "@/lib/types";
import { useAuthStore } from "@/state/auth";
import { FIELD_CENTER, GRID_UNIT, snapToGrid } from "@/lib/canvasBounds";
import * as api from "@/lib/api";

const CARD_W = GRID_UNIT * 7; // 280
const CARD_H = GRID_UNIT * 4; // 160
const GAP = GRID_UNIT;

// New cards fill outward from the center of the field (center, then each
// ring around it) instead of stacking into a corner. Covers the first 21
// cards explicitly; beyond that it just wraps into further rows, which is
// plenty for a personal tool's connection count.
const CENTER_FILL_ORDER: [number, number][] = [
  [0, 0],
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [2, 0], [-2, 0], [0, 2], [0, -2],
  [2, 1], [-2, 1], [2, -1], [-2, -1],
  [1, 2], [-1, 2], [1, -2], [-1, -2],
];

function nextLayout(existingCount: number): CardLayout {
  const [colOffset, rowOffset] =
    CENTER_FILL_ORDER[existingCount] ?? [(existingCount % 5) - 2, 3 + Math.floor(existingCount / 5)];
  return {
    x: snapToGrid(FIELD_CENTER.x + colOffset * (CARD_W + GAP) - CARD_W / 2),
    y: snapToGrid(FIELD_CENTER.y + rowOffset * (CARD_H + GAP) - CARD_H / 2),
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
  pingConnection: (id: string) => Promise<void>;
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

  // The server owns the ~60s cache, so this is cheap to call on every page
  // load — a repeat call within the window just echoes back the cached
  // status instead of re-checking.
  pingConnection: async (id) => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    try {
      const result = await api.pingConnection(token, id);
      set((s) => ({
        connections: s.connections.map((c) =>
          c.id === id ? { ...c, status: result.status, lastCheckedAt: result.lastCheckedAt } : c,
        ),
      }));
    } catch {
      /* best-effort — leave the last known status in place */
    }
  },
}));
