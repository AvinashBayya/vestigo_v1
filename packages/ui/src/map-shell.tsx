import type { ReactNode } from "react";
import { Button } from "./button.tsx";
import { cn } from "./cn.ts";
import { ENTITY_CLASS_DOT, EntityClassName, type EntityClass } from "./entity-class.tsx";
import { KeyValueList, type KeyValueRow } from "./key-value.tsx";
import { StrengthBadge, type ClaimStrengthLabel } from "./strength-badge.tsx";
import { Unmeasured } from "./unmeasured.tsx";

/** A position a source supplied. Never 0,0 standing in for a missing one: that is `null` with a reason. */
export interface Coordinates {
  readonly lat: number;
  readonly lon: number;
}

export type MapPoint = {
  readonly id: string;
  readonly label: string;
  readonly entityClass: EntityClass;
} & (
  | { readonly position: Coordinates }
  | {
      readonly position: null;
      /** Why there is no position: "the source named a place but gave no coordinates". */
      readonly reason: string;
    }
);

export interface MapLayer {
  readonly id: string;
  readonly label: string;
  /** Layers are coloured by entity class only (D5), never by claim strength. */
  readonly entityClass: EntityClass;
  /** The measured count as the caller formats it, or null with why it was not measured. */
  readonly count: { readonly value: string } | { readonly value: null; readonly reason: string };
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}

/** "lat, lon" in mono, as the API recorded them. */
export function formatCoordinates(position: Coordinates): string {
  return `${String(position.lat)}, ${String(position.lon)}`;
}

/**
 * The floating selected-point card (§9 map shell): `radius-box`, key-value
 * rows, the strength in words, and a full-width secondary action.
 */
export function SelectedPointCard({
  point,
  rows,
  strength,
  action,
  className,
}: {
  readonly point: MapPoint;
  readonly rows: readonly KeyValueRow[];
  readonly strength: ClaimStrengthLabel | null;
  readonly action?: { readonly label: string; readonly onClick: () => void } | undefined;
  readonly className?: string | undefined;
}) {
  const coordinates: KeyValueRow =
    point.position === null
      ? { key: "Coordinates", value: null, reason: point.reason }
      : { key: "Coordinates", value: formatCoordinates(point.position) };
  return (
    <section
      aria-label="Selected point"
      className={cn(
        "flex w-side-rail max-w-full flex-col gap-2.5 rounded-box border border-border-default bg-surface-raised px-4 py-3.5",
        className,
      )}
    >
      <h3 className="text-eyebrow text-ink-muted uppercase">Selected point</h3>
      <p className="text-body-strong text-ink-primary">{point.label}</p>
      <EntityClassName
        entityClass={point.entityClass}
        className="text-caption text-ink-secondary"
      />
      <KeyValueList rows={[coordinates, ...rows]} />
      <div className="flex items-center justify-between gap-3">
        <span className="text-meta text-ink-muted">Strength</span>
        {strength === null ? (
          <Unmeasured reason="No claim places this point, so it has no strength." />
        ) : (
          <StrengthBadge strength={strength} size="sm" />
        )}
      </div>
      {action !== undefined && (
        <Button variant="secondary" size="md" onClick={action.onClick} className="w-full">
          {action.label}
        </Button>
      )}
    </section>
  );
}

/**
 * The map shell (§9, Map): the layers rail, the container on the neutral
 * `surface-map` ground with the renderer (MapLibre GL, ARCHITECTURE-DECISIONS)
 * passed in, a legend bottom-left, the selected-point card top-right. Points
 * are coloured by entity class (D5). Every point is also listed in words
 * (§7); a point without coordinates is listed with an em dash and why,
 * never placed by a guess.
 */
