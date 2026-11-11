/**
 * The container tool runner (src/tool/container.ts): the repo's first and only
 * subprocess. Every test runs the real `execFile` path against this same Node
 * binary with a tiny inline script, so nothing external is needed and nothing
 * is faked: the behaviour under test is the runner's, not a stub's.
 *
 * What is pinned:
 *   - argv is passed straight through, with no shell: metacharacters and a
 *     `$VAR` arrive at the child verbatim, unexpanded and unexecuted;
 *   - a hung tool is killed at its timeout, and an already-aborted run never
 *     starts one, both reported as a retryable timeout;
 *   - a non-zero exit is a permanent ToolFailedError carrying the code;
 *   - stdout over the cap is a permanent ToolOutputTooLargeError;
 *   - empty or non-JSON stdout is a permanent UpstreamResponseError;
 *   - a command that cannot start is a retryable UpstreamUnavailableError.
 */
import { describe, expect, it } from "vitest";
import {
  runContainerTool,
  ToolFailedError,
  ToolOutputTooLargeError,
  type ContainerInvocation,
} from "../../src/tool/container.ts";
import { UpstreamResponseError, UpstreamTimeoutError, UpstreamUnavailableError } from "../../src/errors.ts";

const NODE = process.execPath;

/** Runs this Node binary with an inline script as the "tool". */
function invoke(
  script: string,
  options: {
    readonly toolArgs?: readonly string[];
    readonly timeoutMs?: number;
    readonly maxOutputBytes?: number;
    readonly signal?: AbortSignal;
  } = {},
): Promise<Awaited<ReturnType<typeof runContainerTool>>> {
  const invocation: ContainerInvocation = {
    toolId: "test-tool",
    command: NODE,
    baseArgs: ["-e", script, "--"],
    toolArgs: options.toolArgs ?? [],
    timeoutMs: options.timeoutMs ?? 5_000,
    maxOutputBytes: options.maxOutputBytes ?? 1_000_000,
    signal: options.signal ?? new AbortController().signal,
  };
  return runContainerTool(invocation);
}

describe("the container tool runner", () => {
  it("parses the tool's JSON stdout and keeps the raw text", async () => {
    const output = await invoke("console.log(JSON.stringify({ ok: true, items: [1, 2] }))");
    expect(output.json).toEqual({ ok: true, items: [1, 2] });
    expect(JSON.parse(output.stdout)).toEqual({ ok: true, items: [1, 2] });
  });

  it("passes argv straight through, with no shell: metacharacters and $VARS arrive verbatim", async () => {
    // process.argv after ["node", "-e", script, "--"] is the toolArgs.
    const output = await invoke(
      "console.log(JSON.stringify({ argv: process.argv.slice(1) }))",
      { toolArgs: ["a b; rm -rf /", "$HOME", "`whoami`", "second|arg"] },
    );
    expect(output.json).toEqual({
      argv: ["a b; rm -rf /", "$HOME", "`whoami`", "second|arg"],
    });
  });

  it("kills a tool that overruns its timeout and reports a retryable timeout", async () => {
    await expect(
      invoke("setTimeout(() => {}, 60000)", { timeoutMs: 150 }),
    ).rejects.toBeInstanceOf(UpstreamTimeoutError);
  });

  it("never starts a tool when the run is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      invoke("console.log('{}')", { signal: controller.signal }),
    ).rejects.toBeInstanceOf(UpstreamTimeoutError);
  });

  it("aborts a running tool when the run's budget signal fires", async () => {
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, 100);
    await expect(
      invoke("setTimeout(() => {}, 60000)", { signal: controller.signal, timeoutMs: 60_000 }),
    ).rejects.toBeInstanceOf(UpstreamTimeoutError);
  });

  it("reports a non-zero exit as a permanent ToolFailedError carrying the code", async () => {
    const error = await invoke("process.exit(3)").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolFailedError);
    expect((error as ToolFailedError).exitCode).toBe(3);
    expect((error as ToolFailedError).code).toBe("TOOL_FAILED");
  });

  it("reports stdout over the cap as a permanent ToolOutputTooLargeError", async () => {
    await expect(
      invoke("console.log('x'.repeat(100000))", { maxOutputBytes: 1_000 }),
    ).rejects.toBeInstanceOf(ToolOutputTooLargeError);
  });

  it("reports empty stdout as an unusable response", async () => {
    await expect(invoke("process.stdout.write('')")).rejects.toBeInstanceOf(
      UpstreamResponseError,
    );
  });

  it("reports non-JSON stdout as an unusable response", async () => {
    await expect(invoke("console.log('not json at all')")).rejects.toBeInstanceOf(
      UpstreamResponseError,
    );
  });

  it("reports a command that cannot start as a retryable unavailability", async () => {
    const invocation: ContainerInvocation = {
      toolId: "missing-tool",
      command: "a-command-that-does-not-exist-vestigo-xyz",
      baseArgs: [],
      toolArgs: [],
      timeoutMs: 5_000,
      maxOutputBytes: 1_000,
      signal: new AbortController().signal,
    };
    await expect(runContainerTool(invocation)).rejects.toBeInstanceOf(UpstreamUnavailableError);
  });
});
