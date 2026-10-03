import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "./button.tsx";
import { cn } from "./cn.ts";
import { Field } from "./field.tsx";
import { Notice } from "./notice.tsx";

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
