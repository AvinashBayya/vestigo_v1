import { Notice } from "@repo/ui";
import type { ReactNode } from "react";
import { messageFor } from "../messages.ts";

/** A failure: what went wrong, in plain words, with the code for support (§8 Failed). */
export function ProblemNotice({
  error,
  children,
}: {
  readonly error: unknown;
  /** What the person can do next, when there is more than retrying. */
  readonly children?: ReactNode;
}) {
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
