import { ChevronDown } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { ENGINES } from "@/lib/types";
import { useConnectionsStore } from "@/state/connections";

export function ConnectionSwitcher() {
  const navigate = useNavigate();
  const { connections, activeConnectionId, setActiveConnection } = useConnectionsStore();
  const active = connections.find((c) => c.id === activeConnectionId);
  if (!active) return null;

  return (
    <div className="border-b border-border-faint p-2.5">
      <DropdownMenu>
        <DropdownMenuTrigger className="flex h-9 w-full items-center gap-2.5 rounded-[7px] border border-border-strong bg-bg-inset px-2.5 outline-none">
          <div className="flex h-5 w-5 items-center justify-center rounded-[5px] bg-bg-hover font-mono text-[9.5px] font-semibold text-text-tertiary">
            {ENGINES[active.engine].tag}
          </div>
          <div className="flex flex-1 flex-col items-start gap-px overflow-hidden">
            <div className="truncate text-[12px] font-medium leading-tight text-text-primary">
              {active.name}
            </div>
            <div className="truncate font-mono text-[10px] leading-tight text-text-quiet">{active.dsn}</div>
          </div>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success-dim" />
          <ChevronDown size={9} className="shrink-0 text-text-quiet" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {connections.map((c) => (
            <DropdownMenuItem key={c.id} onClick={() => setActiveConnection(c.id)}>
              <span className="mr-1.5 font-mono text-[10px] text-text-quiet">{ENGINES[c.engine].tag}</span>
              {c.name}
            </DropdownMenuItem>
          ))}
          <div className="my-1 h-px bg-border-default" />
          <DropdownMenuItem onClick={() => navigate("/connections/new")}>+ Add connection</DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate("/connections")}>All connections…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
