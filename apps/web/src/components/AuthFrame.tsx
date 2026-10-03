import { PRODUCT_NAME } from "@repo/config";
import { Panel } from "@repo/ui";
import type { ReactNode } from "react";

/** The single-column frame every sign-in step sits in. */
export function AuthFrame({
  title,
  intro,
  children,
}: {
  readonly title: string;
  readonly intro?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-start justify-center px-4 py-10">
      <div className="flex w-full max-w-form flex-col gap-6">
        <p className="text-eyebrow uppercase text-ink-muted">{PRODUCT_NAME}</p>
        <Panel className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <h1 className="text-title text-ink-primary">{title}</h1>
            {intro === undefined ? null : (
              <div className="text-body text-ink-secondary">{intro}</div>
            )}
          </div>
          {children}
        </Panel>
      </div>
    </main>
  );
}
