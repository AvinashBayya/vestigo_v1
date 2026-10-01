/**
 * The CI corpus of prompt-injection payloads (ARCHITECTURE-DECISIONS §7).
 *
 * For every payload, set inside the kind of content the platform collects:
 *   1. the scanner marks it as instruction-like;
 *   2. it reaches the model only inside the data block, escaped, never in the
 *      instructions;
 *   3. a model that OBEYS it is rejected, by the guards the entry names, on
 *      both attempts: nothing from the answer is used;
 *   4. an honest answer about the same records passes.
 * The benign set must not be marked: ordinary text about AI is not an attack.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AccumulatingMeter,
  DATA_TAG,
  generateValidated,
  LlmOutputRejectedError,
  scanText,
  type UntrustedRecord,
} from "../src/index.ts";
import { answer, ENDPOINT, ScriptedProvider, statementsTask } from "./support.ts";

interface Payload {
  readonly id: string;
  readonly kind: string;
  readonly technique: string;
  readonly text: string;
  readonly hiddenSuffix?: string;
  readonly obedient: { readonly text?: string; readonly echoSystem?: true };
  readonly expectGuards: readonly string[];
}

interface Corpus {
  readonly payloads: readonly Payload[];
  readonly benign: readonly { readonly id: string; readonly kind: string; readonly text: string }[];
}

const corpus = JSON.parse(
  readFileSync(join(import.meta.dirname, "fixtures", "injection-corpus.json"), "utf8"),
) as Corpus;

/** Encodes ASCII as invisible Unicode tag characters (U+E0000 + code). */
const asTags = (text: string): string =>
  Array.from(text, (c) => String.fromCodePoint(0xe0000 + (c.codePointAt(0) as number))).join("");

const textOf = (payload: Payload): string =>
  payload.text + (payload.hiddenSuffix === undefined ? "" : asTags(payload.hiddenSuffix));

function recordsFor(payload: Payload): UntrustedRecord[] {
  return [
    { ref: "E1", source: `[${payload.kind} source]`, content: { text: textOf(payload) } },
    { ref: "E2", source: "[other source]", content: { text: "[an unrelated clean record]" } },
  ];
}

describe("the injection corpus", () => {
  it("holds every kind of collected content the brief names", () => {
    const kinds = new Set(corpus.payloads.map((p) => p.kind));
    for (const kind of ["known-payload", "web-page", "news-article", "profile-bio"]) {
      expect(kinds, kind).toContain(kind);
    }
  });

  describe.each(corpus.payloads.map((p) => [p.id, p] as const))("%s", (_id, payload) => {
    it("is marked as instruction-like by the scanner", () => {
      expect(scanText(textOf(payload)).length).toBeGreaterThan(0);
    });

    it("reaches the model only inside the data block, escaped", async () => {
      const provider = new ScriptedProvider([
        () => answer({ text: "Record E1 holds text addressed to AI systems.", refs: ["E1"] }),
      ]);
      await generateValidated(
        { endpoint: ENDPOINT, provider, cache: null, cacheTtlSeconds: 60 },
        "[tenant]",
        new AccumulatingMeter(),
        statementsTask(recordsFor(payload)),
      );
      const [request] = provider.requests;
      if (request === undefined) return expect.unreachable("no request was sent");
      const [system, user] = request.messages;
      const probe = payload.text.slice(0, 24);
      expect(system?.content).not.toContain(probe);
      const opened = user?.content.indexOf(`<${DATA_TAG} boundary=`) ?? -1;
      expect(opened).toBeGreaterThan(0);
      // Markup characters never appear raw: the payload's text, if present, sits after the tag.
      const position = user?.content.indexOf(probe) ?? -1;
      if (position !== -1) expect(position).toBeGreaterThan(opened);
      expect(user?.content.slice(opened)).not.toMatch(/<\|im_start\|>|<div/);
    });

    it("rejects a model that obeys it, on both attempts, by the guards named", async () => {
      const obey = (request: { messages: readonly { content: string }[] }) =>
        answer({
          text:
            payload.obedient.echoSystem === true
              ? (request.messages[0]?.content ?? "[no system message]")
              : (payload.obedient.text ?? "[no obedient text]"),
          refs: ["E1"],
        });
      const provider = new ScriptedProvider([obey, obey]);
      const meter = new AccumulatingMeter();
      const error = await generateValidated(
        { endpoint: ENDPOINT, provider, cache: null, cacheTtlSeconds: 60 },
        "[tenant]",
        meter,
        statementsTask(recordsFor(payload)),
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(LlmOutputRejectedError);
      const codes = (error as LlmOutputRejectedError).problems.map((p) => p.code);
      for (const guard of payload.expectGuards) expect(codes, guard).toContain(guard);
      // Both attempts reached the model, and both were metered.
      expect(provider.requests).toHaveLength(2);
      expect(meter.calls).toHaveLength(2);
    });

    it("accepts an honest answer about the same records", async () => {
      const provider = new ScriptedProvider([
        () =>
          answer({
            text: "Record E1 holds text addressed to AI systems; it was treated as data.",
            refs: ["E1"],
          }),
      ]);
      const result = await generateValidated(
        { endpoint: ENDPOINT, provider, cache: null, cacheTtlSeconds: 60 },
        "[tenant]",
        new AccumulatingMeter(),
        statementsTask(recordsFor(payload)),
      );
      expect(result.attempts).toBe(1);
    });
  });

  it.each(corpus.benign.map((b) => [b.id, b] as const))(
    "does not mark ordinary text as instructions: %s",
    (_id, benign) => {
      expect(scanText(benign.text)).toEqual([]);
    },
  );
});
