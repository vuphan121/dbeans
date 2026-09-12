import { cn } from "@/lib/utils";
import { EngineIcon } from "@/components/EngineIcon";
import type { Engine } from "@/lib/types";

export function EngineTag({ engine, size = 30 }: { engine: Engine; size?: number }) {
  return (
    <div
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-[7px] border border-border-strong bg-bg-hover text-text-tertiary"
    >
      <EngineIcon engine={engine} size={Math.round(size * 0.52)} />
    </div>
  );
}

export function Dot({ className }: { className?: string }) {
  return <span className={cn("h-1.5 w-1.5 rounded-full", className)} />;
}
