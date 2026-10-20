/**
 * Task 3 — Layout primitive tests.
 * Verifies semantic element choice, bounded gaps, wrapping/alignment,
 * and no DOM reorder under LTR/RTL.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { render, screen } from "../../src/test/render.tsx";
import { Stack } from "../../src/ui/layout/Stack.tsx";
import { Inline } from "../../src/ui/layout/Inline.tsx";
import { Cluster } from "../../src/ui/layout/Cluster.tsx";
import { Grid } from "../../src/ui/layout/Grid.tsx";
import { Container } from "../../src/ui/layout/Container.tsx";
import { Surface } from "../../src/ui/layout/Surface.tsx";
import { VisuallyHidden } from "../../src/ui/layout/VisuallyHidden.tsx";

// ── Stack ────────────────────────────────────────────────────────────

describe("Stack", () => {
  it("renders as div by default", () => {
    const { container } = render(<Stack>content</Stack>);
    expect(container.firstChild?.nodeName).toBe("DIV");
  });

  it("renders as section when requested", () => {
    const { container } = render(<Stack as="section">content</Stack>);
    expect(container.firstChild?.nodeName).toBe("SECTION");
  });

  it("renders as ul when requested", () => {
    const { container } = render(<Stack as="ul"><li>item</li></Stack>);
    expect(container.firstChild?.nodeName).toBe("UL");
  });

  it("renders as ol when requested", () => {
    const { container } = render(<Stack as="ol"><li>item</li></Stack>);
    expect(container.firstChild?.nodeName).toBe("OL");
  });

  it("applies pg-stack class", () => {
    const { container } = render(<Stack>content</Stack>);
    expect(container.firstChild).toHaveClass("pg-stack");
  });

  it("applies custom className alongside pg-stack", () => {
    const { container } = render(<Stack className="my-class">content</Stack>);
    expect(container.firstChild).toHaveClass("pg-stack");
    expect(container.firstChild).toHaveClass("my-class");
  });

  it("sets gap CSS variable for token key 5", () => {
    const { container } = render(<Stack gap="5">content</Stack>);
    const el = container.firstChild as HTMLElement;
    expect(el.style.getPropertyValue("--pg-stack-gap")).toBe("var(--pg-space-5)");
  });

  it("accepts gap token 0", () => {
    const { container } = render(<Stack gap="0">content</Stack>);
    const el = container.firstChild as HTMLElement;
    expect(el.style.getPropertyValue("--pg-stack-gap")).toBe("var(--pg-space-0)");
  });

  it("forwards additional props", () => {
    render(<Stack data-testid="stack-test">content</Stack>);
    expect(screen.getByTestId("stack-test")).toBeInTheDocument();
  });
});

// ── Inline ───────────────────────────────────────────────────────────

describe("Inline", () => {
  it("renders as div by default", () => {
    const { container } = render(<Inline>content</Inline>);
    expect(container.firstChild?.nodeName).toBe("DIV");
  });

  it("applies pg-inline class", () => {
    const { container } = render(<Inline>content</Inline>);
    expect(container.firstChild).toHaveClass("pg-inline");
  });

  it("sets gap CSS variable", () => {
    const { container } = render(<Inline gap="4">content</Inline>);
    const el = container.firstChild as HTMLElement;
    expect(el.style.getPropertyValue("--pg-inline-gap")).toBe("var(--pg-space-4)");
  });

  it("sets align CSS variable", () => {
    const { container } = render(<Inline align="start">content</Inline>);
    const el = container.firstChild as HTMLElement;
    expect(el.style.getPropertyValue("--pg-inline-align")).toBe("start");
  });

  it("sets wrap CSS variable", () => {
    const { container } = render(<Inline wrap="wrap">content</Inline>);
    const el = container.firstChild as HTMLElement;
    expect(el.style.getPropertyValue("--pg-inline-wrap")).toBe("wrap");
  });
});

// ── Cluster ──────────────────────────────────────────────────────────

describe("Cluster", () => {
  it("applies pg-cluster class", () => {
    const { container } = render(<Cluster>content</Cluster>);
    expect(container.firstChild).toHaveClass("pg-cluster");
  });

  it("sets gap CSS variable", () => {
    const { container } = render(<Cluster gap="4">content</Cluster>);
    const el = container.firstChild as HTMLElement;
    expect(el.style.getPropertyValue("--pg-cluster-gap")).toBe("var(--pg-space-4)");
  });

  it("maps justify=end to flex-end", () => {
    const { container } = render(<Cluster justify="end">content</Cluster>);
    const el = container.firstChild as HTMLElement;
    expect(el.style.getPropertyValue("--pg-cluster-justify")).toBe("flex-end");
  });

  it("maps justify=space-between correctly", () => {
    const { container } = render(<Cluster justify="space-between">content</Cluster>);
    const el = container.firstChild as HTMLElement;
    expect(el.style.getPropertyValue("--pg-cluster-justify")).toBe("space-between");
  });
});

// ── Grid ─────────────────────────────────────────────────────────────

describe("Grid", () => {
  it("applies pg-grid class", () => {
    const { container } = render(<Grid>content</Grid>);
    expect(container.firstChild).toHaveClass("pg-grid");
  });

  it("sets gap CSS variable", () => {
    const { container } = render(<Grid gap="5">content</Grid>);
    const el = container.firstChild as HTMLElement;
    expect(el.style.getPropertyValue("--pg-grid-gap")).toBe("var(--pg-space-5)");
  });

  it("sets minItemSize CSS variable", () => {
    const { container } = render(<Grid minItemSize="12rem">content</Grid>);
    const el = container.firstChild as HTMLElement;
    expect(el.style.getPropertyValue("--pg-grid-min-item-size")).toBe("12rem");
  });
});

// ── Container ────────────────────────────────────────────────────────

describe("Container", () => {
  it("applies pg-container class", () => {
    const { container } = render(<Container>content</Container>);
    expect(container.firstChild).toHaveClass("pg-container");
  });

  it("renders as div", () => {
    const { container } = render(<Container>content</Container>);
    expect(container.firstChild?.nodeName).toBe("DIV");
  });
});

// ── Surface ──────────────────────────────────────────────────────────

describe("Surface", () => {
  it("applies pg-surface class", () => {
    const { container } = render(<Surface>content</Surface>);
    expect(container.firstChild).toHaveClass("pg-surface");
  });

  it("applies raised modifier", () => {
    const { container } = render(<Surface raised>content</Surface>);
    expect(container.firstChild).toHaveClass("pg-surface--raised");
  });

  it("applies subtle modifier", () => {
    const { container } = render(<Surface subtle>content</Surface>);
    expect(container.firstChild).toHaveClass("pg-surface--subtle");
  });

  it("renders as div by default", () => {
    const { container } = render(<Surface>content</Surface>);
    expect(container.firstChild?.nodeName).toBe("DIV");
  });

  it("renders as article when requested", () => {
    const { container } = render(<Surface as="article">content</Surface>);
    expect(container.firstChild?.nodeName).toBe("ARTICLE");
  });
});

// ── VisuallyHidden ───────────────────────────────────────────────────

describe("VisuallyHidden", () => {
  it("renders content in the DOM", () => {
    render(<VisuallyHidden>Hidden label for screen readers</VisuallyHidden>);
    expect(screen.getByText("Hidden label for screen readers")).toBeInTheDocument();
  });

  it("applies pg-visually-hidden class", () => {
    const { container } = render(<VisuallyHidden>text</VisuallyHidden>);
    expect(container.firstChild).toHaveClass("pg-visually-hidden");
  });

  it("renders as span", () => {
    const { container } = render(<VisuallyHidden>text</VisuallyHidden>);
    expect(container.firstChild?.nodeName).toBe("SPAN");
  });
});

// ── RTL: no DOM reorder ──────────────────────────────────────────────

describe("Layout primitives under RTL", () => {
  it("Stack preserves child order under RTL", () => {
    const { container } = render(
      <div dir="rtl">
        <Stack gap="3">
          <span>First</span>
          <span>Second</span>
          <span>Third</span>
        </Stack>
      </div>
    );
    const items = container.querySelectorAll("span");
    expect(items[0].textContent).toBe("First");
    expect(items[1].textContent).toBe("Second");
    expect(items[2].textContent).toBe("Third");
  });

  it("Inline preserves child order under RTL", () => {
    const { container } = render(
      <div dir="rtl">
        <Inline gap="3">
          <span>Alpha</span>
          <span>Beta</span>
        </Inline>
      </div>
    );
    const items = container.querySelectorAll("span");
    expect(items[0].textContent).toBe("Alpha");
    expect(items[1].textContent).toBe("Beta");
  });
});

// ── CSS logical properties scan ──────────────────────────────────────

describe("Durable CSS uses logical properties, not physical directional", () => {
  const BASE_CSS = readFileSync(
    resolve(__dirname, "../../src/ui/base.css"),
    "utf-8"
  );

  // Strip comment blocks to avoid false positives from documentation
  const cssWithoutComments = BASE_CSS.replace(/\/\*[\s\S]*?\*\//g, "");

  const physicalDirectionalPatterns = [
    { pattern: /\bmargin-left\s*:/, name: "margin-left" },
    { pattern: /\bmargin-right\s*:/, name: "margin-right" },
    { pattern: /\bpadding-left\s*:/, name: "padding-left" },
    { pattern: /\bpadding-right\s*:/, name: "padding-right" },
    { pattern: /\bborder-left\s*:/, name: "border-left" },
    { pattern: /\bborder-right\s*:/, name: "border-right" },
  ];

  for (const { pattern, name } of physicalDirectionalPatterns) {
    it(`does not use physical ${name}`, () => {
      expect(cssWithoutComments).not.toMatch(pattern);
    });
  }
});
