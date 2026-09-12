import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SqlWorkbench } from "@/components/workbench/SqlWorkbench";
import { RedisWorkbench } from "@/components/workbench/RedisWorkbench";
import { KafkaWorkbench } from "@/components/workbench/KafkaWorkbench";
import { CommandPalette } from "@/components/CommandPalette";
import { useConnectionsStore } from "@/state/connections";
import { useWorkbenchStore } from "@/state/workbench";
import { isModPressed, isTypingTarget } from "@/lib/platform";

export default function Workbench() {
  const navigate = useNavigate();
  const connection = useConnectionsStore((s) => s.getActiveConnection());
  const addTab = useWorkbenchStore((s) => s.addTab);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    if (!connection) navigate("/connections", { replace: true });
  }, [connection, navigate]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isModPressed(e) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if (isModPressed(e) && e.key === ",") {
        e.preventDefault();
        navigate("/settings");
      }
      // Bare "T", not Ctrl/Cmd+T — that combo is reserved by every browser
      // for "new tab" and can't be intercepted from the page.
      if (
        connection?.engine !== "redis" &&
        connection?.engine !== "kafka" &&
        e.key.toLowerCase() === "t" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !isTypingTarget(e.target)
      ) {
        e.preventDefault();
        addTab();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate, connection, addTab]);

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
