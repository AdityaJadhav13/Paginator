/**
 * Print profiles on the test double with fictional data: none yet, a save making version 1 then 2 (the earlier one in
 * the history), the read-only facts in words (no setting for them), view-only for a chief editor; axe in English and Marathi.
 * The press test page: saved as a download with its SHA-256 shown, and a refusal in its own words.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, within } from "../../src/test/render.tsx";
import { createMockApplicationEnvironment } from "../../src/mocks/index.ts";
import { renderAuth, resetBrowserState, seriousViolations } from "../auth/helpers.tsx";

vi.setConfig({ testTimeout: 30_000 });

const ORG = "org-demo-sahyadri";
const PUB = "pub-demo-pune-daily";
const PAGE = `/org/${ORG}/pub/${PUB}/print-profiles`;

afterEach(() => {
  resetBrowserState();
  vi.restoreAllMocks();
});

describe("print profiles", () => {
  it("saves each change as a new version and shows the engine's facts read-only; axe clean", async () => {
    const environment = createMockApplicationEnvironment();
    const add = vi.spyOn(environment.release, "addPrintProfile");
    const user = userEvent.setup();
    const { container } = renderAuth(PAGE, { preset: "sahyadri-owner", environment });
    expect(await screen.findByText("No print profile yet")).toBeInTheDocument();
    expect(screen.getByText("330 × 520 mm, from the front template of engine profile version 1")).toBeInTheDocument();
    expect(screen.getByText("The newest layout's pages were tested by the independent PDF/X-1a checker (its verdict per page is on the Release tab).")).toBeInTheDocument();
    expect(screen.getByText("Download and send yourself")).toBeInTheDocument();
    expect(screen.getByText(/below 200 ppi fails its check.*150 ppi; this is advice/)).toBeInTheDocument();
    expect(await seriousViolations(container)).toEqual([]);

    await user.type(screen.getByLabelText(/Press name/), "Fictional Press");
    await user.type(screen.getByLabelText("Contact (optional)"), "press@example.test");
    await user.click(screen.getByRole("button", { name: "Save as a new version" }));
    expect(await screen.findByText("Saved as version 1.")).toBeInTheDocument();
    expect(add).toHaveBeenLastCalledWith(
      expect.objectContaining({ pressName: "Fictional Press", contact: "press@example.test", idempotencyKey: expect.any(String) }),
    );
    expect(await screen.findByRole("heading", { name: "In use: version 1" })).toBeInTheDocument();

    const name = screen.getByLabelText(/Press name/);
    await user.clear(name);
    await user.type(name, "Other Fictional Press");
    await user.click(screen.getByRole("button", { name: "Save as a new version" }));
    expect(await screen.findByRole("heading", { name: "In use: version 2" })).toBeInTheDocument();
    const history = within(screen.getByRole("table", { name: "Earlier versions" }));
    expect(history.getByText("Fictional Press")).toBeInTheDocument();
  });

  it("is view-only for a chief editor, in Marathi too; axe clean", async () => {
    const { container } = renderAuth(PAGE, { preset: "sahyadri-chief-editor", language: "mr" });
    expect(await screen.findByText("अजून छपाई प्रोफाइल नाही")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "नवी आवृत्ती म्हणून जतन करा" })).not.toBeInTheDocument();
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("downloads the press test page and shows its SHA-256 and check; a refusal in its own words", async () => {
    URL.createObjectURL = vi.fn(() => "blob:fictional");
    URL.revokeObjectURL = vi.fn();
    const saved: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download);
    });
    const environment = createMockApplicationEnvironment();
    const user = userEvent.setup();
    renderAuth(PAGE, { preset: "sahyadri-chief-editor", environment });
    await user.click(await screen.findByRole("button", { name: "Download press test page" }));
    expect(await screen.findByText("e".repeat(64))).toBeInTheDocument();
    expect(screen.getByText(/Independent PDF\/X-1a check: passed \(2 warnings\)/)).toBeInTheDocument();
    expect(saved).toEqual([`pageinator-press-test-${"e".repeat(12)}.pdf`]);

    vi.spyOn(environment.release, "pressTestPage").mockResolvedValueOnce({
      ok: false,
      error: { kind: "answer", status: 503, code: "press_test_unavailable", message: "" },
    });
    await user.click(screen.getByRole("button", { name: "Download press test page" }));
    expect(
      await screen.findByText("The press test page cannot be made just now. Try again in a few minutes."),
    ).toBeInTheDocument();
  });

  it("keeps every version on the double, newest first", async () => {
    const environment = createMockApplicationEnvironment();
    const where = { orgId: ORG, pubId: PUB };
    await environment.release.addPrintProfile({ ...where, pressName: "Fictional Press", idempotencyKey: "k1" });
    await environment.release.addPrintProfile({ ...where, pressName: "Other Fictional Press", idempotencyKey: "k2" });
    const list = await environment.release.printProfiles(where);
    expect(list.ok && list.value.items.map((p) => p.version)).toEqual([2, 1]);
  });
});
