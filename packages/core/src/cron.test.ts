import { describe, expect, it } from "vitest";
import { validateCronExpression } from "./cron.ts";

describe("validateCronExpression", () => {
  it("accepts valid standard 5-part cron expressions", () => {
    expect(validateCronExpression("* * * * *").isValid).toBe(true);
    expect(validateCronExpression("0 6 * * *").isValid).toBe(true);
    expect(validateCronExpression("0 * * * *").isValid).toBe(true);
    expect(validateCronExpression("*/15 * * * *").isValid).toBe(true);
    expect(validateCronExpression("0 9-17 * * 1-5").isValid).toBe(true);
    expect(validateCronExpression("0 0 1,15 * *").isValid).toBe(true);
    expect(validateCronExpression("30 4 1 1 0").isValid).toBe(true);
  });

  it("rejects blank or invalid field counts", () => {
    expect(validateCronExpression("").isValid).toBe(false);
    expect(validateCronExpression("   ").isValid).toBe(false);
    expect(validateCronExpression("* * *").isValid).toBe(false);
    expect(validateCronExpression("* * * * * *").isValid).toBe(false);
  });

  it("rejects out-of-bounds minute, hour, day, month, and day-of-week", () => {
    // Minute > 59
    expect(validateCronExpression("60 * * * *").isValid).toBe(false);
    // Hour > 23
    expect(validateCronExpression("0 24 * * *").isValid).toBe(false);
    // Day of month = 0 or > 31
    expect(validateCronExpression("0 0 0 * *").isValid).toBe(false);
    expect(validateCronExpression("0 0 32 * *").isValid).toBe(false);
    // Month = 0 or > 12
    expect(validateCronExpression("0 0 1 0 *").isValid).toBe(false);
    expect(validateCronExpression("0 0 1 13 *").isValid).toBe(false);
    // Day of week > 6
    expect(validateCronExpression("0 0 * * 7").isValid).toBe(false);
  });

  it("rejects invalid range or step formats", () => {
    expect(validateCronExpression("5-2 * * * *").isValid).toBe(false);
    expect(validateCronExpression("*/0 * * * *").isValid).toBe(false);
    expect(validateCronExpression("abc * * * *").isValid).toBe(false);
  });
});
