import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

export function ContextMenuContent({ children }: { children: ReactNode }) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content className="z-50 min-w-[160px] overflow-hidden rounded-[8px] border border-border-elevated bg-bg-raised p-1 shadow-2xl">
        {children}
      </ContextMenuPrimitive.Content>
    </ContextMenuPrimitive.Portal>
  );
}

export function ContextMenuItem({
  children,
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item>) {
  return (
    <ContextMenuPrimitive.Item
      className={cn(
        "cursor-pointer rounded-[5px] px-2.5 py-1.5 text-[12.5px] text-text-secondary outline-none data-[highlighted]:bg-bg-hover data-[highlighted]:text-text-primary",
        className,
      )}
      {...props}
    >
      {children}
    </ContextMenuPrimitive.Item>
  );
}
