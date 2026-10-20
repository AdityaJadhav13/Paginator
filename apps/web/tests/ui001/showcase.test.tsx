/**
 * Showcase-level integration tests (H-05).
 *
 * §13.2–13.4 and Task 8/9 require verification of the assembled
 * showcase, not only its individual components in isolation: axe on
 * every showcase section and each dialog-open state, keyboard
 * traversal, and the full page under both LTR and RTL. This file
 * covers what jsdom can establish; jsdom has no layout engine, so the
 * 320 CSS pixel horizontal-scroll requirement (§9, Task 8) cannot be
 * verified here and was instead checked directly in a real browser
 * (see docs/reviews/UI001_INDEPENDENT_CODE_REVIEW.md M-04 and the
 * correction pass notes) — jsdom cannot measure `scrollWidth` against
 * an actual rendered layout.
 *
 * A small number of meaningful behavioral assertions are preferred
 * here over exhaustive generated checks (see review finding M-11).
 */

import { describe, it, expect } from "vitest";
import { render, screen, within } from "../../src/test/render.tsx";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { Ui001Showcase } from "../../src/demo/ui001/Ui001Showcase.tsx";

async function checkAxe(node: Element) {
  const results = await axe.run(node, {
    rules: {
      // Disable color-contrast in jsdom — CSS custom properties are not
      // resolved in the test environment. Contrast is separately
      // verified against actual token values in tokens.test.ts.
      "color-contrast": { enabled: false },
    },
  });
  return results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious"
  );
}

// ── axe per showcase section (§13.3, AC-28) ───────────────────────────

describe("Showcase — axe per section", () => {
  it("renders one h1 and only ordered section headings", () => {
    const { container } = render(<Ui001Showcase />);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    const sections = container.querySelectorAll("section[aria-labelledby]");
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) {
      const headingId = section.getAttribute("aria-labelledby");
      expect(headingId).toBeTruthy();
      expect(document.getElementById(headingId!)).toBeInTheDocument();
    }
  });

  it("every showcase section has zero serious/critical axe violations", async () => {
    const { container } = render(<Ui001Showcase />);
    const sections = container.querySelectorAll("section[aria-labelledby]");
    expect(sections.length).toBeGreaterThanOrEqual(10);

    for (const section of sections) {
      const violations = await checkAxe(section);
      expect(
        violations,
        `section "${section.getAttribute("aria-labelledby")}": ${JSON.stringify(
          violations.map((v) => v.id)
        )}`
      ).toHaveLength(0);
    }
  });

  it("the full showcase has zero serious/critical axe violations", async () => {
    const { container } = render(<Ui001Showcase />);
    const violations = await checkAxe(container);
    expect(violations).toHaveLength(0);
  });
});

// ── axe with each dialog open (§13.3, AC-28, AC-12) ────────────────────

describe("Showcase — axe with a dialog open", () => {
  it("dismissible dialog open: zero serious/critical violations", async () => {
    const { container } = render(<Ui001Showcase />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    expect(screen.getByRole("dialog", { name: "Review edition" })).toBeInTheDocument();
    const violations = await checkAxe(container);
    expect(violations).toHaveLength(0);
  });

  it("non-dismissible dialog open: zero serious/critical violations", async () => {
    const { container } = render(<Ui001Showcase />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open non-dismissible dialog" }));
    expect(screen.getByRole("dialog", { name: "Confirm deletion" })).toBeInTheDocument();
    const violations = await checkAxe(container);
    expect(violations).toHaveLength(0);
  });
});

// ── Keyboard traversal (§13.2) ──────────────────────────────────────

describe("Showcase — keyboard traversal", () => {
  it("Tab never focuses a disabled control and does reach discoverable denied controls", async () => {
    const { container } = render(<Ui001Showcase />);
    const user = userEvent.setup();

    const deniedButtons = Array.from(
      container.querySelectorAll('button[aria-disabled="true"]')
    );
    expect(deniedButtons.length).toBeGreaterThan(0);

    const focusableCount = container.querySelectorAll(
      "button, input, select, textarea, a[href]"
    ).length;
    const reached = new Set<Element>();

    for (let i = 0; i < focusableCount + 5; i++) {
      await user.tab();
      const active = document.activeElement;
      if (!active || active === document.body) break;
      reached.add(active);
      expect(
        active.hasAttribute("disabled"),
        `Tab focused a disabled element: ${active.outerHTML.slice(0, 80)}`
      ).toBe(false);
    }

    for (const btn of deniedButtons) {
      expect(reached.has(btn)).toBe(true);
    }
  });

  it("Enter activates an enabled scenario button exactly once", async () => {
    render(<Ui001Showcase />);
    const user = userEvent.setup();
    const advanceButton = screen.getByRole("button", { name: "Request save" });
    advanceButton.focus();
    await user.keyboard("{Enter}");
    // Scenario 1 advanced from "Simulated" to "Pending" — the button's
    // own label changes because the next step's advanceLabel differs.
    expect(
      screen.queryByRole("button", { name: "Request save" })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Acknowledge save" })
    ).toBeInTheDocument();
  });
});

// ── Full LTR and RTL render (§13.4, AC-16) ──────────────────────────

describe("Showcase — full LTR and RTL render", () => {
  it("defaults to LTR/en-IN and switches to RTL/ur-IN without losing content", async () => {
    render(<Ui001Showcase />);
    const user = userEvent.setup();
    const root = document.getElementById("pg-showcase-root")!;

    expect(root).toHaveAttribute("dir", "ltr");
    expect(root).toHaveAttribute("lang", "en-IN");
    expect(screen.getByText("Current direction:").parentElement).toHaveTextContent("LTR");

    await user.click(screen.getByRole("button", { name: "RTL (ur-IN)" }));

    expect(root).toHaveAttribute("dir", "rtl");
    expect(root).toHaveAttribute("lang", "ur-IN");
    expect(screen.getByText("Current direction:").parentElement).toHaveTextContent("RTL");
    // The same page content remains — direction is a root attribute,
    // not a re-render of different content.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Pageinator UI Foundation"
    );
  });

  it("RTL render still exposes every showcase section", async () => {
    const { container } = render(<Ui001Showcase />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "RTL (ur-IN)" }));
    const sections = container.querySelectorAll("section[aria-labelledby]");
    expect(sections.length).toBeGreaterThanOrEqual(10);
  });
});

