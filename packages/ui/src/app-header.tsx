import type { ReactNode } from "react";
import { cn } from "./cn.ts";
import { Popover, PopoverContent, PopoverTrigger } from "./popover.tsx";

/**
 * The app header row (§9, Main and Dashboard-dark): `layout-header-height`,
 * the command-palette button left; the vetting pill and the account button
 * right, gap `space-3.5`. Narrower than both groups need (phone width), it
 * wraps as the context header does, and the organisation's name truncates:
 * a fixed row let the right group slide over the palette button and the
 * product mark, which could then not be tapped.
 */
export function AppHeader({
  start,
  end,
  className,
}: {
  readonly start: ReactNode;
  readonly end: ReactNode;
  readonly className?: string | undefined;
}) {
  return (
    <header
      className={cn(
        "flex min-h-header shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border-default bg-surface-raised px-5.5 py-1.25",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3.5">{start}</div>
      <div className="flex min-w-0 items-center gap-3.5">{end}</div>
    </header>
  );
}

/** The tenant's vetting status, as the API names it. */
export const VETTING_STATUSES = [
  "APPROVED",
  "PENDING",
  "NOT_SUBMITTED",
  "REJECTED",
  "SUSPENDED",
] as const;
export type VettingStatus = (typeof VETTING_STATUSES)[number];

export const VETTING_LABEL: Readonly<Record<VettingStatus, string>> = {
  APPROVED: "Verified tenant",
  PENDING: "Vetting pending",
  NOT_SUBMITTED: "Vetting not submitted",
  REJECTED: "Vetting rejected",
  SUSPENDED: "Vetting suspended",
};

/**
 * The vetting pill (§9, Main). Neutral in every status (D1), and told from a
 * status chip by shape, not colour (R3): an outline, no fill, no dot. Every
 * status chip is filled, so the two cannot be mistaken whatever the theme.
 */
export function VettingPill({ status }: { readonly status: VettingStatus }) {
  return (
    <span className="inline-flex items-center rounded-pill border border-border-input px-2.75 py-1.25 text-meta-strong whitespace-nowrap text-ink-secondary">
      {VETTING_LABEL[status]}
    </span>
  );
}

export type ThemeChoice = "light" | "dark";

const MENU_ROW =
  "flex min-h-target w-full cursor-pointer items-center rounded-md px-2.5 text-left text-body text-ink-primary hover:bg-surface-hover";

/**
 * The account button and its menu (§9, Account menu): an `avatar` circle with
 * the initials inside a `target-min` button named "Account"; the menu has the person,
 * Switch organisation (only where there is one to switch to), the theme as a
 * Light/Dark radio pair, and Sign out. Rows are `target-min`.
 */
export function AccountMenu({
  initials,
  name,
  email,
  organisation,
  theme,
  onThemeChange,
  onSwitchOrganisation,
  onSignOut,
  signingOut = false,
  footer,
}: {
  readonly initials: string;
  readonly name: string;
  readonly email: string;
  /** The active organisation's name, or null when the list no longer has it. */
  readonly organisation: string | null;
  readonly theme: ThemeChoice;
  readonly onThemeChange: (theme: ThemeChoice) => void;
  readonly onSwitchOrganisation?: (() => void) | undefined;
  readonly onSignOut: () => void;
  /** While the sign-out is in flight: the row says so and does nothing more. */
  readonly signingOut?: boolean | undefined;
  /** Below Sign out: the service's health, or why the sign-out failed. */
  readonly footer?: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Account"
          className="hit-area inline-flex size-avatar cursor-pointer items-center justify-center rounded-pill"
        >
          <span
            aria-hidden="true"
            className="inline-flex size-avatar items-center justify-center rounded-pill border border-border-default bg-surface-control text-ui-strong text-ink-secondary"
          >
            {initials}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent aria-label="Account" className="gap-1">
        <div className="flex flex-col gap-0.5 px-2.5 pb-2">
          <p className="text-body-strong text-ink-primary">{name}</p>
          <p className="text-caption break-words text-ink-muted">{email}</p>
          {organisation !== null && (
            <p className="text-caption text-ink-secondary">{organisation}</p>
          )}
        </div>
        {onSwitchOrganisation !== undefined && (
          <button type="button" onClick={onSwitchOrganisation} className={MENU_ROW}>
            Switch organisation
          </button>
        )}
        <fieldset className="flex flex-col border-t border-border-subtle pt-1">
          <legend className="px-2.5 pt-2 text-eyebrow text-ink-muted uppercase">Theme</legend>
          {(["light", "dark"] as const).map((choice) => (
            <label key={choice} className={MENU_ROW}>
              <input
                type="radio"
                name="theme"
                value={choice}
                checked={theme === choice}
                onChange={() => {
                  onThemeChange(choice);
                }}
                className="mr-2.75 cursor-pointer accent-accent"
              />
              {choice === "light" ? "Light" : "Dark"}
            </label>
          ))}
        </fieldset>
        <button
          type="button"
          onClick={onSignOut}
          disabled={signingOut}
          aria-busy={signingOut}
          className={cn(MENU_ROW, "border-t border-border-subtle disabled:cursor-wait")}
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
        {footer !== undefined && (
          <div className="flex flex-col gap-2 border-t border-border-subtle px-2.5 pt-2.5 text-caption text-ink-muted">
            {footer}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
