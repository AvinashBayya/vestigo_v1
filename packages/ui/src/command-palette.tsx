import { Dialog } from "radix-ui";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "./cn.ts";

export interface PaletteItem {
  readonly id: string;
  readonly label: string;
  /** A second line: where it goes, or what kind of thing it is. */
  readonly hint?: ReactNode;
  /**
   * The hint's words for the filter, when the hint is not plain text (it
   * holds a formatted time, say). A string hint is matched as it is.
   */
  readonly hintText?: string | undefined;
}

export interface PaletteGroup {
  readonly label: string;
  readonly items: readonly PaletteItem[];
}

/** Apple platforms say ⌘K; everywhere else, Ctrl K (§9). */
export function isApplePlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
}

/**
 * Ctrl K or ⌘K opens the palette from anywhere. Returns nothing; the
 * listener goes when the component that set it does.
 */
export function useCommandPaletteShortcut(onOpen: () => void): void {
  useEffect(() => {
    const listener = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpen();
      }
    };
    window.addEventListener("keydown", listener);
    return () => {
      window.removeEventListener("keydown", listener);
    };
  }, [onOpen]);
}

/**
 * The header's command-palette button (§9, Main): the keycap and "Command
 * palette" in `meta` `ink-muted`, with a `target-min` hit area.
 */
export function CommandPaletteButton({
  onOpen,
  apple = isApplePlatform(),
}: {
  readonly onOpen: () => void;
  readonly apple?: boolean | undefined;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-keyshortcuts={apple ? "Meta+K" : "Control+K"}
      className="inline-flex min-h-target cursor-pointer items-center gap-2.25 rounded-md"
    >
      <kbd className="rounded-xs border border-border-default px-1.5 py-0.5 font-mono text-mono-meta text-ink-muted">
        {apple ? "⌘K" : "Ctrl K"}
      </kbd>
      <span className="text-meta text-ink-muted">Command palette</span>
    </button>
  );
}

function hintTextOf(item: PaletteItem): string {
  if (item.hintText !== undefined) return item.hintText;
  return typeof item.hint === "string" ? item.hint : "";
}

function filtered(groups: readonly PaletteGroup[], query: string): PaletteGroup[] {
  const needle = query.trim().toLowerCase();
  return groups
    .map((group) => ({
      label: group.label,
      items:
        needle === ""
          ? group.items
          : group.items.filter(
              (item) =>
                item.label.toLowerCase().includes(needle) ||
                hintTextOf(item).toLowerCase().includes(needle),
            ),
    }))
    .filter((group) => group.items.length > 0);
}

/**
 * The palette itself, without the layer around it: a combobox and its
 * grouped listbox. Arrow keys move, Enter opens, and the active option is
 * announced through `aria-activedescendant` while focus stays in the input.
 */
