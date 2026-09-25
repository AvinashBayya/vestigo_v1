import { describe, expect, it } from "vitest";
import { AppError, NotImplementedError } from "./errors.ts";

describe("NotImplementedError", () => {
  it("carries a machine-readable code and names the missing feature", () => {
    const error = new NotImplementedError("worker.queue-consumption", "built in Phase 4");
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("NOT_IMPLEMENTED");
    expect(error.feature).toBe("worker.queue-consumption");
    expect(error.name).toBe("NotImplementedError");
    expect(error.message).toBe("worker.queue-consumption is not implemented: built in Phase 4");
  });
});
