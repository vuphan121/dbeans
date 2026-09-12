import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Settings as SettingsIcon, MoreHorizontal, Plus } from "lucide-react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/Button";
import { EngineTag } from "@/components/ui/Badge";
import { IconButton } from "@/components/ui/IconButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { ENGINES } from "@/lib/types";
import { useConnectionsStore } from "@/state/connections";

export default function Connections() {
  const navigate = useNavigate();
  const { connections, setActiveConnection, removeConnection } = useConnectionsStore();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return connections;
    return connections.filter(
      (c) => c.name.toLowerCase().includes(q) || c.dsn.toLowerCase().includes(q),
    );
  }, [connections, query]);

  function openConnection(id: string) {
    setActiveConnection(id);
    navigate("/workbench");
  }

  return (
    <div className="flex h-full flex-col bg-bg-app">
      <header className="flex h-12 items-center justify-between border-b border-border-subtle px-4">
        <Logo size={20} />
        <div className="flex items-center gap-2">
          <div className="rounded-[5px] border border-border-strong px-[7px] py-1 font-mono text-[11px] font-medium text-text-faint">
            ⌘K
          </div>
          <IconButton onClick={() => navigate("/settings")} aria-label="Settings">
            <SettingsIcon size={13} />
          </IconButton>
        </div>
      </header>

      {connections.length === 0 ? (
        <EmptyState onAdd={() => navigate("/connections/new")} />
      ) : (
        <div className="flex flex-1 flex-col gap-5 px-12 py-9">
          <div className="flex items-end justify-between">
            <div className="flex flex-col gap-1">
              <h1 className="text-[19px] font-semibold tracking-[-0.015em] text-text-primary">
                Connections
              </h1>
              <div className="text-[12.5px] text-text-faint">
                {connections.length} saved · vault unlocked
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-[220px] items-center gap-1.5 rounded-[7px] border border-border-strong bg-bg-inset px-2.5">
                <Search size={11} className="text-text-quiet" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search connections"
                  className="w-full bg-transparent text-[12.5px] text-text-primary placeholder:text-text-quiet outline-none"
                />
              </div>
              <Button variant="primary" size="sm" onClick={() => navigate("/connections/new")}>
                <Plus size={13} /> Add
              </Button>
            </div>
          </div>

          <div className="overflow-hidden rounded-[9px] border border-border-default">
            {filtered.map((c) => (
              <div
                key={c.id}
                onClick={() => openConnection(c.id)}
                className="flex h-[62px] cursor-pointer items-center gap-3.5 border-b border-border-faint px-4 last:border-b-0 hover:bg-bg-hover/50"
              >
                <EngineTag tag={ENGINES[c.engine].tag} />
                <div className="flex flex-1 flex-col gap-0.5">
                  <div className="text-[13.5px] font-medium text-text-primary">{c.name}</div>
                  <div className="font-mono text-[11.5px] text-text-faint">{c.dsn}</div>
                </div>
                <div className="w-[130px] text-[12px] text-text-faint">{c.lastUsed}</div>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    onClick={(e) => e.stopPropagation()}
                    className="flex w-5 items-center justify-center text-text-ghost outline-none hover:text-text-secondary"
                  >
                    <MoreHorizontal size={15} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onClick={() => openConnection(c.id)}>Open</DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        removeConnection(c.id);
                      }}
                      className="text-error-dim data-[highlighted]:text-error-text"
                    >
                      Remove
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
            <div
              onClick={() => navigate("/connections/new")}
              className="flex h-[52px] cursor-pointer items-center gap-2.5 px-4 text-text-quiet hover:bg-bg-hover/50"
            >
              <div className="flex h-[30px] w-[30px] items-center justify-center rounded-[7px] border border-dashed border-border-control text-[13px]">
                +
              </div>
              <div className="text-[12.5px]">Add a connection</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex w-[400px] flex-col items-center gap-5 text-center">
        <div className="flex h-[76px] w-[120px] flex-col items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-border-control">
          <div className="h-[5px] w-11 rounded-full bg-border-strong" />
          <div className="h-[5px] w-11 rounded-full bg-border-subtle" />
          <div className="h-[5px] w-11 rounded-full bg-border-faint" />
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-[17px] font-semibold tracking-[-0.01em] text-text-primary">
            No connections yet
          </div>
          <div className="text-[13px] leading-[1.5] text-text-muted text-balance">
            Point dbeans at a Postgres, MySQL, SQLite, Redis or Kafka source to start exploring.
          </div>
        </div>
        <div className="mt-0.5 flex items-center gap-2.5">
          <Button variant="primary" size="md" onClick={onAdd}>
            <span className="text-sm leading-none">+</span> Add a connection
          </Button>
          <Button variant="secondary" size="md">
            Open SQLite file
          </Button>
        </div>
        <div className="mt-1 text-[11px] text-text-quiet">
          or press <span className="font-mono">⌘N</span>
        </div>
      </div>
    </div>
  );
}
