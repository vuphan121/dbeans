import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPod|iPad/.test(navigator.platform ?? navigator.userAgent);

// Display label for the OS-native "primary" modifier key (Cmd on macOS, Ctrl elsewhere).
export const modKey = isMac ? "⌘" : "Ctrl";

/** True when the OS-native modifier for a shortcut is held (metaKey on macOS, ctrlKey elsewhere). */
export function isModPressed(e: KeyboardEvent | ReactKeyboardEvent): boolean {
  return isMac ? e.metaKey : e.ctrlKey;
}

/** e.g. comboLabel("K") -> "⌘K" on macOS, "Ctrl+K" elsewhere. */
export function comboLabel(key: string): string {
  return isMac ? `${modKey}${key}` : `${modKey}+${key}`;
}

/**
 * True when a bare (unmodified) single-key shortcut should NOT fire because
 * the user is typing somewhere — a text input, textarea, contenteditable, or
 * the CodeMirror SQL editor. Guard every no-modifier shortcut with this.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable ||
    target.closest(".cm-editor") !== null
  );
}
