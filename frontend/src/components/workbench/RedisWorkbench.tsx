import { useState } from "react";
import { WorkbenchShell } from "./WorkbenchShell";
import { KeyBrowser } from "./redis/KeyBrowser";
import { KeyEditor } from "./redis/KeyEditor";
import { NewKeyDialog } from "./redis/NewKeyDialog";
import { useRedisStore } from "@/state/redis";
import type { SavedConnection } from "@/lib/types";

export function RedisWorkbench({
  connection,
  onOpenPalette,
}: {
  connection: SavedConnection;
  onOpenPalette: () => void;
}) {
  const { keys, selectedKey } = useRedisStore();
  const [newKeyOpen, setNewKeyOpen] = useState(false);
  const entry = keys.find((k) => k.key === selectedKey);

  return (
    <WorkbenchShell
      onOpenPalette={onOpenPalette}
      sidebar={<KeyBrowser onNewKey={() => setNewKeyOpen(true)} />}
      topBarCenter={
        <div className="flex items-center gap-2 px-3.5 text-[12.5px] text-text-muted">
          <span className="font-mono text-[11px] text-text-faint">Redis</span>
          <span className="text-text-secondary">{connection.name}</span>
          <span className="text-border-control">·</span>
          <span>{keys.length} keys loaded</span>
        </div>
      }
    >
      {entry ? (
        <KeyEditor key={entry.key} entry={entry} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-[13px] text-text-faint">
          Select a key to inspect it
        </div>
      )}
      <NewKeyDialog open={newKeyOpen} onOpenChange={setNewKeyOpen} />
    </WorkbenchShell>
  );
}
