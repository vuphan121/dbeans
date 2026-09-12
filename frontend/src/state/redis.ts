import { create } from "zustand";
import { REDIS_KEYS, type RedisKeyEntry, type RedisValue } from "@/mock/redisFixtures";

interface RedisState {
  keys: RedisKeyEntry[];
  selectedKey: string | null;
  select: (key: string | null) => void;
  updateValue: (key: string, value: RedisValue) => void;
  setTtl: (key: string, ttl: number | null) => void;
  deleteKey: (key: string) => void;
  createKey: (entry: RedisKeyEntry) => void;
}

export const useRedisStore = create<RedisState>()((set) => ({
  keys: REDIS_KEYS,
  selectedKey: REDIS_KEYS[0]?.key ?? null,

  select: (key) => set({ selectedKey: key }),

  updateValue: (key, value) =>
    set((s) => ({ keys: s.keys.map((k) => (k.key === key ? { ...k, value } : k)) })),

  setTtl: (key, ttl) => set((s) => ({ keys: s.keys.map((k) => (k.key === key ? { ...k, ttl } : k)) })),

  deleteKey: (key) =>
    set((s) => ({
      keys: s.keys.filter((k) => k.key !== key),
      selectedKey: s.selectedKey === key ? (s.keys.find((k) => k.key !== key)?.key ?? null) : s.selectedKey,
    })),

  createKey: (entry) => set((s) => ({ keys: [entry, ...s.keys], selectedKey: entry.key })),
}));
