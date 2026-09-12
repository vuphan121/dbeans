import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;

export function DropdownMenuContent({
  children,
  align = "end",
}: {
  children: ReactNode;
  align?: "start" | "end" | "center";
}) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        align={align}
        sideOffset={6}
        className="z-50 min-w-[160px] overflow-hidden rounded-[8px] border border-border-elevated bg-bg-raised p-1 shadow-2xl"
      >
        {children}
      </DropdownPrimitive.Content>
    </DropdownPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  children,
  className,
  ...props
}: React.ComponentProps<typeof DropdownPrimitive.Item>) {
  return (
    <DropdownPrimitive.Item
      className={cn(
        "cursor-pointer rounded-[5px] px-2.5 py-1.5 text-[12.5px] text-text-secondary outline-none data-[highlighted]:bg-bg-hover data-[highlighted]:text-text-primary",
        className,
      )}
      {...props}
    >
      {children}
    </DropdownPrimitive.Item>
  );
}
