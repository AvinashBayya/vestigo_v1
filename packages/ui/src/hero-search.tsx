import { useId, type ReactNode } from "react";
import { Button } from "./button.tsx";
import { cn } from "./cn.ts";

/**
 * The hero search shell (§9 Inputs, Main): `layout-search-width`,
 * `surface-field`, `radius-xl`, padding `space-3.5` `space-4`, `shadow-card`,
 * a borderless input and `target-min` buttons at `radius-inner`. The shell is
 * the input's only visible edge, so it is `border-input` (§12 R2: an
 * input's edge meets 3:1), not §9's `border-strong`. A search landmark; the
 * input's label is visually hidden. Failures and Locked render below the
 * shell, from the screen, never inside it.
 */
export function HeroSearch({
  label,
  placeholder,
  value,
  onValueChange,
  onSubmit,
  submitLabel,
  submitting = false,
  submitDisabled = false,
  end,
  className,
}: {
  /** The input's name: "Target to investigate". */
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly onSubmit: () => void;
  /** The submit button's words, including its pending wording while submitting. */
  readonly submitLabel: string;
  readonly submitting?: boolean | undefined;
  readonly submitDisabled?: boolean | undefined;
  /** Further `target-min` controls before the submit (none is built yet). */
  readonly end?: ReactNode;
  readonly className?: string | undefined;
}) {
  const id = useId();
  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className={cn(
        "flex w-full max-w-search flex-wrap items-center gap-3 rounded-xl border border-border-input bg-surface-field px-4 py-3.5 shadow-card",
        className,
      )}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-icon-lg shrink-0 text-ink-muted"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </svg>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          onValueChange(event.target.value);
        }}
        className="min-h-target min-w-0 grow bg-surface-field text-body text-ink-primary placeholder:text-ink-muted"
      />
      {end}
      <Button
        type="submit"
        size="lg"
        className="rounded-inner"
        disabled={submitting || submitDisabled}
        aria-busy={submitting ? true : undefined}
      >
        {submitLabel}
      </Button>
    </form>
  );
}