export function MapShell({
  layers,
  points,
  renderer,
  selected,
  selectedId = null,
  onSelect,
  note,
  className,
}: {
  readonly layers: readonly MapLayer[];
  readonly points: readonly MapPoint[];
  /** The map itself. The shell draws nothing in its place. */
  readonly renderer: ReactNode;
  readonly selected?: ReactNode;
  /** The selected point's id, and how a point is chosen from the lists (§7: usable by keyboard). */
  readonly selectedId?: string | null | undefined;
  readonly onSelect?: ((id: string) => void) | undefined;
  /** The rail's honesty note: how points are placed. */
  readonly note?: string | undefined;
  readonly className?: string | undefined;
}) {
  const placed = points.filter((point) => point.position !== null);
  const unplaced = points.filter((point) => point.position === null);
  // The legend keys what is drawn: placed points only.
  const classes = [...new Set(placed.map((point) => point.entityClass))];
  /** A point's row: a real button where a point can be chosen, so the card is reachable without the canvas. */
  const row = (point: MapPoint, children: ReactNode) => {
    const body = (
      <>
        <EntityClassName entityClass={point.entityClass} className="text-caption text-ink-muted" />
        {children}
      </>
    );
    return (
      <li key={point.id} className="border-b border-border-subtle last:border-b-0">
        {onSelect === undefined ? (
          <div className="flex min-h-target items-center justify-between gap-3">{body}</div>
        ) : (
          <button
            type="button"
            aria-pressed={point.id === selectedId}
            onClick={() => {
              onSelect(point.id);
            }}
            className={cn(
              "flex min-h-target w-full cursor-pointer items-center justify-between gap-3 rounded-md px-1.5 text-left",
              point.id === selectedId ? "bg-accent-soft" : "hover:bg-surface-hover",
            )}
          >
            {body}
          </button>
        )}
      </li>
    );
  };
  return (
    <section aria-label="Map" className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex min-h-0 grow">
        <aside
          aria-label="Layers"
          className="flex w-map-rail shrink-0 flex-col gap-4 border-r border-border-default bg-surface-raised px-3.5 py-4"
        >
          <fieldset className="flex flex-col">
            <legend className="mb-2 text-eyebrow text-ink-muted uppercase">Layers</legend>
            {layers.length === 0 ? (
              <p className="text-caption text-ink-muted">
                No layers: nothing in this case has a position.
              </p>
            ) : (
              layers.map((layer) => (
                <div key={layer.id} className="flex min-h-target items-center gap-2.75">
                  <label className="flex grow cursor-pointer items-center gap-2.75 self-stretch text-small text-ink-secondary">
                    <input
                      type="checkbox"
                      checked={layer.checked}
                      onChange={(event) => {
                        layer.onChange(event.target.checked);
                      }}
                      className="cursor-pointer accent-accent"
                    />
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-dot shrink-0 rounded-pill",
                        ENTITY_CLASS_DOT[layer.entityClass],
                      )}
                    />
                    {layer.label}
                  </label>
                  {layer.count.value === null ? (
                    <Unmeasured reason={layer.count.reason} className="justify-end" />
                  ) : (
                    <span className="font-mono text-mono-caption text-ink-muted">
                      {layer.count.value}
                    </span>
                  )}
                </div>
              ))
            )}
          </fieldset>
          {note !== undefined && (
            <p className="mt-auto rounded-inner border border-border-subtle p-2.75 text-caption-prose text-ink-secondary">
              {note}
            </p>
          )}
        </aside>
        <div className="relative flex min-h-0 grow flex-col bg-surface-map">
          <div className="flex grow flex-col">{renderer}</div>
          {selected !== undefined && (
            <div className="absolute top-3.5 right-3.5 z-10 max-w-full">{selected}</div>
          )}
          {classes.length > 0 && (
            <ul
              aria-label="Legend"
              className="absolute bottom-3.5 left-4 z-10 flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-inner border border-border-default bg-surface-raised px-3 py-2.5"
            >
              {classes.map((entityClass) => (
                <li key={entityClass}>
                  <EntityClassName
                    entityClass={entityClass}
                    className="text-caption text-ink-secondary"
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="grid gap-4 border-t border-border-default bg-surface-raised px-4 py-4 md:grid-cols-2">
        <section aria-label="Points on the map" className="flex flex-col gap-2">
          <h3 className="text-eyebrow text-ink-muted uppercase">On the map</h3>
          {placed.length === 0 ? (
            <p className="text-caption text-ink-muted">No point has coordinates from a source.</p>
          ) : (
            <ul className="flex flex-col">
              {placed.map((point) =>
                row(
                  point,
                  <>
                    <span className="grow text-small text-ink-primary">{point.label}</span>
                    <span className="font-mono text-mono-meta text-ink-secondary">
                      {formatCoordinates(point.position)}
                    </span>
                  </>,
                ),
              )}
            </ul>
          )}
        </section>
        <section aria-label="Points not on the map" className="flex flex-col gap-2">
          <h3 className="text-eyebrow text-ink-muted uppercase">Not on the map</h3>
          {unplaced.length === 0 ? (
            <p className="text-caption text-ink-muted">
              Every point has coordinates from a source.
            </p>
          ) : (
            <ul className="flex flex-col">
              {unplaced.map((point) =>
                row(
                  point,
                  <>
                    <span className="flex grow flex-col gap-0.75">
                      <span className="text-small text-ink-primary">{point.label}</span>
                      <span className="text-caption text-ink-muted">{point.reason}</span>
                    </span>
                    {/* The reason is written beside it, so the dash is not a second control. */}
                    <span className="font-sans text-ui text-ink-muted">
                      <span aria-hidden="true">—</span>
                      <span className="sr-only">No coordinates.</span>
                    </span>
                  </>,
                ),
              )}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
