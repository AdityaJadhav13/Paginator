/**
 * Surface rendering, route ownership preservation, workflow integrity and
 * availability honesty (UI005 §28 rows 1, 2, 5, 6; AC-01 – AC-12, AC-37).
 */
import { describe, it, expect } from "vitest";
import { screen, within } from "../../src/test/render.tsx";
import {
  WORKFLOW_STAGES,
  workflowStageViews,
} from "../../src/features/public/workflow.ts";
import { PUBLIC_ROUTES, renderPublic } from "./renderPublic.tsx";

describe("The five public surfaces render (AC-01, AC-02)", () => {
  for (const { path, heading } of PUBLIC_ROUTES) {
    it(`"${path}" renders its own <h1> and no placeholder`, async () => {
      const { container } = renderPublic(path);
      const h1 = await screen.findByRole("heading", { level: 1, name: heading });

      expect(h1).toHaveAttribute("id", "pg-route-heading");
      expect(h1).toHaveAttribute("tabindex", "-1");
      expect(container.querySelectorAll("h1")).toHaveLength(1);
      expect(container).not.toHaveTextContent(/not yet implemented/i);
    });
  }
});

describe("Route ownership is preserved (AC-03, AC-04)", () => {
  const authRoutes: Array<[string, string]> = [
    ["/login", "Sign in"],
    ["/signup", "Sign up"],
    ["/forgot-password", "Forgot password"],
    ["/verify", "Verify"],
  ];

  for (const [path, title] of authRoutes) {
    it(`"${path}" still renders the UI004 auth surface`, async () => {
      renderPublic(path, "signed-out");
      expect(
        await screen.findByRole("heading", { level: 1, name: title })
      ).toBeInTheDocument();
    });
  }

  it("/onboarding still renders the UI006 placeholder", async () => {
    const { container } = renderPublic("/onboarding");
    await screen.findByRole("heading", { level: 1, name: "Onboarding" });
    expect(container).toHaveTextContent(/not yet implemented/i);
    expect(container).toHaveTextContent("UI006");
  });
});

describe("Workflow integrity (AC-07, AC-37)", () => {
  it("renders all seven stages on /features with their constraints", async () => {
    const { container } = renderPublic("/features");
    await screen.findByRole("heading", { level: 1, name: PUBLIC_ROUTES[1].heading });

    for (const stage of workflowStageViews()) {
      expect(container).toHaveTextContent(stage.name);
      expect(container).toHaveTextContent(stage.description);
      expect(container).toHaveTextContent(stage.constraint);
      expect(container).toHaveTextContent(stage.ownerCaption);
    }
  });

  it("renders all seven stage names and descriptions on / in condensed form", async () => {
    const { container } = renderPublic("/");
    await screen.findByRole("heading", { level: 1, name: PUBLIC_ROUTES[0].heading });

    for (const stage of workflowStageViews()) {
      expect(container).toHaveTextContent(stage.name);
      expect(container).toHaveTextContent(stage.description);
    }
  });

  it("numbers the stages 1..7 exactly once each", () => {
    expect(WORKFLOW_STAGES.map((stage) => stage.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(WORKFLOW_STAGES.map((stage) => stage.key)).size).toBe(
      WORKFLOW_STAGES.length
    );
  });
});

describe("Availability honesty (AC-11, AC-12)", () => {
  it("labels every stage with one of the three permitted values", async () => {
    const { container } = renderPublic("/features");
    await screen.findByRole("heading", { level: 1, name: PUBLIC_ROUTES[1].heading });

    const labels = Array.from(container.querySelectorAll(".pg-capability")).map(
      (node) => node.textContent
    );
    expect(labels).toHaveLength(WORKFLOW_STAGES.length);
    for (const label of labels) {
      expect([
        "You can try this in the demonstration",
        "Reserved in the current build",
        "Not built",
      ]).toContain(label);
    }
  });

  it("marks no stage as demonstrated while every workspace surface is a placeholder", () => {
    // This is today's truth, asserted so that flipping a label for visual
    // impact fails loudly instead of quietly shipping a false claim.
    expect(WORKFLOW_STAGES.filter((stage) => stage.availability === "demonstrated")).toEqual(
      []
    );
  });

  it("only allows `demonstrated` when the stage's route is not a placeholder", async () => {
    // Currently an empty loop by construction. It activates the moment
    // someone upgrades a stage, and then genuinely renders that stage's
    // route to check the claim.
    const demonstrated = WORKFLOW_STAGES.filter(
      (stage) => stage.availability === "demonstrated"
    );

    for (const stage of demonstrated) {
      const { container, unmount } = renderPublic("/");
      await screen.findByRole("heading", { level: 1, name: PUBLIC_ROUTES[0].heading });
      unmount();

      const target = renderPublic(routeUrlFor(stage.routeKey));
      await screen.findByRole("heading", { level: 1 });
      expect(target.container).not.toHaveTextContent(/not yet implemented/i);
      target.unmount();
      expect(container).toBeDefined();
    }
  });
});

/** Canonical demonstration URL for a stage's route, used only above. */
function routeUrlFor(routeKey: string): string {
  const org = "org-demo-sahyadri";
  const pub = "pub-demo-pune-daily";
  const edition = "edition-demo-001";
  const map: Record<string, string> = {
    pubNewsroom: `/org/${org}/pub/${pub}/newsroom`,
    pubStories: `/org/${org}/pub/${pub}/stories`,
    pubArchive: `/org/${org}/pub/${pub}/archive`,
    editionGenerate: `/org/${org}/pub/${pub}/editions/${edition}/generate`,
    editionPreflight: `/org/${org}/pub/${pub}/editions/${edition}/preflight`,
    editionExport: `/org/${org}/pub/${pub}/editions/${edition}/export`,
    editionEditor: `/org/${org}/pub/${pub}/editions/${edition}/editor`,
  };
  const url = map[routeKey];
  if (!url) throw new Error(`No demonstration URL mapped for route key: ${routeKey}`);
  return url;
}

describe("No fabricated measurement appears on any public surface (AC-10)", () => {
  for (const { path, heading } of PUBLIC_ROUTES) {
    it(`"${path}" renders no statistic, percentage or currency figure`, async () => {
      const { container } = renderPublic(path);
      await screen.findByRole("heading", { level: 1, name: heading });

      const main = within(container).getByRole("main");

      // Stage ordinals are aria-hidden presentation, so they are removed
      // the same way assistive technology ignores them. The only other
      // legitimate digits are the unit identifiers naming who will build a
      // reserved surface ("Reserved for UI014."). Everything a reader is
      // actually told must be prose, never a figure.
      const readable = main.cloneNode(true) as HTMLElement;
      for (const hidden of readable.querySelectorAll('[aria-hidden="true"]')) {
        hidden.remove();
      }
      const text = readable.textContent ?? "";
      const withoutUnits = text.replace(/UI\d{3}(?:[–-]\d{3})?/g, "");

      expect(withoutUnits).not.toMatch(/\d/);
      expect(text).not.toMatch(/[$€£₹¥]/);
      expect(text).not.toMatch(/%/);
    });
  }
});
