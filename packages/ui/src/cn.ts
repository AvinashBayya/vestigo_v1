import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge, told the design system's scale names (theme.css), so a
 * later class replaces an earlier one of the same kind: `text-body` is a type
 * style and `text-ink-muted` a colour, never one mistaken for the other.
 */
const merge = extendTailwindMerge({
  extend: {
    theme: {
      color: [
        "surface-page",
        "surface-raised",
        "surface-sunken",
        "surface-hover",
        "border-subtle",
        "border-default",
        "border-strong",
        "ink-primary",
        "ink-secondary",
        "ink-muted",
        "accent",
        "accent-soft",
        "accent-ink",
        "on-accent",
        "claim-observed-fill",
        "claim-observed-ink",
        "claim-observed-mark",
        "claim-reported-fill",
        "claim-reported-ink",
        "claim-reported-mark",
        "claim-derived-fill",
        "claim-derived-ink",
        "claim-derived-mark",
        "claim-correlated-fill",
        "claim-correlated-ink",
        "claim-inferred-fill",
        "claim-inferred-ink",
        "claim-inferred-mark",
        "claim-hypothesis-fill",
        "claim-hypothesis-ink",
        "status-failed-fill",
        "status-failed-ink",
        "status-failed-mark",
        "qr-module",
        "qr-ground",
      ],
      font: ["sans", "mono"],
      text: [
        "display",
        "title",
        "body",
        "body-strong",
        "small",
        "caption",
        "eyebrow",
        "mono-body",
        "mono-caption",
        "metric",
      ],
      spacing: ["1", "2", "3", "4", "5", "6", "8", "10", "target", "qr"],
      container: ["form"],
      radius: ["sm", "md", "lg", "pill"],
      shadow: ["card", "overlay"],
    },
  },
});

/** Joins class names, letting later ones replace earlier ones of the same kind. */
export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
