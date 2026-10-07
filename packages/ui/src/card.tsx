import { useId, type ReactNode } from "react";
import { cn } from "./cn.ts";

const PADDING = {
  /** §9 Card: `space-4.5`. */
  card: "p-4.5",
  /** Run cards (RunLive): `space-4.5` `space-5`. */
  run: "px-5 py-4.5",
  /** A card that holds a table edge to edge. */
  none: "",
} as const;

/**
 * A card (§9, all mockups): `surface-raised`, a `border-default` edge,
 * `radius-lg`, no shadow. With a title it has the header row: the title in
 * `section-label` `ink-muted`, and on the right (`end`) a standalone link
 * (TextLink size meta) or a measured count. The card is named by its title.
 */
export function Card({
  as: Element = "section",
  title,
  titleLevel = 2,
  label,
  end,
  padding = "card",
  children,
  className,
}: {
  readonly as?: "section" | "div" | "article" | undefined;
  readonly title?: string | undefined;
  readonly titleLevel?: 2 | 3 | undefined;
  /** The card's name when it has no visible title. */
  readonly label?: string | undefined;
  readonly end?: ReactNode;
  readonly padding?: keyof typeof PADDING | undefined;
  readonly children: ReactNode;
  readonly className?: string | undefined;
}) {
  const id = useId();
  const Heading = titleLevel === 3 ? "h3" : "h2";
  return (
    <Element
      aria-labelledby={title === undefined ? undefined : id}
      aria-label={title === undefined ? label : undefined}
      className={cn(
        "flex flex-col rounded-lg border border-border-default bg-surface-raised",
        PADDING[padding],
        className,
      )}
    >
      {title !== undefined && (
        <div
          className={cn(
            "mb-3.5 flex flex-wrap items-center justify-between gap-3",
            padding === "none" && "mb-0 px-4.5 pt-4.5 pb-3.5",
          )}
        >
          <Heading id={id} className="text-section-label text-ink-muted uppercase">
            {title}
          </Heading>
          {end}
        </div>
      )}
      {children}
    </Element>
  );
}

/**
 * A card inside a card (§9: a `border-subtle` edge, `radius-inner`, padding
 * `space-3`). `inferred` is for an INFERRED item only, on the inferred tint.
 */
export function NestedCard({
  tone = "neutral",
  children,
  className,
}: {
  readonly tone?: "neutral" | "inferred" | undefined;
  readonly children: ReactNode;
  readonly className?: string | undefined;
}) {
  return (
    <div
      className={cn(
        "rounded-inner border p-3",
        tone === "inferred"
          ? "border-claim-inferred-border bg-claim-inferred-tint"
          : "border-border-subtle",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A dashed note (§9 Card, RunLive): a dashed `border-strong` edge, `radius-lg`,
 * `prose-small` `ink-secondary`, an optional `icon-lg` glyph. The edge is
 * decoration, not a control's boundary; the words carry the meaning. Its copy
 * must be true today.
 */
export function DashedNote({
  icon,
  children,
  className,
}: {
  /** A line icon from the app, drawn decorative. */
  readonly icon?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string | undefined;
}) {
  return (
    <aside
      role="note"
      className={cn(
        "flex items-start gap-3.25 rounded-lg border border-dashed border-border-strong bg-surface-raised px-4.5 py-3.75",
        "text-prose-small text-ink-secondary",
        className,
      )}
    >
      {icon !== undefined && (
        <span aria-hidden="true" className="inline-flex size-icon-lg shrink-0 text-ink-muted">
          {icon}
        </span>
      )}
      <div className="min-w-0">{children}</div>
    </aside>
  );
}
