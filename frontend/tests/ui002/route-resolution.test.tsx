/**
 * Route resolution, deep links, refresh, back/forward, not-found,
 * invalid context, and no-record-leakage tests (UI002 §14).
 *
 * Table-driven only where the assertion genuinely differs per route
 * (shell selection); a single parameterized test covers all
 * representative rows rather than one near-duplicate `it()` per row
 * (§14's own instruction).
 */
import { describe, it, expect } from "vitest";
import { act } from "react";
import { screen } from "../../src/test/render.tsx";
import userEvent from "@testing-library/user-event";
import { renderAt } from "./renderRoutes.tsx";

// ── AC-01: deep link resolves to the right shell, table-driven ────────

describe("Deep link resolves the correct shell", () => {
  const cases: Array<{ path: string; shell: "public" | "workspace" | "editor"; h1: string }> = [
    { path: "/", shell: "public", h1: "Home" },
    { path: "/features", shell: "public", h1: "Features" },
    { path: "/login", shell: "public", h1: "Already using a simulated session" },
    { path: "/onboarding", shell: "public", h1: "Onboarding" },
    { path: "/org/org-demo-sahyadri/settings", shell: "workspace", h1: "Organization settings" },
    {
      path: "/org/org-demo-sahyadri/pub/pub-demo-pune-daily/overview",
      shell: "workspace",
      h1: "Overview",
    },
    {
      path: "/org/org-demo-sahyadri/pub/pub-demo-pune-daily/archive/release-demo-001",
      shell: "workspace",
      h1: "Release",
    },
    {
      path: "/org/org-demo-sahyadri/pub/pub-demo-pune-daily/editions/edition-demo-001/generate",
      shell: "workspace",
      h1: "Generate",
    },
    {
      path: "/org/org-demo-sahyadri/pub/pub-demo-pune-daily/editions/edition-demo-001/editor",
      shell: "editor",
      h1: "Editor",
    },
  ];

  for (const { path, shell, h1 } of cases) {
    it(`"${path}" resolves to the ${shell} shell with heading "${h1}"`, async () => {
      const { container } = renderAt(path);
      expect(await screen.findByRole("heading", { level: 1, name: h1 })).toHaveTextContent(h1);

      if (shell === "public") {
        expect(container.querySelector(".pg-shell--public")).toBeInTheDocument();
      } else if (shell === "workspace") {
        expect(container.querySelector(".pg-shell--workspace")).toBeInTheDocument();
      } else {
        expect(container.querySelector(".pg-shell--editor")).toBeInTheDocument();
        // EditorShell has no persistent sidebar or publication switcher (AC-12).
        expect(screen.queryByRole("navigation", { name: "Publication" })).not.toBeInTheDocument();
        expect(screen.queryByLabelText("Publication")).not.toBeInTheDocument();
      }
    });
  }
});

// ── AC-04: edition workspace root redirects to content ────────────────

describe("Edition workspace root redirect", () => {
  it("resolves .../editions/:editionId to the content tab", async () => {
    renderAt("/org/org-demo-sahyadri/pub/pub-demo-pune-daily/editions/edition-demo-001");
    expect(await screen.findByRole("heading", { level: 1, name: "Content" })).toHaveTextContent("Content");
  });
});

// ── AC-02: refresh resolves identically to a fresh deep link ──────────

describe("Refresh resolves identically to a fresh deep link", () => {
  const paths = [
    "/",
    "/org/org-demo-sahyadri/pub/pub-demo-pune-daily/overview",
    "/org/org-demo-sahyadri/pub/pub-demo-pune-daily/editions/edition-demo-001/editor",
  ];

  for (const path of paths) {
    it(`"${path}" renders the same content on a fresh mount as on a repeat fresh mount`, async () => {
      const expectedHeading = path === "/" ? "Home" : path.endsWith("/editor") ? "Editor" : "Overview";
      const first = renderAt(path);
      await screen.findByRole("heading", { level: 1, name: expectedHeading });
      const firstH1 = first.container.querySelector("h1")?.textContent;
      first.unmount();

      // A full reload is, from the app's perspective, indistinguishable
      // from a fresh mount at the same URL — there is no client state
      // to lose, because UI002 has no service layer (§9.2).
      const second = renderAt(path);
      await screen.findByRole("heading", { level: 1, name: expectedHeading });
      expect(second.container.querySelector("h1")?.textContent).toBe(firstH1);
    });
  }
});

