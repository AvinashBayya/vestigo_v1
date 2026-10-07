import { cn } from "./cn.ts";

/**
 * A tag (§9, Main: the detected target types; §12: every non-status pill is
 * rebuilt as one). Not a status, so never a pill and never a meaning colour:
 * `radius-sm`, a `border-control` edge, `surface-field`, `ink-muted`. Literal data
 * ("domain") is set in `mono-meta`; words ("Passive only") in sans
 * `meta-strong` with `mono={false}`. The text is one string, so it is matched
 * whole.
 */
export function Tag({
  children,
  mono = true,
  className,
}: {
  readonly children: string;
  readonly mono?: boolean | undefined;
  readonly className?: string | undefined;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border border-border-control bg-surface-field px-2 py-0.75 whitespace-nowrap text-ink-muted",
        mono ? "font-mono text-mono-meta" : "text-meta-strong",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A caption and its tags ("Detects automatically:" and the types), wrapping. */
export function TagList({
  label,
  tags,
  mono = true,
  className,
}: {
  readonly label: string;
  readonly tags: readonly string[];
  readonly mono?: boolean | undefined;
  readonly className?: string | undefined;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <span className="text-meta text-ink-muted">{label}</span>
      <ul aria-label={label} className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <li key={tag}>
            <Tag mono={mono}>{tag}</Tag>
          </li>
        ))}
      </ul>
    </div>
  );
}
