import { Notice } from "@repo/ui";
import type { Locked } from "../api.ts";
import type { LockedEventData } from "../run/progress.ts";

const WHY: Readonly<Record<Locked["reason"], string>> = {
  MODULE_NOT_IN_PLAN: "Your organisation's plan does not include it.",
  VETTING_NOT_APPROVED: "Your organisation's vetting has not been approved.",
};

/**
 * The Locked notice's frame (§8 Locked): a neutral notice, never the failure
 * palette, announced politely (role="status"). Its lines are direct children,
 * so the next step sits beside the eyebrow and what the module does.
 */
const LOCKED_FRAME = "flex flex-col gap-1.75 rounded-inner px-3.75 py-3";

/**
 * The Locked state (DESIGN-SYSTEM §8): the eyebrow, what the module does, what
 * was withheld and why, the next step in `body-strong` and the reason code in
 * `mono-caption`, all as the API stated them. Information, never a scolding.
 */
export function LockedNotice({ locked }: { readonly locked: Locked }) {
  return (
    <Notice className={LOCKED_FRAME}>
      <p className="text-eyebrow uppercase">Locked</p>
      <p className="text-body">{locked.moduleSummary}</p>
      <p className="text-prose-small">
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
export const ACCESS_NEXT_STEP: Readonly<
  Record<AccessReason, { text: string; link: "/sign-in" | "/tenant" | null }>
> = {
  CREDENTIAL_REVOKED: { text: "Sign in again to keep following this run.", link: "/sign-in" },
  MEMBERSHIP_REVOKED: { text: "Choose an organisation you still belong to.", link: "/tenant" },
  PERMISSION_LOST: {
    text: "Ask an owner or administrator of this organisation to give your role permission to read runs.",
    link: null,
  },
};

export function isAccessReason(reason: LockedEventData["reason"]): reason is AccessReason {
  return reason in ACCESS_NEXT_STEP;
}
