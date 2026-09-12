import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SqlWorkbench } from "@/components/workbench/SqlWorkbench";
import { RedisWorkbench } from "@/components/workbench/RedisWorkbench";
import { KafkaWorkbench } from "@/components/workbench/KafkaWorkbench";
import { CommandPalette } from "@/components/CommandPalette";
import { useConnectionsStore } from "@/state/connections";

export default function Workbench() {
  const navigate = useNavigate();
  const connection = useConnectionsStore((s) => s.getActiveConnection());
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    if (!connection) navigate("/connections", { replace: true });
  }, [connection, navigate]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        navigate("/settings");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);

  if (!connection) return null;

  const onOpenPalette = () => setPaletteOpen(true);

  return (
    <>
      {connection.engine === "redis" ? (
        <RedisWorkbench connection={connection} onOpenPalette={onOpenPalette} />
      ) : connection.engine === "kafka" ? (
        <KafkaWorkbench connection={connection} onOpenPalette={onOpenPalette} />
      ) : (
        <SqlWorkbench connection={connection} onOpenPalette={onOpenPalette} />
      )}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </>
  );
}
