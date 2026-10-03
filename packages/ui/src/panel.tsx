import type { ComponentProps } from "react";
import { cn } from "./cn.ts";

/** A card or panel: a raised surface with the default edge and comfortable padding. */
export function Panel({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={cn("rounded-lg border border-border-default bg-surface-raised p-5", className)}
      {...props}
    />
  );
}

/** A loading placeholder in the shape of what will appear; never a centred spinner (§8). */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div aria-hidden="true" className={cn("rounded-md bg-surface-sunken", className)} {...props} />
  );
}
