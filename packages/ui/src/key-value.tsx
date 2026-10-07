import type { ReactNode } from "react";
import { cn } from "./cn.ts";
import { Unmeasured } from "./unmeasured.tsx";

/** One row of a key-value list. A value that was never measured carries why instead. */
export type KeyValueRow =
  | {
      readonly key: string;
      readonly value: Exclude<ReactNode, null | undefined>;
      readonly mono?: boolean | undefined;
    }
  | { readonly key: string; readonly value: null; readonly reason: string };

/**
 * Keys and values, as the inspector and the map's point card draw them (§9):
 * keys in `meta` `ink-muted`, values right-aligned, mono unless said
 * otherwise. A null value is an em dash with its reason (§1), never blank.
 */
export function KeyValueList({
  rows,
  className,
}: {
  readonly rows: readonly KeyValueRow[];
  readonly className?: string | undefined;
}) {
  return (
    <dl className={cn("flex flex-col gap-2.25", className)}>
      {rows.map((row) => (
        <div key={row.key} className="flex min-h-5 items-center justify-between gap-2.5">
          <dt className="shrink-0 text-meta whitespace-nowrap text-ink-muted">{row.key}</dt>
          <dd className="min-w-0 text-right">
            {"reason" in row ? (
              <Unmeasured reason={row.reason} className="justify-end" />
            ) : (
              <span
                className={cn(
                  "break-all text-ink-primary",
                  row.mono === false ? "text-meta" : "font-mono text-mono-meta",
                )}
              >
                {row.value}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A hash as the grid shows it: the first four and last three characters (§9). */
export function shortHash(hash: string): string {
  return hash.length <= 8 ? hash : `${hash.slice(0, 4)}…${hash.slice(-3)}`;
}
