/**
 * The one way a collector runs an external tool container, and the only place
 * in this package that starts a subprocess.
 *
 * A tool container (Agent-Reach, and later theHarvester, SpiderFoot, …) does
 * its own egress: it is reached as a LOCAL_ANALYSIS source (network: null), so
 * the in-process fetcher — its SSRF checks, its host allowlist, its forbidden-
 * platform guard — neither sees nor bounds what the container contacts. That is
 * by design (CLAUDE.md §3: platform scrapers are operator-configured local
 * adapters), but it means everything the fetcher normally enforces must be held
 * here instead:
 *
 *   - argv only, never a shell. `execFile` passes the argument vector straight
 *     to the OS; nothing a collector hands as a target is ever interpolated
 *     into a command line, so there is no shell to inject into (CLAUDE.md §3).
 *   - a hard timeout, and an abort tied to the run's budget: a hung container
 *     is killed, never an unbounded wait (CLAUDE.md §5).
 *   - a capped stdout, so a runaway tool cannot exhaust the worker's memory.
 *   - a typed outcome for every failure: a transient one (could not start, or
 *     timed out) is retryable; a tool that ran and failed, or printed something
 *     unusable, is permanent for this request (CLAUDE.md §5, §8).
 *
 * The command and its fixed leading arguments are configuration the caller
 * supplies (how the container is launched is a deployment choice), never
 * hard-coded here. This module only runs what it is given, safely.
 */
import { execFile } from "node:child_process";
import { AppError } from "@repo/core";
import {
  UpstreamResponseError,
  UpstreamTimeoutError,
  UpstreamUnavailableError,
} from "../errors.ts";

/**
 * A tool container ran and exited non-zero: it started, did its work and
 * reported failure (a channel error, a login the deployment has not provided,
 * an unsupported target). Permanent for this request — a retry changes nothing
 * until the deployment does. The exit code is kept; no output is repeated, as
 * it may carry third-party content.
 */
export class ToolFailedError extends AppError {
  readonly code = "TOOL_FAILED";
  readonly exitCode: number | null;

  constructor(toolId: string, exitCode: number | null) {
    super(
      `The ${toolId} tool exited with status ${exitCode === null ? "unknown" : String(exitCode)}.`,
    );
    this.name = "ToolFailedError";
    this.exitCode = exitCode;
  }
}

/** A tool container printed more than its output cap. Permanent for this request. */
export class ToolOutputTooLargeError extends AppError {
  readonly code = "TOOL_OUTPUT_TOO_LARGE";

  constructor(toolId: string, maxBytes: number) {
    super(`The ${toolId} tool printed more than ${String(maxBytes)} bytes.`);
    this.name = "ToolOutputTooLargeError";
  }
}

/** What to run, and the bounds it runs within. */
export interface ContainerInvocation {
  /** A label for errors and logs. Names the tool, never a person or a secret. */
  readonly toolId: string;
  /** The executable to run. Configuration the caller resolves, never hard-coded. */
  readonly command: string;
  /** Fixed leading argv the deployment supplies, e.g. how the container is launched. */
  readonly baseArgs: readonly string[];
  /** The tool's own argv: its channel, action and the target, each a separate arg. */
  readonly toolArgs: readonly string[];
  /** The tool's own budget; the caller also races the whole run against its budget. */
  readonly timeoutMs: number;
  /** The most stdout to buffer; more fails the invocation rather than growing unbounded. */
  readonly maxOutputBytes: number;
  /** Aborts the child when the run's budget is spent (RunContext.signal). */
  readonly signal: AbortSignal;
}

/** A tool container's successful output. */
export interface ContainerOutput {
  /** stdout parsed as JSON — what a collector maps into its result. */
  readonly json: unknown;
  /** The raw stdout text, recorded verbatim as the local analysis evidence. */
  readonly stdout: string;
}

/**
 * Runs a tool container and returns its parsed stdout. Injected into a
 * collector so a test can supply a recorded or synthetic output instead of
 * starting a process.
 */
export type ContainerRunner = (invocation: ContainerInvocation) => Promise<ContainerOutput>;

/** True when execFile aborted the child because stdout exceeded maxBuffer. */
function isMaxBufferError(error: NodeJS.ErrnoException): boolean {
  return (
    error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" || /maxBuffer/i.test(error.message)
  );
}

/**
 * Interprets a successfully-exited tool's stdout. Throws a typed, permanent
 * error for empty or non-JSON output; a failure here is never read as "nothing
 * found" (the collector would otherwise lose the distinction).
 */
function parseToolOutput(toolId: string, text: string): ContainerOutput {
  if (text.trim().length === 0) {
    throw new UpstreamResponseError(`the ${toolId} tool printed nothing`);
  }
  try {
    return { json: JSON.parse(text), stdout: text };
  } catch {
    throw new UpstreamResponseError(`the ${toolId} tool did not print JSON`);
  }
}

/**
 * The production runner: starts the container with `execFile` (no shell),
 * bounds it by time and output, and maps every failure to a typed error.
 */
export const runContainerTool: ContainerRunner = (invocation) =>
  new Promise<ContainerOutput>((resolve, reject) => {
    const { toolId, command, baseArgs, toolArgs, timeoutMs, maxOutputBytes, signal } = invocation;
    if (signal.aborted) {
      reject(new UpstreamTimeoutError(toolId, timeoutMs));
      return;
    }
    // Our own controller, so the tool's timeout and the run's budget both abort
    // the child, and we can tell an abort apart from the tool's own exit.
    const controller = new AbortController();
    const onAbort = () => {
      controller.abort();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    execFile(
      command,
      [...baseArgs, ...toolArgs],
      {
        signal: controller.signal,
        maxBuffer: maxOutputBytes,
        windowsHide: true,
        encoding: "utf8",
      },
      (error, stdout) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        const text = typeof stdout === "string" ? stdout : String(stdout);
        if (error !== null) {
          const err = error as NodeJS.ErrnoException;
          // A budget or timeout abort: retryable, as a slow upstream is.
          if (controller.signal.aborted) {
            reject(new UpstreamTimeoutError(toolId, timeoutMs));
            return;
          }
          if (isMaxBufferError(err)) {
            reject(new ToolOutputTooLargeError(toolId, maxOutputBytes));
            return;
          }
          // Could not start the tool at all (ENOENT, EACCES, …): a deployment or
          // infrastructure condition, treated as transient so a flapping daemon
          // retries rather than failing the job outright.
          if (typeof err.code === "string") {
            reject(new UpstreamUnavailableError(`could not start the ${toolId} tool`));
            return;
          }
          // It ran and exited non-zero.
          reject(new ToolFailedError(toolId, typeof err.code === "number" ? err.code : null));
          return;
        }
        try {
          resolve(parseToolOutput(toolId, text));
        } catch (parseError) {
          reject(
            parseError instanceof Error
              ? parseError
              : new UpstreamResponseError(`the ${toolId} tool output could not be read`),
          );
        }
      },
    );
  });
