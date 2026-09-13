import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ApiError, login as apiLogin, logout as apiLogout, me as apiMe, trackEvent } from "@/lib/api";

const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 60;

interface AuthState {
  isUnlocked: boolean;
  username: string | null;
  token: string | null;
  attemptsRemaining: number;
  lockedUntil: number | null; // epoch ms
  error: string | null;
  checking: boolean;
  attemptUnlock: (username: string, password: string) => Promise<boolean>;
  restoreSession: () => Promise<void>;
  lock: () => void;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      isUnlocked: false,
      username: null,
      token: null,
      attemptsRemaining: MAX_ATTEMPTS,
      lockedUntil: null,
      error: null,
      checking: true,

      attemptUnlock: async (username, password) => {
        const { lockedUntil } = get();
        if (lockedUntil) {
          if (Date.now() < lockedUntil) return false;
          set({ lockedUntil: null, attemptsRemaining: MAX_ATTEMPTS, error: null });
        }
        try {
          const res = await apiLogin(username, password);
          set({
            isUnlocked: true,
            username: res.username,
            token: res.token,
            attemptsRemaining: MAX_ATTEMPTS,
            lockedUntil: null,
            error: null,
          });
          trackEvent(res.token, "login", { username: res.username });
          return true;
        } catch (e) {
          const remaining = get().attemptsRemaining - 1;
          if (remaining <= 0) {
            set({
              attemptsRemaining: 0,
              lockedUntil: Date.now() + LOCKOUT_SECONDS * 1000,
              error: "Too many attempts",
            });
          } else {
            const msg = e instanceof ApiError ? "Username or password didn't match" : "Could not reach dbeans server";
            set({ attemptsRemaining: remaining, error: msg });
          }
          return false;
        }
      },

      restoreSession: async () => {
        const token = get().token;
        if (!token) {
          set({ checking: false });
          return;
        }
        try {
          const res = await apiMe(token);
          set({ isUnlocked: true, username: res.username, checking: false });
        } catch {
          set({ isUnlocked: false, username: null, token: null, checking: false });
        }
      },

      lock: () => {
        const token = get().token;
        if (token) apiLogout(token).catch(() => {});
        set({ isUnlocked: false, username: null, token: null });
      },

      clearError: () => set({ error: null }),
    }),
    { name: "dbeans.auth", partialize: (s) => ({ token: s.token }) },
  ),
);

export const AUTH_CONSTANTS = { MAX_ATTEMPTS, LOCKOUT_SECONDS };
