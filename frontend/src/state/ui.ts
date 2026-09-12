import { create } from "zustand";

interface UiState {
  openingConnectionId: string | null;
  setOpeningConnectionId: (id: string | null) => void;
}

// Ephemeral, session-only UI state — not persisted.
export const useUiStore = create<UiState>()((set) => ({
  openingConnectionId: null,
  setOpeningConnectionId: (id) => set({ openingConnectionId: id }),
}));
