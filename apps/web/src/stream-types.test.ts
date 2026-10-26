/**
 * The progress stream's events are typed by the generated client, not by
 * description text: these assertions are checked by the type checker, so the
 * build fails if the API stops documenting any of them.
 */
import { describe, expectTypeOf, it } from "vitest";
import type { components, paths } from "./client/schema.gen.ts";

type Schemas = components["schemas"];
type StreamEvent = Schemas["RunStreamEvent"];
type Of<Name extends StreamEvent["event"]> = Extract<StreamEvent, { event: Name }>["data"];

describe("the generated client types the run progress stream", () => {
  it("documents the stream's response as one of six named events", () => {
    expectTypeOf<
      paths["/api/v1/runs/{id}/events"]["get"]["responses"][200]["content"]["text/event-stream"]
    >().toEqualTypeOf<StreamEvent>();
    expectTypeOf<StreamEvent["event"]>().toEqualTypeOf<
      "run" | "job" | "end" | "locked" | "timeout" | "error"
    >();
  });

  it("types each event's payload", () => {
    expectTypeOf<Of<"job">>().toHaveProperty("sourceLabel").toEqualTypeOf<string>();
    expectTypeOf<Of<"job">["outcome"]>().toEqualTypeOf<
      | "FOUND"
      | "NOT_FOUND"
      | "FAILED"
      | "UNAVAILABLE"
      | "NEEDS_CREDENTIALS"
      | "REFUSED"
      | "EMPTY_UNCONFIRMED"
      | null
    >();
    expectTypeOf<Of<"run">>().not.toHaveProperty("jobs");
    expectTypeOf<Of<"end">["status"]>().extract<null>().toEqualTypeOf<null>();
    expectTypeOf<Of<"timeout">["reconnect"]>().toEqualTypeOf<true>();
    expectTypeOf<Of<"error">["code"]>().toEqualTypeOf<"STREAM_FAILED">();
  });

  it("types the locked event's reason, and shares one Locked block with every 403", () => {
    expectTypeOf<Of<"locked">["reason"]>().toEqualTypeOf<
      | "CREDENTIAL_REVOKED"
      | "MEMBERSHIP_REVOKED"
      | "PERMISSION_LOST"
      | "MODULE_NOT_IN_PLAN"
      | "VETTING_NOT_APPROVED"
    >();
    expectTypeOf<Of<"locked">["locked"]>().toEqualTypeOf<Schemas["Locked"] | null>();
    expectTypeOf<Of<"locked">["recheckIntervalMs"]>().toEqualTypeOf<number>();
  });
});
