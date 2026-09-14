import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemePreference = "dark" | "light" | "system";

interface SettingsState {
  theme: ThemePreference;
  editorFontSize: number;
  sidebarExpanded: boolean;
  setTheme: (t: ThemePreference) => void;
  setEditorFontSize: (n: number) => void;
  setSidebarExpanded: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: "dark",
      editorFontSize: 13,
      sidebarExpanded: false,
      setTheme: (theme) => set({ theme }),
      setEditorFontSize: (editorFontSize) => set({ editorFontSize }),
      setSidebarExpanded: (sidebarExpanded) => set({ sidebarExpanded }),
    }),
    { name: "dbeans.settings" },
  ),
);

function resolveSystemTheme(): "dark" | "light" {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyThemeToDocument(pref: ThemePreference) {
  const resolved = pref === "system" ? resolveSystemTheme() : pref;
  document.documentElement.setAttribute("data-theme", resolved);
}

let systemListenerAttached = false;
export function watchSystemTheme() {
  if (systemListenerAttached || typeof window === "undefined") return;
  systemListenerAttached = true;
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (useSettingsStore.getState().theme === "system") {
      applyThemeToDocument("system");
    }
  });
}
