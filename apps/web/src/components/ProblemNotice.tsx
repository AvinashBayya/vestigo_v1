import { Button, FailedAlert } from "@repo/ui";
import type { ReactNode } from "react";
import { ApiProblem } from "../api.ts";
import { messageFor } from "../messages.ts";
import { LockedNotice } from "./LockedNotice.tsx";

/**
 * A failure (§8 Failed): the failure tint and edge, a dot, what went wrong in
 * plain words, the code for support ("Code: X", only where one exists), and
 * what the person can do. With a `title`, the message is the reason beneath
 * it; without one, the message is the title, so nothing generic stands in.
 */
export function ProblemNotice({
  error,
  title,
  onRetry,
  children,
}: {
  readonly error: unknown;
  /** What failed, when the screen can say it ("The evidence could not be read."). */
  readonly title?: string | undefined;
  /** Offers "Try again", which calls this. */
  readonly onRetry?: (() => void) | undefined;
  /** What the person can do next, when there is more than retrying. */
  readonly children?: ReactNode;
}) {
  // A refusal by the person-data gate is the Locked state, not a failure.
  if (error instanceof ApiProblem && error.locked !== null) {
    return <LockedNotice locked={error.locked} />;
  }
  const message = messageFor(error);
  return (
    <FailedAlert
      title={title === undefined ? message.text : title}
      reason={title === undefined ? undefined : message.text}
      code={message.code}
      action={
        onRetry === undefined ? undefined : (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        )
      }
    >
      {children === undefined || children === null ? null : (
        <div className="flex flex-col items-start gap-1 text-prose-small text-ink-secondary">
          {children}
        </div>
      )}
    </FailedAlert>
  );
}
