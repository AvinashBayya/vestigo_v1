import { useEffect, useState } from "react";
import { API_TIMEOUT_MS, unwrap } from "../api.ts";
import { api } from "../client/index.ts";
import {
  applyEvent,
  createEventParser,
  decodeEvent,
  EMPTY_PROGRESS,
  STREAM_STALL_MS,
  StreamDropped,
  type RunProgress,
} from "./progress.ts";

/** Where the page's connection to the run's progress stream stands. */
export type Connection =
  | { readonly kind: "connecting" }
  | { readonly kind: "live" }
  /** The stream said the run is settled, or that access is now refused: nothing more will come. */
  | { readonly kind: "closed" }
  /** The stream stopped early. The run is unaffected; what is shown is as of the last update. */
  | { readonly kind: "dropped"; readonly error: unknown };

/**
 * A run's live progress from GET /api/v1/runs/{id}/events, through the
 * generated client. Connecting is bounded by the API timeout and reading by
 * the stall timeout. A `timeout` event (the stream's maximum length)
 * reconnects at once; any other early stop is reported, with `reconnect`.
 */
export function useRunStream(runId: string) {
  const [progress, setProgress] = useState<RunProgress>(EMPTY_PROGRESS);
  const [connection, setConnection] = useState<Connection>({ kind: "connecting" });
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [attempt, setAttempt] = useState(0);

  const reconnect = () => {
    setConnection({ kind: "connecting" });
    setAttempt((current) => current + 1);
  };

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abortAfter = (ms: number, reason: unknown) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        controller.abort(reason);
      }, ms);
    };
    const stalled = new StreamDropped(
      "STREAM_STALLED",
      `The server sent nothing for ${String(STREAM_STALL_MS / 1000)} seconds, so the connection is treated as lost.`,
    );

    const read = async (): Promise<"closed" | "reconnect"> => {
      abortAfter(
        API_TIMEOUT_MS,
        new DOMException("The server did not answer in time.", "TimeoutError"),
      );
      const body = await unwrap(
        api.GET("/api/v1/runs/{id}/events", {
          params: { path: { id: runId } },
          parseAs: "stream",
          signal: controller.signal,
        }),
      );
      if (body === null) {
        throw new StreamDropped("STREAM_PROTOCOL", "The progress stream arrived without a body.");
      }
      if (!disposed) setConnection({ kind: "live" });
      abortAfter(STREAM_STALL_MS, stalled);
      const reader = body.getReader();
      const decoder = new TextDecoder();
      const parser = createEventParser();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          throw new StreamDropped(
            "STREAM_CLOSED",
            "The server closed the progress stream before the run ended.",
          );
        }
        abortAfter(STREAM_STALL_MS, stalled);
        for (const raw of parser.feed(decoder.decode(value, { stream: true }))) {
          const event = decodeEvent(raw);
          if (disposed) return "closed";
          setProgress((current) => applyEvent(current, event));
          setLastUpdate(new Date());
          if (event.event === "end" || event.event === "locked") return "closed";
          if (event.event === "timeout") return "reconnect";
          if (event.event === "error") {
            throw new StreamDropped(
              "STREAM_FAILED",
              "The server's progress stream failed. The run itself is unaffected.",
            );
          }
        }
      }
    };

    read()
      .then(
        (next) => {
          if (disposed) return;
          if (next === "closed") {
            setConnection({ kind: "closed" });
          } else {
            setConnection({ kind: "connecting" });
            setAttempt((current) => current + 1);
          }
        },
        (error: unknown) => {
          if (disposed) return;
          // A stall is our own abort: report it, not the abort it caused.
          const reason: unknown =
            controller.signal.reason instanceof StreamDropped ? controller.signal.reason : error;
          setConnection({ kind: "dropped", error: reason });
        },
      )
      .finally(() => {
        clearTimeout(timer);
        controller.abort();
      });

    return () => {
      disposed = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [runId, attempt]);

  return { progress, connection, lastUpdate, reconnect };
}
