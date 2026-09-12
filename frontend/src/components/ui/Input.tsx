import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, mono = true, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-[34px] rounded-[7px] border border-border-input bg-bg-inset px-[11px] text-[12.5px] text-text-primary placeholder:text-text-quiet outline-none transition-shadow",
        "focus:border-border-focus focus:ring-2 focus:ring-white/[0.04]",
        mono && "font-mono",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
