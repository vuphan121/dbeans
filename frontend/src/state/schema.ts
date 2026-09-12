import { create } from "zustand";
import type { ConnectionSchema } from "@/lib/types";
import { useAuthStore } from "@/state/auth";
import * as api from "@/lib/api";

interface SchemaEntry {
  status: "loading" | "ready" | "error";
  schema?: ConnectionSchema;
  error?: string;
}

interface SchemaState {
  byConnectionId: Record<string, SchemaEntry>;
  loadSchema: (connectionId: string) => Promise<void>;
}

// Real schema introspection, fetched per connection and cached until an
// explicit reload (e.g. the schema tree's refresh button) — replaces the
// previous hardcoded mock table/column list entirely.
export const useSchemaStore = create<SchemaState>()((set) => ({
  byConnectionId: {},

  loadSchema: async (connectionId) => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    set((s) => ({
      byConnectionId: { ...s.byConnectionId, [connectionId]: { status: "loading" } },
    }));
    try {
      const schema = await api.getConnectionSchema(token, connectionId);
      set((s) => ({
        byConnectionId: { ...s.byConnectionId, [connectionId]: { status: "ready", schema } },
      }));
    } catch (err) {
      set((s) => ({
        byConnectionId: {
          ...s.byConnectionId,
          [connectionId]: {
            status: "error",
            error: err instanceof Error ? err.message : "failed to load schema",
          },
        },
      }));
    }
  },
}));
