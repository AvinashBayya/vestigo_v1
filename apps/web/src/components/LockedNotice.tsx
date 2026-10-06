import { Notice } from "@repo/ui";
import { Link } from "@tanstack/react-router";
import type { Locked } from "../api.ts";
import type { LockedEventData } from "../run/progress.ts";

const WHY: Readonly<Record<Locked["reason"], string>> = {
  MODULE_NOT_IN_PLAN: "Your organisation's plan does not include it.",
  VETTING_NOT_APPROVED: "Your organisation's vetting has not been approved.",
};

/**
 * The Locked state (DESIGN-SYSTEM §8): what the module does, why it is off and
 * the next step, all as the API stated them. Information, never a scolding.
 */
export function LockedNotice({ locked }: { readonly locked: Locked }) {
  return (
    <Notice className="flex flex-col gap-2">
      <p className="text-eyebrow uppercase">Locked</p>
      <p>{locked.moduleSummary}</p>
      <p>
        {WHY[locked.reason]} {locked.withheld}
      </p>
      <p className="text-body-strong">{locked.nextStep}</p>
      <p className="font-mono text-mono-caption">Code: {locked.reason}</p>
    </Notice>
  );
}

type AccessReason = Exclude<LockedEventData["reason"], Locked["reason"]>;

/**
 * The next step for a refusal that is about the reader's access, not person
 * data. Each is something this app can do: sign in, choose an organisation, or
 * ask the roles that can change members (owner and admin hold member:update).
 */
const ACCESS_NEXT_STEP: Readonly<
  Record<AccessReason, { text: string; link: "/sign-in" | "/tenant" | null }>
> = {
  CREDENTIAL_REVOKED: { text: "Sign in again to keep following this run.", link: "/sign-in" },
  MEMBERSHIP_REVOKED: { text: "Choose an organisation you still belong to.", link: "/tenant" },
  PERMISSION_LOST: {
    text: "Ask an owner or administrator of this organisation to give your role permission to read runs.",
    link: null,
  },
};

/**
 * The Locked state for a stream whose re-check refused the reader's access
 * (session, membership or permission). What is withheld, why (the API's own
 * detail), and the next step. A policy decision, so never shown as a failure.
 */
export function AccessLockedNotice({
  reason,
  code,
  detail,
  asOf,
}: {
  readonly reason: AccessReason;
  readonly code: string;
  readonly detail: string;
  readonly asOf: string;
}) {
  const next = ACCESS_NEXT_STEP[reason];
  return (
    <Notice className="flex flex-col gap-2">
      <p className="text-eyebrow uppercase">Locked</p>
      <p>
        Live updates for this run are withheld. What is shown is as of the check at{" "}
        <time className="font-mono" dateTime={asOf}>
          {asOf}
        </time>
        .
      </p>
      <p>{detail}</p>
      <p className="text-body-strong">
        {next.link === null ? next.text : <Link to={next.link}>{next.text}</Link>}
      </p>
      <p className="font-mono text-mono-caption">
        Reason: {reason} · Code: {code}
      </p>
    </Notice>
  );
}

export function isAccessReason(reason: LockedEventData["reason"]): reason is AccessReason {
  return reason in ACCESS_NEXT_STEP;
}
