import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "./cn.ts";

const notice = cva("rounded-md p-3 text-body", {
  variants: {
    tone: {
      /** Neutral information: what happens next, what was done. */
      info: "bg-accent-soft text-accent-ink",
      /** Something failed: the reason, and what the person can do (§8 Failed). */
      failure: "border border-status-failed-mark bg-status-failed-fill text-status-failed-ink",
    },
  },
  defaultVariants: { tone: "info" },
});

/**
 * A message in the flow of the page. A failure is announced at once
 * (role="alert"); information politely (role="status").
 */
export function Notice({
  className,
  tone,
  ...props
}: ComponentProps<"div"> & VariantProps<typeof notice>) {
  return (
    <div
      role={tone === "failure" ? "alert" : "status"}
      className={cn(notice({ tone }), className)}
      {...props}
    />
  );
}
