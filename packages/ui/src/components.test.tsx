import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "./button.tsx";
import { CLAIM_STRENGTH_LABELS, ClaimStrength } from "./claim-strength.tsx";
import { cn } from "./cn.ts";
import { ENTITY_CLASSES, EntityClassName } from "./entity-class.tsx";
import { Field } from "./field.tsx";
import { Notice } from "./notice.tsx";
import { COLLECTOR_STATUSES, StatusChip } from "./status-chip.tsx";
import { Unmeasured } from "./unmeasured.tsx";

afterEach(() => {
  cleanup();
});

describe("Field", () => {
  it("labels its input, and ties the hint and the error to it (§7)", () => {
    render(<Field label="Email address" hint="[hint]" error="[why it is refused]" />);
    const input = screen.getByLabelText("Email address");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const describedBy = (input.getAttribute("aria-describedby") ?? "").split(" ");
    const described = describedBy.map((id) => document.getElementById(id)?.textContent);
    expect(described).toEqual(["[hint]", "[why it is refused]"]);
  });

  it("is not marked invalid without an error", () => {
    render(<Field label="Password" />);
    expect(screen.getByLabelText("Password").hasAttribute("aria-invalid")).toBe(false);
  });
});

describe("Button", () => {
  it("is a real button that does not submit unless asked to (§7)", () => {
    render(<Button>Continue</Button>);
    expect(screen.getByRole("button", { name: "Continue" }).getAttribute("type")).toBe("button");
  });
});

describe("Notice", () => {
  it("announces a failure at once, and information politely", () => {
    render(
      <>
        <Notice tone="failure">[failed]</Notice>
        <Notice>[information]</Notice>
      </>,
    );
    expect(screen.getByRole("alert").textContent).toBe("[failed]");
    expect(screen.getByRole("status").textContent).toBe("[information]");
  });
});

describe("cn", () => {
  it("keeps a type style and a colour together, and lets a later colour win", () => {
    expect(cn("text-body text-ink-primary", "text-ink-muted")).toBe("text-body text-ink-muted");
    expect(cn("p-3", "p-5")).toBe("p-5");
    expect(cn("bg-surface-raised", "bg-accent")).toBe("bg-accent");
  });
});

describe("Unmeasured", () => {
  it("shows an em dash, never a number, and says why in its name and its tooltip (§1)", async () => {
    render(<Unmeasured reason="[why there is no value]" />);
    const dash = screen.getByRole("button", { name: "Not measured. [why there is no value]" });
    expect(dash.textContent).toBe("—");
    fireEvent.focus(dash);
    expect((await screen.findByRole("tooltip")).textContent).toBe("[why there is no value]");
  });
});

describe("StatusChip", () => {
  it("always renders the status as words, never colour alone (§2, §3)", () => {
    render(
      <>
        {COLLECTOR_STATUSES.map((status) => (
          <StatusChip key={status} status={status} />
        ))}
      </>,
    );
    expect(document.body.textContent).toBe(
      "RanRunningPartialFailedNeeds keySkippedHeldQueuedCancelledReady",
    );
  });
});

describe("ClaimStrength", () => {
  it("always renders the strength as its word, never colour alone (§2)", () => {
    render(
      <>
        {CLAIM_STRENGTH_LABELS.map((strength) => (
          <ClaimStrength key={strength} strength={strength} />
        ))}
      </>,
    );
    expect(document.body.textContent).toBe("OBSERVEDREPORTEDDERIVEDCORRELATEDINFERREDHYPOTHESIS");
  });
});

describe("EntityClassName", () => {
  it("names every class in words beside its colour (§6)", () => {
    render(
      <>
        {ENTITY_CLASSES.map((entityClass) => (
          <EntityClassName key={entityClass} entityClass={entityClass} />
        ))}
      </>,
    );
    expect(document.body.textContent).toBe(
      "PersonOrganisationDomainIP addressEmailUsernamePhoneURLAccountLocation",
    );
  });

  it("lets a later entity colour replace an earlier one", () => {
    expect(cn("bg-entity-domain-ring", "bg-entity-person-ring")).toBe("bg-entity-person-ring");
  });
});
