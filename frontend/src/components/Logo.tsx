import { cn } from "@/lib/utils";

export function LogoMark({ size = 20 }: { size?: number }) {
  const barW = Math.round(size * 0.45);
  const barH = Math.max(2, Math.round(size * 0.1));
  return (
    <div
      style={{ width: size, height: size }}
      className="flex shrink-0 flex-col items-center justify-center gap-[2px] rounded-[6px] border border-accent-border bg-accent-bg"
    >
      <div style={{ width: barW, height: barH }} className="rounded-full bg-accent" />
      <div style={{ width: barW, height: barH }} className="rounded-full bg-accent opacity-60" />
      <div style={{ width: barW, height: barH }} className="rounded-full bg-accent opacity-30" />
    </div>
  );
}

export function Logo({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <LogoMark size={size} />
      <span className="text-[13px] font-semibold tracking-[-0.01em] text-text-primary">dbeans</span>
    </div>
  );
}
