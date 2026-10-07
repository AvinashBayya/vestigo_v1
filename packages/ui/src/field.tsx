import { Label } from "radix-ui";
import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "./cn.ts";

/**
 * §9 Inputs. Every edge is `border-input` (§12 R2: an input's edge
 * identifies it, so it meets 3:1), whatever the mockup draws.
 * - default: the U1-b input, unchanged for screens not yet rebuilt.
 * - auth: `target-min` tall, padding `space-3.25`, `surface-field`, `body`.
 * - otp: `otp-height`, padding `space-4`, `surface-sunken`, `mono-otp`.
 * - workspace: `control-sm`, padding `space-2.75`, `surface-sunken`, `meta`.
 *   Drawn below the target, and an input cannot carry the hit-area
 *   extension, so it always sits in a `target-min` label (ToolbarInput).
 */
const VARIANT = {
  default: "min-h-target bg-surface-sunken px-3 text-body",
  auth: "h-target bg-surface-field px-3.25 text-body",
  otp: "h-otp min-h-target bg-surface-sunken px-4 font-mono text-mono-otp",
  workspace: "h-control-sm min-w-0 bg-surface-sunken px-2.75 text-meta",
} as const;

export type InputVariant = keyof typeof VARIANT;

export type InputProps = ComponentProps<"input"> & {
  readonly variant?: InputVariant | undefined;
};

export function Input({ className, variant = "default", ...props }: InputProps) {
  const otp =
    variant === "otp" ? { inputMode: "numeric" as const, autoComplete: "one-time-code" } : {};
  return (
    <input
      {...otp}
      className={cn(
        "w-full rounded-md border border-border-input text-ink-primary placeholder:text-ink-muted",
        "aria-[invalid=true]:border-status-failed-mark",
        VARIANT[variant],
        className,
      )}
      {...props}
    />
  );
}

/** The label and its gap from the input, by variant (§9: `small-strong` `ink-secondary`, gap `space-1.75`). */
const LABEL: Readonly<Record<InputVariant, { readonly label: string; readonly gap: string }>> = {
  default: { label: "text-body-strong text-ink-primary", gap: "gap-1" },
  auth: { label: "text-small-strong text-ink-secondary", gap: "gap-1.75" },
  otp: { label: "text-small-strong text-ink-secondary", gap: "gap-2.25" },
  workspace: { label: "text-small-strong text-ink-secondary", gap: "gap-1.75" },
};

/**
 * A labelled input with its hint and error. Every input has a visible label
 * (§7); the hint and the error are tied to it for screen readers.
 * `className` styles the input (a mono code, say), never the label;
 * `wrapperClassName` places the whole field.
 */
export function Field({
  label,
  hint,
  error,
  variant = "default",
  className,
  wrapperClassName,
  ...input
}: InputProps & {
  readonly label: ReactNode;
  readonly hint?: ReactNode;
  /** Why the value is not accepted; null or absent when it is. */
  readonly error?: ReactNode;
  readonly wrapperClassName?: string | undefined;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint === undefined ? null : hintId, error == null ? null : errorId]
    .filter((part) => part !== null)
    .join(" ");
  const style = LABEL[variant];
  return (
    <div className={cn("flex flex-col", style.gap, wrapperClassName)}>
      <Label.Root htmlFor={id} className={style.label}>
        {label}
      </Label.Root>
      {hint === undefined ? null : (
        <p id={hintId} className="text-caption text-ink-muted">
          {hint}
        </p>
      )}
      <Input
        id={id}
        variant={variant}
        className={className}
        aria-invalid={error == null ? undefined : true}
        aria-describedby={describedBy === "" ? undefined : describedBy}
        {...input}
      />
      {error == null ? null : (
        <p id={errorId} className="text-small text-status-failed-ink">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * A workspace toolbar input (§9 Inputs: Entities filter, Evidence search):
 * drawn at `control-sm` on `surface-sunken`, with a visually hidden label
 * `target-min` tall around it, so a click anywhere in that height focuses it
 * and nothing covers the text.
 */
export function ToolbarInput({
  label,
  type = "search",
  value,
  onChange,
  placeholder,
  className,
}: {
  readonly label: string;
  readonly type?: "search" | "text" | undefined;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
  readonly className?: string | undefined;
}) {
  return (
    <label className={cn("flex min-h-target min-w-0 grow items-center", className)}>
      <span className="sr-only">{label}</span>
      <Input
        variant="workspace"
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </label>
  );
}
