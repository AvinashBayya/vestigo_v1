import { useEffect, useState } from "react";
import { api } from "./client/index.ts";

/** Every external call has a timeout (CLAUDE.md §5). */
const HEALTH_TIMEOUT_MS = 5_000;

type HealthState =
  | { readonly kind: "checking" }
  | { readonly kind: "reachable"; readonly status: string }
  | { readonly kind: "unreachable"; readonly reason: string };

function describeFailure(error: unknown): string {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return `no response within ${String(HEALTH_TIMEOUT_MS / 1000)}s`;
  }
  return error instanceof Error ? error.message : "request failed";
}

/**
 * Shows the API's health as reported through the generated client. An
 * unreachable or failing API is shown as such, never as "ok".
 */
export function HealthStatus() {
  const [state, setState] = useState<HealthState>({ kind: "checking" });

  useEffect(() => {
    const unmounted = new AbortController();
    const signal = AbortSignal.any([unmounted.signal, AbortSignal.timeout(HEALTH_TIMEOUT_MS)]);

    api.GET("/health", { signal }).then(
      ({ data, response }) => {
        if (unmounted.signal.aborted) return;
        setState(
          data === undefined
            ? { kind: "unreachable", reason: `HTTP ${String(response.status)}` }
            : { kind: "reachable", status: data.status },
        );
      },
      (error: unknown) => {
        if (unmounted.signal.aborted) return;
        setState({ kind: "unreachable", reason: describeFailure(error) });
      },
    );

    return () => {
      unmounted.abort();
    };
  }, []);

  return (
    <p role="status">
      {state.kind === "checking" && "API health: checking…"}
      {state.kind === "reachable" && `API health: ${state.status}`}
      {state.kind === "unreachable" && `API health: unreachable (${state.reason})`}
    </p>
  );
}
