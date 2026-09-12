import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-[7px] text-[12.5px] font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap",
  {
    variants: {
      variant: {
        primary: "bg-inverse-bg text-inverse-text font-semibold hover:opacity-90",
        secondary:
          "border border-border-control text-text-secondary hover:bg-bg-hover",
        ghost: "text-text-muted hover:text-text-secondary hover:bg-bg-hover",
        danger: "border border-error-border text-error-text hover:bg-error-bg",
      },
      size: {
        sm: "h-[26px] px-2.5 text-[11.5px]",
        md: "h-[34px] px-3.5",
        lg: "h-9 px-4",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
    );
  },
);
Button.displayName = "Button";
