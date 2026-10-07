import { cn } from "./cn.ts";

/**
 * The product mark (§9 Navigation, Main): a `logo-tile` `accent` tile holding
 * a search glyph in `on-accent`, and the name in `wordmark`. The name is the
 * caller's (apps/web passes PRODUCT_NAME): this package never names the
 * product. The glyph is decorative and has no title, so the mark's text is
 * exactly the name.
 */
export function ProductMark({
  name,
  className,
}: {
  readonly name: string;
  readonly className?: string | undefined;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span
        aria-hidden="true"
        className="inline-flex size-logo-tile shrink-0 items-center justify-center rounded-md bg-accent text-on-accent"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-icon"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-4-4" />
        </svg>
      </span>
      <span className="text-wordmark text-ink-primary">{name}</span>
    </span>
  );
}
