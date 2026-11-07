/**
 * The app frame's audit fixes: the tab's title names the page, an address the person's role does not open says so
 * (with a way home) instead of showing only its title, and the print profile form's "(required)" is in Marathi too.
 * On the test double; fictional data only.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "../../src/test/render.tsx";
import { renderAuth, resetBrowserState, seriousViolations } from "../auth/helpers.tsx";

vi.setConfig({ testTimeout: 30_000 });

const ORG = "org-demo-sahyadri";
const PUB = "pub-demo-pune-daily";

afterEach(() => {
  resetBrowserState();
  vi.restoreAllMocks();
});

describe("page titles", () => {
  it("names the tab after the page's heading", async () => {
    renderAuth(`/org/${ORG}/pub/${PUB}/print-profiles`, { preset: "sahyadri-owner" });
    await screen.findByRole("heading", { level: 1, name: "Print profiles" });
    await waitFor(() => expect(document.title).toBe("Print profiles · Pageinator"));
  });
});

describe("an address the role does not open", () => {
  for (const [screenName, path] of [
    ["Templates", `/org/${ORG}/pub/${PUB}/templates`],
    ["Print profiles", `/org/${ORG}/pub/${PUB}/print-profiles`],
    ["Ads desk", `/org/${ORG}/pub/${PUB}/ads`],
  ] as const) {
    it(`tells a Reporter they have no access to ${screenName}, with a link home; axe clean`, async () => {
      const { container } = renderAuth(path, { preset: "sahyadri-reporter" });
      await screen.findByRole("heading", { level: 1, name: screenName });
      expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Back to the organisation's home" })).toHaveAttribute("href", `/org/${ORG}`);
      expect(await seriousViolations(container)).toEqual([]);
    });
  }

  it("keeps the audit log's own reason, with the link home, in Marathi", async () => {
    renderAuth(`/org/${ORG}/audit`, { preset: "sahyadri-reporter", language: "mr" });
    expect(await screen.findByText("तुम्हाला कामकाजाची नोंद पाहता येत नाही")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "संस्थेच्या मुख्य पानावर परत जा" })).toHaveAttribute("href", `/org/${ORG}`);
  });
});

describe("the print profile form in Marathi", () => {
  it("marks the press name required in Marathi", async () => {
    renderAuth(`/org/${ORG}/pub/${PUB}/print-profiles`, { preset: "sahyadri-owner", language: "mr" });
    await screen.findByText("अजून छपाई प्रोफाइल नाही");
    expect(screen.getByText("(आवश्यक)")).toBeInTheDocument();
    expect(screen.queryByText("(required)")).not.toBeInTheDocument();
  });
});
