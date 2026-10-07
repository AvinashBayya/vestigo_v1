import { Label } from "radix-ui";
import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "./cn.ts";

export type InputProps = ComponentProps<"input">;

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        "min-h-target w-full rounded-md border border-border-input bg-surface-sunken px-3",
        "text-body text-ink-primary placeholder:text-ink-muted",
        "aria-[invalid=true]:border-status-failed-mark",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A labelled input with its hint and error. Every input has a visible label
 * (§7); the hint and the error are tied to it for screen readers.
 */
export function Field({
  label,
  hint,
  error,
  className,
  ...input
}: InputProps & {
  readonly label: ReactNode;
  readonly hint?: ReactNode;
  /** Why the value is not accepted; null or absent when it is. */
  readonly error?: ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint === undefined ? null : hintId, error == null ? null : errorId]
    .filter((part) => part !== null)
    .join(" ");
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <Label.Root htmlFor={id} className="text-body-strong text-ink-primary">
        {label}
      </Label.Root>
      {hint === undefined ? null : (
        <p id={hintId} className="text-caption text-ink-muted">
          {hint}
        </p>
      )}
      <Input
        id={id}
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
