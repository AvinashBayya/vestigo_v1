import { Dialog } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "./cn.ts";

/**
 * A panel from the right edge, over the page (the provenance drawer, §9).
 * Focus moves into it and returns on close; Escape closes it.
 */
export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Its name for assistive technology, shown as its heading. */
  readonly title: string;
  /** What it shows, in a sentence, for assistive technology. */
  readonly description: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Content
          className={cn(
            "fixed top-0 right-0 flex h-screen w-full max-w-drawer flex-col gap-4 overflow-y-auto",
            "border-l border-border-default bg-surface-raised p-5 shadow-overlay",
            className,
          )}
        >
          <div className="flex items-center gap-3">
            <Dialog.Title className="text-eyebrow uppercase text-ink-muted">{title}</Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="ml-auto inline-flex min-h-target min-w-target items-center justify-center rounded-sm border border-border-strong text-ink-secondary hover:bg-surface-hover"
            >
              <span aria-hidden="true">×</span>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">{description}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
