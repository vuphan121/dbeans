import { create } from "zustand";
import type { Secret } from "@/lib/types";
import { useAuthStore } from "@/state/auth";
import * as api from "@/lib/api";

interface SecretsState {
  secrets: Secret[];
  loaded: boolean;
  loadSecrets: () => Promise<void>;
  addSecret: (name: string, value: string) => Promise<void>;
  editSecret: (id: string, update: { name: string; value?: string }) => Promise<void>;
  removeSecret: (id: string) => void;
}

export const useSecretsStore = create<SecretsState>()((set, get) => ({
  secrets: [],
  loaded: false,

  loadSecrets: async () => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    try {
      const secrets = await api.listSecrets(token);
      set({ secrets, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  addSecret: async (name, value) => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    const id = `secret_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const created = await api.createSecret(token, { id, name, value });
    set((s) => ({ secrets: [...s.secrets, created] }));
  },

  editSecret: async (id, update) => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    const existing = get().secrets.find((s) => s.id === id);
    if (!existing) return;
    await api.updateSecret(token, id, update);
    set((s) => ({ secrets: s.secrets.map((sec) => (sec.id === id ? { ...sec, name: update.name } : sec)) }));
  },

  removeSecret: (id) => {
    set((s) => ({ secrets: s.secrets.filter((sec) => sec.id !== id) }));
    const token = useAuthStore.getState().token;
    if (token) api.deleteSecret(token, id).catch(() => {});
  },
}));
