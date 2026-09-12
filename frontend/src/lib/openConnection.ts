import type { NavigateFunction } from "react-router-dom";
import { useUiStore } from "@/state/ui";

// Kept deliberately visible rather than instant: this is a real network
// round-trip once there's a backend behind it, and users should never be
// left wondering whether their click registered.
const OPEN_DELAY_MS = 420;

export function requestOpenConnection(
  id: string,
  navigate: NavigateFunction,
  setActiveConnection: (id: string) => void,
) {
  const { openingConnectionId, setOpeningConnectionId } = useUiStore.getState();
  if (openingConnectionId) return; // already opening something — ignore extra clicks
  setOpeningConnectionId(id);
  window.setTimeout(() => {
    setActiveConnection(id);
    navigate("/workbench");
  }, OPEN_DELAY_MS);
}
