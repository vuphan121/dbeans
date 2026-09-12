import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Settings as SettingsIcon } from "lucide-react";
import { Logo } from "@/components/Logo";
import { IconButton } from "@/components/ui/IconButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { comboLabel } from "@/lib/platform";

export function WorkbenchShell({
  topBarCenter,
  sidebar,
  children,
  onOpenPalette,
}: {
  topBarCenter: ReactNode;
  sidebar: ReactNode;
  children: ReactNode;
  onOpenPalette: () => void;
}) {
  const navigate = useNavigate();

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg-app">
      <div className="flex h-11 items-stretch border-b border-border-subtle bg-bg-surface">
        <div className="flex w-64 shrink-0 items-center gap-2.5 border-r border-border-subtle px-3.5">
          <Logo size={20} onClick={() => navigate("/connections")} />
        </div>
        <div className="flex flex-1 items-stretch overflow-hidden">{topBarCenter}</div>
        <div className="flex items-center gap-2 border-l border-border-subtle px-3.5">
          <button
            onClick={onOpenPalette}
            className="flex h-[26px] items-center gap-1.5 rounded-[6px] border border-border-strong px-2 text-[11.5px] text-text-muted hover:bg-bg-hover"
          >
            <span>Search anything</span>
            <span className="rounded-[4px] bg-bg-hover px-[5px] py-[2px] font-mono text-[10.5px] text-text-faint">
              {comboLabel("K")}
            </span>
          </button>
          <ThemeToggle size={26} />
          <IconButton onClick={() => navigate("/settings")} aria-label="Settings">
            <SettingsIcon size={12} />
          </IconButton>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-64 shrink-0 flex-col border-r border-border-subtle bg-bg-surface">
          {sidebar}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}
