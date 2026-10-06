import { Popover as RadixPopover } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "./cn.ts";

/** A panel that opens from a button: menus such as the account menu. */
export const Popover = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;

/** The opened panel: raised, with the overlay shadow (§5), never wider than the side navigation. */
export function PopoverContent({
  className,
  align = "end",
  ...props
}: ComponentProps<typeof RadixPopover.Content>) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        align={align}
        className={cn(
          "flex w-nav flex-col gap-3 rounded-lg border border-border-default bg-surface-raised p-4 shadow-overlay",
          className,
        )}
        {...props}
      />
    </RadixPopover.Portal>
  );
}
