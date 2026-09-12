import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

export function Switch({
  checked,
  onCheckedChange,
  className,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  className?: string;
}) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      className={cn(
        "relative h-5 w-[34px] shrink-0 rounded-full p-[2px] transition-colors data-[state=checked]:bg-inverse-bg data-[state=unchecked]:bg-border-input",
        className,
      )}
    >
      <SwitchPrimitive.Thumb className="block h-4 w-4 rounded-full bg-text-faint transition-transform data-[state=checked]:translate-x-3.5 data-[state=checked]:bg-inverse-text" />
    </SwitchPrimitive.Root>
  );
}
