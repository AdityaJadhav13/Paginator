/**
 * A page's approval in the page editor (plan §1 L2.5), on the test doubles with a fictional page: an approved page is
 * read-only with who approved it and when, "Unlock" for page.unlock; "Approve" with the release view's revision and
 * SHA-256 once the page is saved and checked; a change refused as approved meanwhile (409 page_approved) reloads the
 * page and says why; axe on the approved page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "../../src/test/render.tsx";
import { createMockApplicationEnvironment } from "../../src/mocks/index.ts";
import { renderAuth, resetBrowserState, seriousViolations } from "../auth/helpers.tsx";

vi.setConfig({ testTimeout: 30_000 });

const ORG = "org-demo-sahyadri";
const PUB = "pub-demo-pune-daily";
const EDITION = "edition-demo-2026-10-24";
const RUN = "run-demo-001";
const EDIT = `/org/${ORG}/pub/${PUB}/editions/${EDITION}/runs/${RUN}/pages/1/edit`;
const SHA1 = "01".repeat(32);

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.stubGlobal(
    "Path2D",
    class {
      constructor(readonly d?: string) {}
    },
  );
});
afterEach(() => {
  resetBrowserState();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Page 1 approved by the Chief Editor (the release double learns the board's pages first). */
async function approved() {
  const environment = createMockApplicationEnvironment();
  await environment.sessionController.actAs("sahyadri-chief-editor", async () => {
    await environment.release.get({ orgId: ORG, pubId: PUB, editionId: EDITION });
    await environment.release.approvePage({ orgId: ORG, pubId: PUB, runId: RUN, page: 1, rev: 0, pdfSha256: SHA1 });
  });
  return environment;
}

const ready = () => screen.findByRole("heading", { name: "Selected story" });

describe("an approved page in the editor", () => {
  it("is read-only, says who approved it, and a Chief Editor unlocks it", async () => {
    const environment = await approved();
    const { container } = renderAuth(EDIT, { preset: "sahyadri-chief-editor", environment });
    await ready();
    expect(screen.getByText(/^Approved by Sahyadri Demo Chief Editor, /)).toBeInTheDocument();
    expect(
      screen.getByText("An approved page cannot be changed. Unlock it to change it; it then needs approving again."),
    ).toBeInTheDocument();
    for (const name of ["Save page", "Try another layout"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(await seriousViolations(container)).toEqual([]);
    // the banner's text is not a paragraph inside the message's paragraph
    expect(container.querySelector("p p")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));
    await waitFor(() => expect(screen.queryByText(/^Approved by/)).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Save page" })).toBeEnabled();
  });

  it("asks a person without page.unlock to have it unlocked", async () => {
    const environment = await approved();
    renderAuth(EDIT, { preset: "sahyadri-subeditor", environment });
    await ready();
    expect(
      screen.getByText(
        "An approved page cannot be changed. Ask someone who can unlock pages (a Chief Editor, the Owner or an Admin) to unlock it.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Unlock" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve page" })).not.toBeInTheDocument();
  });
});

describe("approving from the editor", () => {
  it("approves a saved, checked page with the release view's revision and SHA-256", async () => {
    const environment = createMockApplicationEnvironment();
    const approve = vi.spyOn(environment.release, "approvePage");
    renderAuth(EDIT, { preset: "sahyadri-chief-editor", environment });
    await ready();
    const button = await screen.findByRole("button", { name: "Approve page" });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    expect(approve).toHaveBeenCalledWith({ orgId: ORG, pubId: PUB, runId: RUN, page: 1, rev: 0, pdfSha256: SHA1 });
    expect(await screen.findByText(/^Approved by Sahyadri Demo Chief Editor, /)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save page" })).toBeDisabled();
  });

  it("says the page changed when the approval is stale", async () => {
    const environment = createMockApplicationEnvironment();
    vi.spyOn(environment.release, "approvePage").mockResolvedValue({
      ok: false,
      error: { kind: "answer", status: 409, code: "approval_stale", message: "" },
    });
    renderAuth(EDIT, { preset: "sahyadri-chief-editor", environment });
    await ready();
    const button = await screen.findByRole("button", { name: "Approve page" });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    expect(await screen.findByText(/^The page changed since you looked, so it was not approved\./)).toBeTruthy();
  });

  it("cannot approve while a change is not saved", async () => {
    const environment = createMockApplicationEnvironment();
    renderAuth(EDIT, { preset: "sahyadri-chief-editor", environment });
    await ready();
    await waitFor(() => expect(screen.getByRole("button", { name: "Approve page" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Try another layout" }));
    expect(await screen.findByText("It needs saving in the page editor before it can be approved.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve page" })).toBeDisabled();
  });

  it("cannot approve a page that needs saving, even with no new revision", async () => {
    const environment = createMockApplicationEnvironment();
    const open = environment.editor.open.bind(environment.editor);
    vi.spyOn(environment.editor, "open").mockImplementation(async (where) => {
      const r = await open(where);
      return r.ok ? { ok: true, value: { ...r.value, pageState: { ...r.value.pageState, needsSave: true } } } : r;
    });
    renderAuth(EDIT, { preset: "sahyadri-chief-editor", environment });
    await ready();
    expect(await screen.findByText("It needs saving in the page editor before it can be approved.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve page" })).toBeDisabled();
  });

  it("reloads the page and says why when it was approved meanwhile (409 page_approved)", async () => {
    const environment = createMockApplicationEnvironment();
    renderAuth(EDIT, { preset: "sahyadri-editor", environment });
    await ready();
    await environment.sessionController.actAs("sahyadri-chief-editor", async () => {
      await environment.release.get({ orgId: ORG, pubId: PUB, editionId: EDITION });
      await environment.release.approvePage({ orgId: ORG, pubId: PUB, runId: RUN, page: 1, rev: 0, pdfSha256: SHA1 });
    });
    await userEvent.click(screen.getByRole("button", { name: "Try another layout" }));
    expect(
      await screen.findByText(
        "This page was approved meanwhile, so your change was not made. It shows the page as it is now.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Approved by Sahyadri Demo Chief Editor, /)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save page" })).toBeDisabled();
  });
});
