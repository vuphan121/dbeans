import { Bean } from "lucide-react";
import { cn } from "@/lib/utils";

export function LogoMark({ size = 20 }: { size?: number }) {
  return (
    <div
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-[6px] border border-border-strong bg-bg-hover text-text-primary"
    >
      <Bean size={Math.round(size * 0.62)} strokeWidth={2} />
    </div>
  );
}

export function Logo({
  size = 20,
  className,
  onClick,
}: {
  size?: number;
  className?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <LogoMark size={size} />
      <span className="text-[13px] font-semibold tracking-[-0.01em] text-text-primary">dbeans</span>
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn("flex items-center gap-2 outline-none", className)}>
        {content}
      </button>
    );
  }

  return <div className={cn("flex items-center gap-2", className)}>{content}</div>;
}
