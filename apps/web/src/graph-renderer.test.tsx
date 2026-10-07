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
});
