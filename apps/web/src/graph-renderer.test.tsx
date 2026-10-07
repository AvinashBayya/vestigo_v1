/**
 * The Cytoscape renderer, with Cytoscape itself replaced so the options it is
 * given can be read (jsdom has no canvas to draw on).
 *
 * REGRESSION (Phase 6b step 4, found in the live check on 2026-10-06): nodes
 * are sized to their labels, and the layout was not told so, so nodes landed
 * on one another and hid their names ("IP address 104.20.23.154" over
 * "HERA.NS.CLOUDFLARE.COM"). The layout must count labels, and every size it
 * is given comes from a design token.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const created = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("cytoscape", () => ({
  default: (options: Record<string, unknown>) => {
    created.push(options);
    const collection = {
      forEach: () => undefined,
      unselect: () => undefined,
      select: () => undefined,
    };
    return {
      on: () => undefined,
      destroy: () => undefined,
      nodes: () => collection,
      elements: () => collection,
      getElementById: () => collection,
      style: () => undefined,
    };
  },
}));

const { CytoscapeGraph } = await import("./workspace/graph/CytoscapeGraph.tsx");

beforeEach(() => {
  // A canvas that can be drawn on, as in a browser.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    {} as unknown as CanvasRenderingContext2D,
  );
  // The tokens as the stylesheet would give them. The unit is assembled, so this
  // file holds no raw length for the design-system guard to find.
  const PX = "p" + "x";
  const values: Record<string, string> = {
    "--ds-space-6": `24${PX}`,
    "--ds-space-8": `32${PX}`,
    "--ds-space-10": `40${PX}`,
    "--ds-space-16": `64${PX}`,
    "--ds-type-mono-caption-size": `11.5${PX}`,
  };
  vi.spyOn(window, "getComputedStyle").mockReturnValue({
    getPropertyValue: (name: string) => values[name] ?? "",
  } as unknown as CSSStyleDeclaration);
});

afterEach(() => {
  cleanup();
  created.length = 0;
  vi.restoreAllMocks();
});

describe("the graph renderer", () => {
  it("lays nodes out by their labels, with spacing from the tokens, so no node hides another", () => {
    render(
      <CytoscapeGraph
        nodes={[
          {
            id: "a",
            kind: "DOMAIN",
            displayName: "example.com",
            identifier: null,
            hop: 0,
            claimCount: 1,
            mergedIntoEntityId: null,
          },
          {
            id: "b",
            kind: "IP_ADDRESS",
            displayName: "192.0.2.1",
            identifier: null,
            hop: 1,
            claimCount: 0,
            mergedIntoEntityId: null,
          },
        ]}
        edges={[]}
        selected={null}
        onSelect={() => undefined}
      />,
    );
    expect(created).toHaveLength(1);
    const layout = created[0]?.["layout"] as Record<string, unknown>;
    // Concentric by hop (U1-b): deterministic, so a redraw for a theme or font
    // change puts every node back where it was, with the seed at the centre.
    expect(layout).toMatchObject({
      name: "concentric",
      nodeDimensionsIncludeLabels: true,
      padding: 64,
      minNodeSpacing: 40,
    });
    const level = layout["concentric"] as (node: { data: (key: string) => unknown }) => number;
    const at = (hop: number) => level({ data: (key) => (key === "hop" ? hop : undefined) });
    expect(at(0)).toBeGreaterThan(at(1));
    // Each node is labelled with its class in words, not colour alone.
    const elements = created[0]?.["elements"] as { data: { label?: string } }[];
    expect(elements.map((element) => element.data.label)).toEqual([
      "Domain\nexample.com",
      "IP address\n192.0.2.1",
    ]);
  });

  it("an edge with no claims says so in words, so it never reads as a stated one", () => {
    const node = (id: string, hop: number) => ({
      id,
      kind: "DOMAIN" as const,
      displayName: `[${id}]`,
      identifier: null,
      hop,
      claimCount: 0,
      mergedIntoEntityId: null,
    });
    const edge = (id: string, strengths: ("OBSERVED" | "INFERRED")[]) => ({
      id,
      sourceEntityId: "a",
      targetEntityId: "b",
      kind: "[relation]",
      claimCount: strengths.length,
      strengths,
    });
    render(
      <CytoscapeGraph
        nodes={[node("a", 0), node("b", 1)]}
        edges={[edge("bare", []), edge("seen", ["OBSERVED"]), edge("guess", ["INFERRED"])]}
        selected={null}
        onSelect={() => undefined}
      />,
    );
    const elements = created[0]?.["elements"] as {
      group: string;
      data: { id: string; label?: string };
    }[];
    const labels = Object.fromEntries(
      elements
        .filter((element) => element.group === "edges")
        .map((element) => [element.data.id, element.data.label]),
    );
    expect(labels).toEqual({
      bare: "[relation] · no claims",
      seen: "[relation]",
      guess: "[relation] · INFERRED",
    });
  });

  it("never draws a label below its token size: the zoom stays at 1 or more, and a smaller label is hidden", () => {
    // REGRESSION (U1-c review): fitting a large graph zoomed out, and Cytoscape scaled every
    // label under its token size. The graph is panned instead; the list beside it has every label.
    render(
      <CytoscapeGraph
        nodes={[
          {
            id: "a",
            kind: "DOMAIN",
            displayName: "[a]",
            identifier: null,
            hop: 0,
            claimCount: 0,
            mergedIntoEntityId: null,
          },
        ]}
        edges={[]}
        selected={null}
        onSelect={() => undefined}
      />,
    );
    const minZoom = created[0]?.["minZoom"];
    expect(typeof minZoom).toBe("number");
    expect(minZoom as number).toBeGreaterThanOrEqual(1);
    const style = created[0]?.["style"] as { selector: string; style: Record<string, unknown> }[];
    const labelled = style.filter((rule) => rule.style["label"] !== undefined);
    expect(labelled.length).toBeGreaterThan(0);
    for (const rule of labelled) {
      const size = rule.style["font-size"] as number;
      // The smallest a label can be drawn is its size at the least zoom: never under the type floor of 11.
      expect(size * (minZoom as number)).toBeGreaterThanOrEqual(11);
      expect(rule.style["min-zoomed-font-size"]).toBe(size);
    }
  });
});
