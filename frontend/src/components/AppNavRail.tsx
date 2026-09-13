import * as Collapsible from "@radix-ui/react-collapsible";
import { useLocation, useNavigate } from "react-router-dom";
import { Database, Clock, Settings as SettingsIcon, ChevronsLeft, ChevronsRight } from "lucide-react";
import { LogoMark } from "@/components/Logo";
import { useSettingsStore } from "@/state/settings";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/connections", label: "Connections", icon: Database },
  { to: "/jobs", label: "Scheduled jobs", icon: Clock },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

// A collapsible nav rail shared by every authenticated page — always
// visible as icons, expandable (Radix Collapsible) to show labels too.
// Collapsed/expanded state persists across reloads (state/settings.ts).
export function AppNavRail() {
  const navigate = useNavigate();
  const location = useLocation();
  const expanded = useSettingsStore((s) => s.sidebarExpanded);
  const setExpanded = useSettingsStore((s) => s.setSidebarExpanded);

  return (
    <Collapsible.Root
      open={expanded}
      onOpenChange={setExpanded}
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-border-subtle bg-bg-surface transition-[width] duration-150",
        expanded ? "w-[188px]" : "w-[52px]",
      )}
    >
      <button
        onClick={() => navigate("/connections")}
        className="flex h-11 shrink-0 items-center gap-2.5 border-b border-border-subtle px-3.5"
      >
        <LogoMark size={20} />
        {expanded && <span className="text-[13px] font-semibold tracking-[-0.01em] text-text-primary">dbeans</span>}
      </button>

      <nav className="flex flex-1 flex-col gap-0.5 p-2">
        {NAV_ITEMS.map((item) => {
          const active = location.pathname.startsWith(item.to);
          const Icon = item.icon;
          return (
            <button
              key={item.to}
              onClick={() => navigate(item.to)}
              title={expanded ? undefined : item.label}
              className={cn(
                "flex h-9 items-center gap-2.5 rounded-[7px] px-2.5 text-[12.5px] transition-colors",
                active
                  ? "bg-bg-active text-text-primary"
                  : "text-text-faint hover:bg-bg-hover hover:text-text-secondary",
              )}
            >
              <Icon size={15} className="shrink-0" />
              {expanded && <span className="truncate">{item.label}</span>}
            </button>
          );
        })}
      </nav>

      <Collapsible.Trigger asChild>
        <button
          title={expanded ? "Collapse" : "Expand"}
          className="flex h-9 shrink-0 items-center gap-2.5 border-t border-border-subtle px-3.5 text-text-faint hover:bg-bg-hover hover:text-text-secondary"
        >
          {expanded ? <ChevronsLeft size={14} /> : <ChevronsRight size={14} />}
          {expanded && <span className="text-[11.5px]">Collapse</span>}
        </button>
      </Collapsible.Trigger>
    </Collapsible.Root>
  );
}
