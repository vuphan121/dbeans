import * as React from "react";
import { cn } from "@/lib/utils";

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: 26 | 28;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, size = 26, style, ...props }, ref) => (
    <button
      ref={ref}
      style={{ width: size, height: size, ...style }}
      className={cn(
        "inline-flex items-center justify-center rounded-[6px] border border-border-strong text-text-muted transition-colors hover:bg-bg-hover hover:text-text-secondary",
        className,
      )}
      {...props}
    />
  ),
);
IconButton.displayName = "IconButton";
