import { cn } from "@/lib/utils";

export function EngineTag({ tag, size = 30 }: { tag: string; size?: number }) {
  return (
    <div
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-[7px] border border-border-strong bg-bg-hover font-mono text-[11px] font-semibold text-text-tertiary"
    >
      {tag}
    </div>
  );
}

export function Dot({ className }: { className?: string }) {
  return <span className={cn("h-1.5 w-1.5 rounded-full", className)} />;
}
