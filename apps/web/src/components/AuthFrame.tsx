import { PRODUCT_NAME } from "@repo/config/product";
import { cn, ProductMark } from "@repo/ui";
import type { ReactNode } from "react";

/** §4 heading styles: sign-in (`heading-auth`), a numbered step (`heading-step`), a page (`heading-page`). */
const TITLE_STYLE = {
  auth: "text-heading-auth",
  step: "text-heading-step",
  page: "text-heading-page",
} as const;

const INTRO_TONE = {
  muted: "text-ink-muted",
  secondary: "text-ink-secondary",
} as const;

export interface AuthHeadingProps {
  /** A short label above the heading, e.g. the step number. */
  readonly eyebrow?: string | undefined;
  readonly title: string;
  readonly titleStyle?: keyof typeof TITLE_STYLE | undefined;
  readonly intro?: ReactNode;
  readonly introTone?: keyof typeof INTRO_TONE | undefined;
  /** More under the intro (the enrolment link's tag row). */
  readonly children?: ReactNode;
  readonly className?: string | undefined;
}

/**
 * An auth screen's title block: the eyebrow, the screen's only h1, and its
 * lead (SignIn: gap `space-1.75`; the enrolment hero card passes its own gap).
 */
export function AuthHeading({
  eyebrow,
  title,
  titleStyle = "auth",
  intro,
  introTone = "muted",
  children,
  className,
}: AuthHeadingProps) {
  return (
    <div className={cn("flex flex-col gap-1.75", className)}>
      {eyebrow === undefined ? null : (
        <p className="text-eyebrow text-ink-muted uppercase">{eyebrow}</p>
      )}
      <h1 className={cn(TITLE_STYLE[titleStyle], "text-ink-primary")}>{title}</h1>
      {intro === undefined ? null : (
        <div className={cn("text-prose-lead", INTRO_TONE[introTone])}>{intro}</div>
      )}
      {children}
    </div>
  );
}

type FrameHeading =
  | (Omit<AuthHeadingProps, "children" | "className"> & { readonly header?: undefined })
  | {
      /** Replaces the title block (the enrolment hero card); it must hold the h1. */
      readonly header: ReactNode;
      readonly eyebrow?: undefined;
      readonly title?: undefined;
      readonly titleStyle?: undefined;
      readonly intro?: undefined;
      readonly introTone?: undefined;
    };

/**
 * The frame every sign-in step sits in (docs/design/mockups/SignIn.dc.html,
 * MfaEnrol.dc.html): the product mark, the step's heading, its content, and a
 * footnote under a rule.
 * - `form` (sign-in, the challenge, the tenant chooser, the session's loading
 *   and failure frames): one column at `layout-form-width`, centred, blocks
 *   `space-6.5` apart.
 * - `page` (enrolment): `layout-page-width`, top-aligned, `space-14` above and
 *   below, blocks `space-5.5` apart.
 * `ground` is the page behind it: the challenge sits on `surface-raised`, as
 * the right half of SignIn draws it.
 */
export function AuthFrame({
  footnote,
  footnoteIcon,
  width = "form",
  ground = "page",
  children,
  ...heading
}: FrameHeading & {
  /** Under a rule at the end, in `prose-small` `ink-muted`. */
  readonly footnote?: ReactNode;
  /** A decorative line icon beside the footnote. */
  readonly footnoteIcon?: ReactNode;
  /** `form` for one column of fields; `page` for the wider enrolment steps. */
  readonly width?: "form" | "page" | undefined;
  readonly ground?: "page" | "raised" | undefined;
  readonly children: ReactNode;
}) {
  return (
    <main
      className={cn(
        "flex min-h-screen justify-center px-4",
        width === "page" ? "items-start py-14" : "items-center py-10",
        ground === "raised" ? "bg-surface-raised" : "bg-surface-page",
      )}
    >
      <div
        className={cn(
          "flex w-full min-w-0 flex-col",
          width === "page" ? "max-w-page gap-5.5" : "max-w-form gap-6.5",
        )}
      >
        <ProductMark name={PRODUCT_NAME} />
        {heading.title === undefined ? (
          heading.header
        ) : (
          <AuthHeading
            eyebrow={heading.eyebrow}
            title={heading.title}
            titleStyle={heading.titleStyle}
            intro={heading.intro}
            introTone={heading.introTone}
          />
        )}
        {children}
        {footnote === undefined ? null : (
          <div className="flex items-start gap-2.75 border-t border-border-subtle pt-4.5 text-prose-small text-ink-muted">
            {footnoteIcon === undefined ? null : (
              <span aria-hidden="true" className="mt-0.25 inline-flex shrink-0">
                {footnoteIcon}
              </span>
            )}
            <div className="min-w-0">{footnote}</div>
          </div>
        )}
      </div>
    </main>
  );
}
