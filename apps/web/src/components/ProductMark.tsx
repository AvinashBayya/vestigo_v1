import { PRODUCT_NAME } from "@repo/config/product";
import { Search } from "lucide-react";

/** The product's mark and name, as the screen designs draw it. */
export function ProductMark() {
  return (
    <span className="inline-flex items-center gap-3">
      <span className="inline-flex size-8 items-center justify-center rounded-md bg-accent text-on-accent">
        <Search className="size-4" strokeWidth={2} aria-hidden="true" />
      </span>
      <span className="text-body-strong text-ink-primary">{PRODUCT_NAME}</span>
    </span>
  );
}