// ── AC-03: browser back/forward ────────────────────────────────────────

describe("Browser back/forward", () => {
  it("moves through exactly the URLs visited, in order, including a shell change", async () => {
    renderAt("/");
    const user = userEvent.setup();

    await user.click(screen.getByRole("link", { name: "Features" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Features");

    // Programmatic navigation to a workspace URL — Features has no
    // link into the workspace, so a direct history push simulates
    // "the user typed the next URL", giving a clean Public → Workspace
    // transition to verify shell switching survives back/forward.
    await act(async () => {
      window.history.pushState(null, "", "/org/org-demo-sahyadri/pub/pub-demo-pune-daily/overview");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    // The workspace nav also has an "Overview" link, so disambiguate
    // by role+level rather than text alone.
    await screen.findByRole("heading", { level: 1, name: "Overview" });

    expect(window.location.pathname).toBe("/org/org-demo-sahyadri/pub/pub-demo-pune-daily/overview");

    // "Features"/"Home" are also nav-link text, present alongside the
    // heading on every public page — disambiguate by role+level.
    window.history.back();
    await screen.findByRole("heading", { level: 1, name: "Features" });
    expect(window.location.pathname).toBe("/features");

    window.history.back();
    await screen.findByRole("heading", { level: 1, name: "Home" });
    expect(window.location.pathname).toBe("/");

    window.history.forward();
    await screen.findByRole("heading", { level: 1, name: "Features" });
    expect(window.location.pathname).toBe("/features");
  });
});

// ── AC-05, AC-22: not-found vs invalid-context are distinct ───────────

describe("Not-found", () => {
  it("an unmatched path renders NotFoundPage, not InvalidContextPage", async () => {
    renderAt("/this/path/does/not/exist");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Page not found");
    expect(screen.queryByText("Not available")).not.toBeInTheDocument();
  });

  it("an org-scoped path with no matching child also renders NotFoundPage", async () => {
    const { container } = renderAt(
      "/org/org-demo-sahyadri/pub/pub-demo-pune-daily/totally-unknown-section"
    );
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Page not found");
    expect(container.querySelector(".pg-shell--workspace")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
  });

  it("an unknown editor destination retains EditorShell", async () => {
    const { container } = renderAt(
      "/org/org-demo-sahyadri/pub/pub-demo-pune-daily/editions/edition-demo-001/editor/unknown"
    );
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Page not found");
    expect(container.querySelector(".pg-shell--editor")).toBeInTheDocument();
  });

  it("an unknown route shape remains not-found even when its context IDs are invalid", async () => {
    renderAt("/org/nonexistent-org/pub/nonexistent-pub/totally-unknown-section");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Page not found");
    expect(screen.queryByText("Not available")).not.toBeInTheDocument();
  });

  it("NotFoundPage renders inside Public shell chrome (route table's \"else Public\")", async () => {
    const { container } = renderAt("/nowhere");
    await screen.findByRole("heading", { level: 1, name: "Page not found" });
    expect(container.querySelector(".pg-skip-link")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  });
});

// ── AC-06, AC-07, AC-08: invalid context at each level ─────────────────

describe("Invalid context", () => {
  it("a non-existent :orgId renders the integrated access surface", async () => {
    renderAt("/org/nonexistent-org/settings");
    expect(await screen.findByRole("heading", { level: 1, name: "Access unavailable" })).toHaveTextContent("Access unavailable");
  });

  it("a non-existent :pubId under a valid org renders the integrated access surface", async () => {
    renderAt("/org/org-demo-sahyadri/pub/nonexistent-pub/overview");
    expect(await screen.findByRole("heading", { level: 1, name: "Access unavailable" })).toHaveTextContent("Access unavailable");
  });

  it("a :pubId that exists but belongs to a different org renders the integrated access surface", async () => {
    // pub-demo-ratnagiri-tide belongs to org-demo-konkan, not org-demo-sahyadri.
    renderAt("/org/org-demo-sahyadri/pub/pub-demo-ratnagiri-tide/overview");
    expect(await screen.findByRole("heading", { level: 1, name: "Access unavailable" })).toHaveTextContent("Access unavailable");
  });

  it("a non-existent :editionId under a valid publication renders InvalidContextPage", async () => {
    renderAt("/org/org-demo-sahyadri/pub/pub-demo-pune-daily/editions/nonexistent-edition/content");
    expect(await screen.findByText("This edition is not available in this publication.")).toBeInTheDocument();
  });

  it("an :editionId that exists but belongs to a different publication renders InvalidContextPage", async () => {
    // edition-demo-002 belongs to pub-demo-ratnagiri-tide, not pub-demo-pune-daily.
    renderAt("/org/org-demo-sahyadri/pub/pub-demo-pune-daily/editions/edition-demo-002/content");
    expect(await screen.findByText("This edition is not available in this publication.")).toBeInTheDocument();
  });

  it("a non-existent :releaseId under a valid publication renders InvalidContextPage", async () => {
    renderAt("/org/org-demo-sahyadri/pub/pub-demo-pune-daily/archive/nonexistent-release");
    expect(await screen.findByText("This archive release is not available in this publication.")).toBeInTheDocument();
  });

  it("the editor route also resolves invalid context (not just workspace routes)", async () => {
    renderAt("/org/org-demo-sahyadri/pub/pub-demo-pune-daily/editions/nonexistent-edition/editor");
    expect(await screen.findByText("This edition is not available in this publication.")).toBeInTheDocument();
  });
});

// ── AC-09: no record leakage — identical rendering, not just "no error" ──

describe("No record leakage between the two invalid-publication causes", () => {
  it("a nonexistent :pubId and a wrong-organization :pubId render identical safe DOM", async () => {
    const nonexistent = renderAt("/org/org-demo-sahyadri/pub/nonexistent-pub-xyz/overview");
    await screen.findByRole("heading", { level: 1, name: "Access unavailable" });
    const nonexistentMarkup = nonexistent.container.querySelector("main")?.innerHTML;
    nonexistent.unmount();

    const wrongOrg = renderAt("/org/org-demo-sahyadri/pub/pub-demo-ratnagiri-tide/overview");
    await screen.findByRole("heading", { level: 1, name: "Access unavailable" });
    const wrongOrgMarkup = wrongOrg.container.querySelector("main")?.innerHTML;

    expect(wrongOrgMarkup).toBe(nonexistentMarkup);
  });

  it("the access surface never names another organization or publication", async () => {
    const { container } = renderAt(
      "/org/org-demo-sahyadri/pub/pub-demo-ratnagiri-tide/overview"
    );
    await screen.findByRole("heading", { level: 1, name: "Access unavailable" });
    expect(screen.queryByText(/Konkan/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ratnagiri/)).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain("org-demo-konkan");
    expect(container.innerHTML).not.toContain("pub-demo-ratnagiri-tide");
    expect(container.innerHTML).toContain("pub-demo-pune-daily");
  });

  it("an inaccessible publication offers only the active safe workspace", async () => {
    renderAt("/org/org-demo-sahyadri/pub/pub-demo-ratnagiri-tide/overview");
    const link = await screen.findByRole("link", { name: "Open active workspace" });
    expect(link).toHaveAttribute("href", "/org/org-demo-sahyadri/pub/pub-demo-pune-daily/overview");
  });

  it("nonexistent and cross-publication editions render identical safe output", async () => {
    const nonexistent = renderAt(
      "/org/org-demo-sahyadri/pub/pub-demo-pune-daily/editions/nonexistent-edition/content"
    );
    await screen.findByRole("heading", { level: 1, name: "Not available" });
    const nonexistentMarkup = nonexistent.container.querySelector("main")?.innerHTML;
    nonexistent.unmount();

    const crossPublication = renderAt(
      "/org/org-demo-sahyadri/pub/pub-demo-pune-daily/editions/edition-demo-002/content"
    );
    await screen.findByRole("heading", { level: 1, name: "Not available" });
    expect(crossPublication.container.querySelector("main")?.innerHTML).toBe(nonexistentMarkup);
    expect(
      screen.getByRole("link", { name: "Return to a valid workspace page" })
    ).toHaveAttribute(
      "href",
      "/org/org-demo-sahyadri/pub/pub-demo-pune-daily/overview"
    );
    expect(crossPublication.container.innerHTML).not.toContain("edition-demo-002");
    expect(crossPublication.container.innerHTML).not.toContain("pub-demo-ratnagiri-tide");
  });

  it("nonexistent and cross-publication archive releases render identical safe output", async () => {
    const nonexistent = renderAt(
      "/org/org-demo-sahyadri/pub/pub-demo-urdu-evening/archive/nonexistent-release"
    );
    await screen.findByRole("heading", { level: 1, name: "Not available" });
    const nonexistentMarkup = nonexistent.container.querySelector("main")?.innerHTML;
    nonexistent.unmount();

    const crossPublication = renderAt(
      "/org/org-demo-sahyadri/pub/pub-demo-urdu-evening/archive/release-demo-001"
    );
    await screen.findByRole("heading", { level: 1, name: "Not available" });
    expect(crossPublication.container.querySelector("main")?.innerHTML).toBe(nonexistentMarkup);
    expect(
      screen.getByRole("link", { name: "Return to a valid workspace page" })
    ).toHaveAttribute(
      "href",
      "/org/org-demo-sahyadri/pub/pub-demo-urdu-evening/overview"
    );
    expect(crossPublication.container.innerHTML).not.toContain("release-demo-001");
    expect(crossPublication.container.innerHTML).not.toContain("pub-demo-pune-daily");
  });

  it("a deeper invalid child preserves the resolved publication locale", async () => {
    const { container } = renderAt(
      "/org/org-demo-sahyadri/pub/pub-demo-urdu-evening/editions/nonexistent-edition/content"
    );
    await screen.findByRole("heading", { level: 1, name: "Not available" });
    const shell = container.querySelector(".pg-shell--workspace");
    expect(shell).toHaveAttribute("dir", "rtl");
    expect(shell).toHaveAttribute("lang", "ur-IN");
  });
});

// ── AC-23, AC-24: reserved seams ────────────────────────────────────────

describe("Reserved status-surface seam (§9.4, BLV2-07)", () => {
  it("renders on WorkspaceShell with the exact required detail text", async () => {
    renderAt("/org/org-demo-sahyadri/pub/pub-demo-pune-daily/overview");
    expect(await screen.findByText("Simulated")).toBeInTheDocument();
    expect(
      screen.getByText("Reserved workspace status surface — bound to real edition state in UI015–020.")
    ).toBeInTheDocument();
  });

  it("renders on EditorShell with the exact required detail text", async () => {
    renderAt("/org/org-demo-sahyadri/pub/pub-demo-pune-daily/editions/edition-demo-001/editor");
    expect(await screen.findByText("Simulated")).toBeInTheDocument();
    expect(
      screen.getByText("Reserved workspace status surface — bound to real edition state in UI015–020.")
    ).toBeInTheDocument();
  });
});

describe("Reserved edition-planning nav seam (§9.4, BLV2-02)", () => {
  it("the Plan entry is discoverable, denied, and referenced by a visible explanation", async () => {
    renderAt("/org/org-demo-sahyadri/pub/pub-demo-pune-daily/editions/edition-demo-001/content");
    const planButton = await screen.findByRole("button", { name: "Plan" });
    expect(planButton).toHaveAttribute("aria-disabled", "true");
    expect(planButton).not.toBeDisabled();
    const describedBy = planButton.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      "Edition planning is not yet available — reserved for UI027."
    );
  });

  it("does not activate on click", async () => {
    renderAt("/org/org-demo-sahyadri/pub/pub-demo-pune-daily/editions/edition-demo-001/content");
    const user = userEvent.setup();
    const planButton = await screen.findByRole("button", { name: "Plan" });
    await user.click(planButton);
    // Still on the content tab — a real activation would have to
    // navigate somewhere, and there is nowhere for it to navigate to.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Content");
  });
});

// ── Placeholder truthfulness (§6.1) ─────────────────────────────────────

describe("Placeholders never imply the feature behind them works", () => {
  it("names the owning future unit and contains no fabricated data", async () => {
    renderAt("/org/org-demo-sahyadri/pub/pub-demo-pune-daily/stories");
    expect(await screen.findByText(/not yet implemented/i)).toHaveTextContent("UI010–011");
    // Scoped to <main> only: the breadcrumb trail in the header is a
    // legitimate <ol> (role="list"), not fabricated story data.
    const main = document.querySelector("main")!;
    expect(main.querySelector('[role="list"], ul, ol, table')).not.toBeInTheDocument();
  });
});
