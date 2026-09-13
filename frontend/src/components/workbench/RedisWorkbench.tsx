import { useEffect, useState } from "react";
import { WorkbenchShell } from "./WorkbenchShell";
import { KeyBrowser } from "./redis/KeyBrowser";
import { KeyEditor } from "./redis/KeyEditor";
import { NewKeyDialog } from "./redis/NewKeyDialog";
import { useRedisStore } from "@/state/redis";
import type { SavedConnection } from "@/lib/types";
import { useAuthStore } from "@/state/auth";

export function RedisWorkbench({
  connection,
  onOpenPalette,
}: {
  connection: SavedConnection;
  onOpenPalette: () => void;
}) {
  const { keys, selectedKey, loading, error, load } = useRedisStore();
  const token = useAuthStore((state) => state.token);
  const [newKeyOpen, setNewKeyOpen] = useState(false);
  const entry = keys.find((k) => k.key === selectedKey);

  useEffect(() => {
    if (token) void load(token, connection.id);
  }, [connection.id, load, token]);

  return (
    <WorkbenchShell
      onOpenPalette={onOpenPalette}
      sidebar={<KeyBrowser onNewKey={() => setNewKeyOpen(true)} />}
      topBarCenter={
        <div className="flex items-center gap-2 px-3.5 text-[12.5px] text-text-muted">
          <span className="font-mono text-[11px] text-text-faint">Redis</span>
          <span className="text-text-secondary">{connection.name}</span>
          <span className="text-border-control">·</span>
          <span>{loading ? "Loading keys…" : `${keys.length} keys loaded`}</span>
          {error && <span className="truncate text-error-dim" title={error}>{error}</span>}
        </div>
      }
    >
      {loading ? (
        <div className="flex flex-1 items-center justify-center text-[13px] text-text-faint">Connecting to Redis…</div>
      ) : entry ? (
        <KeyEditor key={`${entry.key}:${entry.ttl}:${JSON.stringify(entry.value)}`} entry={entry} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-[13px] text-text-faint">
          Select a key to inspect it
        </div>
      )}
      <NewKeyDialog open={newKeyOpen} onOpenChange={setNewKeyOpen} />
    </WorkbenchShell>
  );
}
