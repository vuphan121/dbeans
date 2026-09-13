import { create } from "zustand";
import { createRedisKey, deleteRedisKey as apiDeleteRedisKey, listRedisKeys, updateRedisKey, updateRedisTTL } from "@/lib/api";
import type { RedisKeyEntry, RedisValue } from "@/lib/types";

interface RedisState {
  connectionId: string | null; token: string | null; keys: RedisKeyEntry[]; selectedKey: string | null;
  loading: boolean; error: string | null;
  load: (token: string, connectionId: string) => Promise<void>;
  select: (key: string | null) => void;
  updateValue: (key: string, value: RedisValue) => Promise<void>;
  setTtl: (key: string, ttl: number | null) => Promise<void>;
  deleteKey: (key: string) => Promise<void>;
  createKey: (entry: RedisKeyEntry) => Promise<void>;
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Redis operation failed";

export const useRedisStore = create<RedisState>()((set, get) => ({
  connectionId: null, token: null, keys: [], selectedKey: null, loading: false, error: null,
  load: async (token, connectionId) => {
    set({ token, connectionId, keys: [], selectedKey: null, loading: true, error: null });
    try {
      const keys = await listRedisKeys(token, connectionId);
      if (get().connectionId === connectionId) set({ keys, selectedKey: keys[0]?.key ?? null, loading: false });
    } catch (error) { if (get().connectionId === connectionId) set({ loading: false, error: errorMessage(error) }); }
  },
  select: (selectedKey) => set({ selectedKey }),
  updateValue: async (key, value) => {
    const { token, connectionId, keys } = get(); if (!token || !connectionId) return;
    const previous = keys.find((entry) => entry.key === key); if (!previous) return;
    set({ error: null });
    try {
      const saved = await updateRedisKey(token, connectionId, { ...previous, value });
      set((state) => ({ keys: state.keys.map((entry) => entry.key === key ? saved : entry) }));
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },
  setTtl: async (key, ttl) => {
    const { token, connectionId, keys } = get(); if (!token || !connectionId) return;
    const previous = keys.find((entry) => entry.key === key)?.ttl ?? null;
    set({ keys: keys.map((entry) => entry.key === key ? { ...entry, ttl } : entry), error: null });
    try { await updateRedisTTL(token, connectionId, key, ttl); }
    catch (error) { set((state) => ({ keys: state.keys.map((entry) => entry.key === key ? { ...entry, ttl: previous } : entry), error: errorMessage(error) })); }
  },
  deleteKey: async (key) => {
    const { token, connectionId } = get(); if (!token || !connectionId) return;
    try {
      await apiDeleteRedisKey(token, connectionId, key);
      set((state) => { const keys = state.keys.filter((entry) => entry.key !== key); return { keys, selectedKey: state.selectedKey === key ? (keys[0]?.key ?? null) : state.selectedKey, error: null }; });
    } catch (error) { set({ error: errorMessage(error) }); }
  },
  createKey: async (entry) => {
    const { token, connectionId } = get(); if (!token || !connectionId) return;
    try { const created = await createRedisKey(token, connectionId, entry); set((state) => ({ keys: [created, ...state.keys], selectedKey: created.key, error: null })); }
    catch (error) { set({ error: errorMessage(error) }); throw error; }
  },
}));