export function CommandPalettePanel({
  groups,
  onSelect,
  initialQuery = "",
  loading,
  autoFocus = false,
  placeholder = "Go to a case or a page",
  label = "Search pages and cases",
  emptyText = "Nothing to open yet.",
  noMatchText = (query: string) => `Nothing matches “${query}”. Try a case name or a page.`,
  notice,
  className,
}: {
  readonly groups: readonly PaletteGroup[];
  readonly onSelect: (id: string) => void;
  readonly initialQuery?: string | undefined;
  /** While results are read: what is being read (§8). */
  readonly loading?: string | undefined;
  readonly autoFocus?: boolean | undefined;
  /** The copy, so a host never promises what it cannot list. */
  readonly placeholder?: string | undefined;
  readonly label?: string | undefined;
  readonly emptyText?: string | undefined;
  readonly noMatchText?: ((query: string) => string) | undefined;
  /** Said above the results: a read that failed, or a list cut at its limit. */
  readonly notice?: ReactNode;
  readonly className?: string | undefined;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  // While results are read, nothing is listed, so nothing can be chosen: the
  // items in hand may be stale, and Enter must never act on what is not shown.
  const shown = useMemo(
    () => (loading === undefined ? filtered(groups, query) : []),
    [groups, query, loading],
  );
  const flat = shown.flatMap((group) => group.items);
  const at = Math.min(active, flat.length - 1);
  const current = flat[at];
  // IDs from positions, never from labels: an id with a space breaks aria-labelledby.
  const optionId = (index: number) => `${listId}-o${String(index)}`;
  const listed = flat.length > 0;

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

  // Keep the active option in view as the arrow keys move through a long list.
  useEffect(() => {
    if (current === undefined) return;
    const option = list.current?.querySelector(`[data-index="${String(at)}"]`);
    if (option instanceof HTMLElement && typeof option.scrollIntoView === "function") {
      option.scrollIntoView({ block: "nearest" });
    }
  }, [at, current]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (flat.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((Math.min(active, flat.length - 1) + step + flat.length) % flat.length);
    } else if (event.key === "Enter" && current !== undefined) {
      event.preventDefault();
      onSelect(current.id);
    }
  };

  let body;
  if (loading !== undefined) {
    body = (
      <p role="status" className="px-4 py-3.5 text-meta text-ink-muted">
        {loading}
      </p>
    );
  } else if (groups.every((group) => group.items.length === 0)) {
    body = (
      <p role="status" className="px-4 py-3.5 text-meta text-ink-muted">
        {emptyText}
      </p>
    );
  } else if (flat.length === 0) {
    body = (
      <p role="status" className="px-4 py-3.5 text-meta text-ink-muted">
        {noMatchText(query.trim())}
      </p>
    );
  } else {
    body = (
      <div
        ref={list}
        id={listId}
        role="listbox"
        aria-label="Results"
        className="flex min-h-0 flex-col overflow-y-auto py-2"
      >
        {shown.map((group, groupIndex) => {
          const groupId = `${listId}-g${String(groupIndex)}`;
          return (
            <div key={group.label} role="group" aria-labelledby={groupId} className="flex flex-col">
              <p id={groupId} className="px-4 pt-2 pb-1 text-eyebrow text-ink-muted uppercase">
                {group.label}
              </p>
              {group.items.map((item) => {
                const index = flat.indexOf(item);
                const selected = index === at;
                return (
                  <div
                    key={item.id}
                    id={optionId(index)}
                    data-index={index}
                    role="option"
                    aria-selected={selected}
                    onMouseDown={(event) => {
                      // Keep focus in the input; the click still selects.
                      event.preventDefault();
                    }}
                    onClick={() => {
                      onSelect(item.id);
                    }}
                    onMouseMove={() => {
                      setActive(index);
                    }}
                    className={cn(
                      "mx-2 flex min-h-target cursor-pointer flex-col justify-center gap-0.5 rounded-md px-2.5 py-1.25",
                      selected ? "bg-accent-soft text-accent-ink" : "text-ink-primary",
                    )}
                  >
                    <span className="text-body">{item.label}</span>
                    {item.hint !== undefined && (
                      <span
                        className={cn(
                          "text-caption",
                          selected ? "text-accent-ink" : "text-ink-muted",
                        )}
                      >
                        {item.hint}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex min-h-0 w-palette max-w-full flex-col rounded-lg border border-border-default bg-surface-raised shadow-overlay",
        className,
      )}
    >
      <label className="flex shrink-0 items-center border-b border-border-subtle px-2 py-1">
        <span className="sr-only">{label}</span>
        <input
          ref={input}
          role="combobox"
          aria-expanded={listed}
          aria-controls={listed ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={current === undefined ? undefined : optionId(at)}
          value={query}
          placeholder={placeholder}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          // Inner padding, so the focus ring sits clear of the text.
          className="h-target w-full rounded-md bg-transparent px-2 text-body text-ink-primary placeholder:text-ink-muted"
        />
      </label>
      {notice !== undefined && (
        <div className="shrink-0 border-b border-border-subtle px-4 py-2.5 text-meta text-ink-secondary">
          {notice}
        </div>
      )}
      {body}
      <p className="shrink-0 border-t border-border-subtle px-4 py-2 text-caption text-ink-muted">
        ↑ ↓ to move · Enter to open · Esc to close
      </p>
    </div>
  );
}

/**
 * The command palette (§9, Main; not drawn): a floating layer
 * `layout-palette-width` wide. Escape closes it and focus returns to what
 * had it when the palette opened (the button, or wherever Ctrl K was
 * pressed). Selecting an item closes it. It never runs past the viewport:
 * the list scrolls inside it.
 */
export function CommandPalette({
  open,
  onOpenChange,
  groups,
  onSelect,
  loading,
  ...copy
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly groups: readonly PaletteGroup[];
  readonly onSelect: (id: string) => void;
  readonly loading?: string | undefined;
  readonly placeholder?: string | undefined;
  readonly label?: string | undefined;
  readonly emptyText?: string | undefined;
  readonly noMatchText?: ((query: string) => string) | undefined;
  readonly notice?: ReactNode;
}) {
  // Radix returns focus to a Dialog.Trigger; this palette has none (it opens
  // from a button or a shortcut), so remember what had focus and return there.
  const opener = useRef<HTMLElement | null>(null);
  // A layout effect runs before any child's focus effect, so this still sees the opener.
  useLayoutEffect(() => {
    if (open && document.activeElement instanceof HTMLElement)
      opener.current = document.activeElement;
  }, [open]);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        {/* A neutral scrim: the page behind recedes, so the palette reads as the layer in front. */}
        <Dialog.Overlay className="fixed inset-0 z-50 bg-surface-page/70" />
        <Dialog.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
          }}
          // Between top-16 and bottom-16, so it never runs past the viewport;
          // the empty part passes clicks through, and a click there closes it.
          className="pointer-events-none fixed top-16 bottom-16 left-1/2 z-50 flex w-palette max-w-full -translate-x-1/2 flex-col"
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <CommandPalettePanel
            className="pointer-events-auto"
            groups={groups}
            loading={loading}
            {...copy}
            autoFocus
            onSelect={(id) => {
              onOpenChange(false);
              onSelect(id);
            }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