// ── Scenario sequences match §10.4 exactly (AC-26) ─────────────────
//
// These drive the scenarios through the actual rendered showcase
// (not just the underlying step arrays in isolation), so they also
// prove the H-03 fixes are correctly wired into what is displayed.

describe("Showcase — scenario sequences (§10.4)", () => {
  it("Scenario 1: simulated → pending → saved intention → recomposing → confirmed proof", async () => {
    render(<Ui001Showcase />);
    const user = userEvent.setup();
    const card = screen.getByText("Scenario 1 — Save then resolve").closest(".pg-surface")!;
    const scoped = within(card as HTMLElement);

    expect(scoped.getByText("Simulated")).toBeInTheDocument();
    await user.click(scoped.getByRole("button", { name: "Request save" }));
    expect(scoped.getByText("Pending")).toBeInTheDocument();
    expect(scoped.getAllByText(/demo-rev-018/).length).toBeGreaterThan(0);

    await user.click(scoped.getByRole("button", { name: "Acknowledge save" }));
    expect(scoped.getByText("Saved Intention")).toBeInTheDocument();

    await user.click(scoped.getByRole("button", { name: "Begin resolution" }));
    expect(scoped.getByText("Recomposing")).toBeInTheDocument();

    await user.click(scoped.getByRole("button", { name: "Complete resolution" }));
    expect(scoped.getByText("Confirmed Proof")).toBeInTheDocument();
    expect(scoped.getAllByText(/demo-proof-018-a/).length).toBeGreaterThan(0);
    expect(scoped.getAllByText(/demo-rev-018/).length).toBeGreaterThan(0);

    // Terminal: the only remaining button is "Reset scenario".
    expect(scoped.getAllByRole("button")).toHaveLength(1);

    await user.click(scoped.getByRole("button", { name: "Reset scenario" }));
    expect(scoped.getByText("Simulated")).toBeInTheDocument();
  });

  it("Scenario 2: confirmed proof → saved intention AND stale proof shown together", async () => {
    render(<Ui001Showcase />);
    const user = userEvent.setup();
    const card = screen.getByText("Scenario 2 — Proof becomes stale").closest(".pg-surface")!;
    const scoped = within(card as HTMLElement);

    expect(scoped.getByText("Confirmed Proof")).toBeInTheDocument();
    await user.click(scoped.getByRole("button", { name: "Edit to new revision" }));

    // Both statuses are visible at once — neither silently replaces
    // the other (H-03).
    expect(scoped.getByText("Saved Intention")).toBeInTheDocument();
    expect(scoped.getByText("Stale")).toBeInTheDocument();
    // The stale proof shows both the revision it belongs to and the
    // newer current revision (H-02).
    expect(scoped.getAllByText(/demo-rev-018/).length).toBeGreaterThan(0);
    expect(scoped.getAllByText(/demo-rev-019/).length).toBeGreaterThan(0);
    expect(scoped.getAllByText(/demo-proof-018-a/).length).toBeGreaterThan(0);
  });

  it("Scenario 3: last confirmed proof stays visible while recomposing and after failure", async () => {
    render(<Ui001Showcase />);
    const user = userEvent.setup();
    const card = screen.getByText("Scenario 3 — Resolution fails safely").closest(".pg-surface")!;
    const scoped = within(card as HTMLElement);

    // Before any advance: recomposing revision 19, AND the last
    // confirmed proof (revision 18) already visible — a proof is never
    // absent while a later revision recomposes (§4 rule 3).
    expect(scoped.getByText("Recomposing")).toBeInTheDocument();
    expect(scoped.getByText("Confirmed Proof")).toBeInTheDocument();
    expect(scoped.getAllByText(/demo-proof-018-a/).length).toBeGreaterThan(0);

    await user.click(scoped.getByRole("button", { name: "Trigger failure" }));

    expect(scoped.getByText("Failed")).toBeInTheDocument();
    // The last confirmed proof remains, separately identified, bound
    // to revision 18 — unaffected by the failed revision-19 attempt.
    expect(scoped.getByText("Confirmed Proof")).toBeInTheDocument();
    expect(scoped.getAllByText(/demo-proof-018-a/).length).toBeGreaterThan(0);
    expect(scoped.getAllByText(/demo-rev-018/).length).toBeGreaterThan(0);
  });

  it("Scenario 4: approved candidate always shows 'Not published'", async () => {
    render(<Ui001Showcase />);
    const user = userEvent.setup();
    const card = screen
      .getByText("Scenario 4 — Candidate approval is not publication")
      .closest(".pg-surface")!;
    const scoped = within(card as HTMLElement);

    expect(scoped.getByText("Confirmed Proof")).toBeInTheDocument();
    await user.click(scoped.getByRole("button", { name: "Approve as candidate" }));

    expect(scoped.getByText("Approved Candidate")).toBeInTheDocument();
    expect(scoped.getAllByText(/demo-candidate-042/).length).toBeGreaterThan(0);
    expect(scoped.getByText("Not published")).toBeInTheDocument();
    expect(scoped.queryByText(/published edition/i)).not.toBeInTheDocument();
  });
});
