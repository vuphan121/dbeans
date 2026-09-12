import { Sun, Moon } from "lucide-react";
import { IconButton } from "@/components/ui/IconButton";
import { useSettingsStore } from "@/state/settings";

export function ThemeToggle({ size = 26 }: { size?: 26 | 28 }) {
  const { theme, setTheme } = useSettingsStore();
  // A "system" preference can still be resolved either way, so read what's
  // actually painted right now rather than the raw preference string.
  const resolved = theme === "light" ? "light" : theme === "dark" ? "dark" : document.documentElement.getAttribute("data-theme");
  const isLight = resolved === "light";

  return (
    <IconButton
      size={size}
      onClick={() => setTheme(isLight ? "dark" : "light")}
      aria-label={isLight ? "Switch to dark mode" : "Switch to light mode"}
      title={isLight ? "Switch to dark mode" : "Switch to light mode"}
    >
      {isLight ? <Moon size={13} /> : <Sun size={13} />}
    </IconButton>
  );
}
