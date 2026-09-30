import { describe, expect, it } from "vitest";
import { AppError } from "./errors.ts";
import { detectTargetType, EmptyTargetError } from "./target-detection.ts";

describe("detectTargetType", () => {
  it.each([
    ["example.com", "DOMAIN", []],
    ["sub.example.co.uk", "DOMAIN", []],
    ["192.0.2.1", "IP_ADDRESS", []],
    ["2001:db8::1", "IP_ADDRESS", []],
    ["https://example.com/path", "URL", ["DOMAIN"]],
    ["someone@example.com", "EMAIL_ADDRESS", []],
    ["+44 20 7946 0000", "PHONE_NUMBER", []],
    [`sha256:${"a".repeat(64)}`, "FILE", []],
    ["octocat", "USERNAME", ["ORGANIZATION"]],
    ["Internet Assigned Numbers Authority", "ORGANIZATION", []],
  ] as const)("%s is %s", (input, primaryType, alternateTypes) => {
    expect(detectTargetType(input)).toEqual({ primaryType, alternateTypes });
  });

  it("does not read an out-of-range dotted quad as an IP address", () => {
    expect(detectTargetType("300.1.1.1").primaryType).not.toBe("IP_ADDRESS");
  });

  it("trims before detecting", () => {
    expect(detectTargetType("  example.com  ").primaryType).toBe("DOMAIN");
  });

  it("regression: an empty input is an error, never a guessed type (legacy answered 'person')", () => {
    for (const empty of ["", "   ", "\t\n"]) {
      expect(() => detectTargetType(empty)).toThrow(EmptyTargetError);
    }
    const error = new EmptyTargetError();
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe("TARGET_EMPTY");
  });
});
