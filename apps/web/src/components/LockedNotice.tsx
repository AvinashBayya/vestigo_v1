import { Notice } from "@repo/ui";
import type { Locked } from "../api.ts";

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
