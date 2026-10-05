import { Notice } from "@repo/ui";
import type { ReactNode } from "react";
import { ApiProblem } from "../api.ts";
import { messageFor } from "../messages.ts";
import { LockedNotice } from "./LockedNotice.tsx";

/** A failure: what went wrong, in plain words, with the code for support (§8 Failed). */
export function ProblemNotice({
  error,
  children,
}: {
  readonly error: unknown;
  /** What the person can do next, when there is more than retrying. */
  readonly children?: ReactNode;
}) {
  // A refusal by the person-data gate is the Locked state, not a failure.
  if (error instanceof ApiProblem && error.locked !== null) {
    return <LockedNotice locked={error.locked} />;
  }
  const message = messageFor(error);
  return (
    <Notice tone="failure" className="flex flex-col gap-1">
      <p>{message.text}</p>
      {children}
      {message.code === null ? null : (
        <p className="font-mono text-mono-caption">Code: {message.code}</p>
      )}
    </Notice>
  );
}
