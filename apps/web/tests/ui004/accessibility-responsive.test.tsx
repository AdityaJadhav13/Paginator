import { describe, expect, it } from "vitest";
import axe from "axe-core";
import userEvent from "@testing-library/user-event";
import { screen } from "../../src/test/render.tsx";
import { createMockApplicationEnvironment } from "../../src/mocks/index.ts";
import { renderUi004 } from "./renderUi004.tsx";

async function seriousViolations(container: HTMLElement) {
  const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  return result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
}

describe("UI004 accessibility and responsive contract", () => {
  it("auth, allowed workspace, and access-unavailable surfaces have no serious axe violations", async () => {
    for (const [path, preset] of [
      ["/login", "signed-out"],
      ["/org/org-demo-sahyadri/pub/pub-demo-pune-daily/overview", "sahyadri-editor"],
      ["/org/org-demo-sahyadri/settings", "konkan-reviewer"],
    ] as const) {
      const view = renderUi004(path, preset);
      await screen.findByRole("heading", { level: 1 });
      expect(view.container.querySelectorAll("h1")).toHaveLength(1);
      expect(await seriousViolations(view.container)).toHaveLength(0);
      view.unmount();
    }
  });

  it("supports keyboard-only sign-in", async () => {
    const { editor } = createMockApplicationEnvironment().sessionController.fixtures.accounts;
    renderUi004("/login", "signed-out");
    const email = await screen.findByLabelText("Email address");
    email.focus();
    const user = userEvent.setup();
    await user.keyboard(editor.email);
    await user.tab();
    expect(screen.getByLabelText("Password")).toHaveFocus();
    await user.keyboard(`${editor.password}{Enter}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Sahyadri Media Cooperative" })).toHaveFocus();
  });

  it("retains phone editor-review behavior", async () => {
    const original = window.matchMedia;
    window.matchMedia = (query: string) => ({ matches: query.includes("767px"), media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList;
    try {
      renderUi004("/org/org-demo-sahyadri/pub/pub-demo-pune-daily/editions/edition-demo-001/editor");
      expect(await screen.findByRole("heading", { level: 1, name: "Edition review" })).toBeInTheDocument();
    } finally {
      window.matchMedia = original;
    }
  });
});
