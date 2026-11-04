/**
 * Stories → Import Word file (plan §L2.2): the side sheet's upload (purpose docx), the import, its end heard live or
 * found by polling, the stories made as links, the Desk's notes in plain words, the refusals (client-side, the API's
 * docx_refused, a failed import), who sees the action, and axe. On the test double; fictional data only.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { DOCX_TYPE, MAX_DOCX_BYTES } from "@pageinator/contracts";
import { act, screen, waitFor, within } from "../../src/test/render.tsx";
import { createMockApplicationEnvironment } from "../../src/mocks/index.ts";
import { POLL_MS } from "../../src/features/stories/ImportWordDrawer.tsx";
import { renderAuth, resetBrowserState, seriousViolations } from "../auth/helpers.tsx";

const STORIES = "/org/org-demo-sahyadri/pub/pub-demo-pune-daily/stories";

afterEach(() => {
  resetBrowserState();
  vi.useRealTimers();
});

/** A fictional .docx: a ZIP's first bytes are all the double looks at. */
const docx = (name = "fictional-pages.docx", bytes = [0x50, 0x4b, 0x03, 0x04, 0, 0]) =>
  new File([new Uint8Array(bytes)], name, { type: DOCX_TYPE });

const rows = () => screen.getAllByRole("row").slice(1);

async function openDrawer(options: Parameters<typeof renderAuth>[1] = {}, advanceTimers?: (ms: number) => void) {
  const view = renderAuth(STORIES, { preset: "sahyadri-editor", ...options });
  const user = userEvent.setup({ applyAccept: false, ...(advanceTimers ? { advanceTimers } : {}) });
  await screen.findByRole("table");
  await user.click(screen.getByRole("button", { name: "Import Word file" }));
  const sheet = within(await screen.findByRole("dialog", { name: "Import a Word file" }));
  return { ...view, user, sheet };
}

describe("Import a Word file", () => {
  it("uploads the file, imports it into an edition, hears the end live, and lists the stories made", async () => {
    const environment = createMockApplicationEnvironment();
    const presign = vi.spyOn(environment.media, "presign");
    const importDocx = vi.spyOn(environment.stories, "importDocx");
    const { user, sheet } = await openDrawer({ environment });
    await user.upload(sheet.getByLabelText("Word file (.docx)"), docx());
    await user.selectOptions(sheet.getByRole("combobox", { name: "Edition" }), "edition-demo-2026-10-23");
    await user.click(sheet.getByRole("button", { name: "Import" }));
    expect(await sheet.findByText("Reading the file…")).toBeInTheDocument();
    expect(sheet.getByRole("list", { name: "Progress" })).toBeInTheDocument();
    expect(presign.mock.calls[0]![0]).toMatchObject({ purpose: "docx", contentType: DOCX_TYPE, filename: "fictional-pages.docx" });
    expect(importDocx.mock.calls[0]![0]).toMatchObject({ uploadId: "upload-001", editionId: "edition-demo-2026-10-23" });

    await act(() =>
      environment.sessionController.finishImport("import-001", {
        headlines: ["Fictional ward meeting", "Fictional library opens"],
        skipped: 1,
        notes: [
          { code: "docx.tables", count: 2, text: "2 tables were left out." },
          { code: "docx.formatting", count: null, text: "Formatting was not kept." },
          { code: "docx.something_new", count: null, text: "A fictional note the web does not know." },
        ],
      }),
    );
    expect(await sheet.findByText("Done. Stories made: 2. Skipped: 1.")).toHaveAttribute("role", "status");
    expect(sheet.getByRole("link", { name: "Fictional ward meeting" })).toHaveAttribute("href", expect.stringMatching(/\/stories\/story-new-\d+$/));
    expect(sheet.getByText("Tables, left out: 2")).toBeInTheDocument();
    expect(sheet.getByText("Formatting such as bold and italics was not kept.")).toBeInTheDocument();
    expect(sheet.getByText("A fictional note the web does not know.")).toHaveAttribute("lang", "en");
    // the list was fetched again
    await waitFor(() => expect(rows()).toHaveLength(7));

    await user.click(sheet.getByRole("button", { name: "Import another file" }));
    expect(sheet.getByLabelText("Word file (.docx)")).toBeEnabled();
  });

  it("finds the end by polling when no live event comes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const environment = createMockApplicationEnvironment();
    const { user, sheet } = await openDrawer({ environment }, vi.advanceTimersByTime.bind(vi));
    await user.upload(sheet.getByLabelText("Word file (.docx)"), docx());
    await user.click(sheet.getByRole("button", { name: "Import" }));
    expect(await sheet.findByText("Reading the file…")).toBeInTheDocument();
    const getImport = vi.spyOn(environment.stories, "getImport");
    environment.liveController.drop(true);
    await act(() => environment.sessionController.finishImport("import-001"));
    expect(sheet.getByText("Reading the file…")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    expect(await sheet.findByText("Done. Stories made: 2. Skipped: 0.")).toBeInTheDocument();
    expect(getImport).toHaveBeenCalled();
    // polling stops once it is done
    const calls = getImport.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    });
    expect(getImport.mock.calls.length).toBe(calls);
  });

  it("stops polling and says why when the import can no longer be read", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const environment = createMockApplicationEnvironment();
    const { user, sheet } = await openDrawer({ environment }, vi.advanceTimersByTime.bind(vi));
    await user.upload(sheet.getByLabelText("Word file (.docx)"), docx());
    await user.click(sheet.getByRole("button", { name: "Import" }));
    expect(await sheet.findByText("Reading the file…")).toBeInTheDocument();
    const getImport = vi
      .spyOn(environment.stories, "getImport")
      .mockResolvedValue({ ok: false, error: { kind: "answer", status: 404, code: "not_found", message: "" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    expect(await sheet.findByRole("button", { name: "Import" })).toBeEnabled();
    expect(sheet.queryByText("Reading the file…")).not.toBeInTheDocument();
    const calls = getImport.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    });
    expect(getImport.mock.calls.length).toBe(calls);
  });

  it("shows the API's refusal of a file that is not a Word file", async () => {
    const { user, sheet } = await openDrawer();
    await user.upload(sheet.getByLabelText("Word file (.docx)"), docx("fictional-renamed.docx", [0x25, 0x50, 0x44, 0x46]));
    await user.click(sheet.getByRole("button", { name: "Import" }));
    // one heading for the API's refusal and the engine's
    expect(await sheet.findByText("This Word file was not imported")).toBeInTheDocument();
    expect(sheet.getByText("This is not a Word (.docx) file. Save it as .docx and try again.")).toBeInTheDocument();
    expect(sheet.getByRole("button", { name: "Import" })).toBeEnabled();
  });

  it("shows a failed import in plain words, and lets another file be picked", async () => {
    const environment = createMockApplicationEnvironment();
    const { user, sheet } = await openDrawer({ environment });
    await user.upload(sheet.getByLabelText("Word file (.docx)"), docx());
    await user.click(sheet.getByRole("button", { name: "Import" }));
    await sheet.findByText("Reading the file…");
    await act(() =>
      environment.sessionController.finishImport("import-001", { error: { code: "docx.not_word", message: "Fictional Desk message." } }),
    );
    expect(await sheet.findByText("This Word file was not imported")).toBeInTheDocument();
    expect(sheet.getByText("This is not a Word (.docx) file. Save it as .docx and try again.")).toBeInTheDocument();
    expect(sheet.queryByText("Fictional Desk message.")).not.toBeInTheDocument();
    expect((sheet.getByLabelText("Word file (.docx)") as HTMLInputElement).files).toHaveLength(0);

    // another file; the engine fails this time: the general words
    await user.upload(sheet.getByLabelText("Word file (.docx)"), docx("fictional-second.docx"));
    await user.click(sheet.getByRole("button", { name: "Import" }));
    await sheet.findByText("Reading the file…");
    await act(() => environment.sessionController.finishImport("import-002", { error: { code: "worker.crashed", message: "Fictional engine words." } }));
    expect(await sheet.findByText("The file could not be read just now. Try again.")).toBeInTheDocument();

    // a Desk code the web has no words for: the Desk's English
    await user.upload(sheet.getByLabelText("Word file (.docx)"), docx("fictional-third.docx"));
    await user.click(sheet.getByRole("button", { name: "Import" }));
    await sheet.findByText("Reading the file…");
    await act(() => environment.sessionController.finishImport("import-003", { error: { code: "docx.refused", message: "Fictional Desk refusal." } }));
    expect(await sheet.findByText("Fictional Desk refusal.")).toHaveAttribute("lang", "en");
  });

  it("refuses a file that is not .docx or is over 10 MB before sending anything", async () => {
    const environment = createMockApplicationEnvironment();
    const presign = vi.spyOn(environment.media, "presign");
    const { user, sheet } = await openDrawer({ environment });
    await user.click(sheet.getByRole("button", { name: "Import" }));
    expect(sheet.getByLabelText("Word file (.docx)")).toHaveAccessibleDescription(/Choose a Word file\./);

    await user.upload(sheet.getByLabelText("Word file (.docx)"), new File(["x"], "fictional.pdf", { type: "application/pdf" }));
    expect(sheet.getByLabelText("Word file (.docx)")).toHaveAccessibleDescription(/This is not a Word \(\.docx\) file\./);
    await user.upload(sheet.getByLabelText("Word file (.docx)"), new File(["x"], "fictional-old.doc", { type: "application/msword" }));
    expect(sheet.getByLabelText("Word file (.docx)")).toHaveAccessibleDescription(/This is an old \.doc file\..*save it as \.docx/);
    const big = docx("fictional-big.docx");
    Object.defineProperty(big, "size", { value: MAX_DOCX_BYTES + 1 });
    await user.upload(sheet.getByLabelText("Word file (.docx)"), big);
    expect(sheet.getByLabelText("Word file (.docx)")).toHaveAccessibleDescription(/This Word file is larger than 10 MB\./);
    await user.click(sheet.getByRole("button", { name: "Import" }));
    expect(presign).not.toHaveBeenCalled();
  });

  it("is not offered to a Viewer or a Photo Editor, and a Reporter imports without an edition", async () => {
    const viewer = renderAuth("/org/org-demo-konkan/pub/pub-demo-ratnagiri-tide/stories", { preset: "konkan-reviewer" });
    await screen.findByRole("heading", { level: 1, name: "Stories" });
    await waitFor(() => expect(screen.queryByText("Loading the stories…")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Import Word file" })).not.toBeInTheDocument();
    viewer.unmount();
    const photo = renderAuth(STORIES, { preset: "sahyadri-photo-editor" });
    await screen.findByRole("table");
    expect(screen.queryByRole("button", { name: "Import Word file" })).not.toBeInTheDocument();
    photo.unmount();
    const { sheet } = await openDrawer({ preset: "sahyadri-reporter" });
    expect(sheet.queryByRole("combobox", { name: "Edition" })).not.toBeInTheDocument();
  });

  it("has no serious axe violations while picking, refused and done", async () => {
    const environment = createMockApplicationEnvironment();
    const { user, sheet, container } = await openDrawer({ environment });
    expect(await seriousViolations(container)).toEqual([]);
    await user.click(sheet.getByRole("button", { name: "Import" }));
    expect(await seriousViolations(container)).toEqual([]);
    await user.upload(sheet.getByLabelText("Word file (.docx)"), docx());
    await user.click(sheet.getByRole("button", { name: "Import" }));
    await sheet.findByText("Reading the file…");
    expect(await seriousViolations(container)).toEqual([]);
    await act(() => environment.sessionController.finishImport("import-001"));
    await sheet.findByText("Done. Stories made: 2. Skipped: 0.");
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("speaks Marathi", async () => {
    renderAuth(STORIES, { preset: "sahyadri-editor", language: "mr" });
    await screen.findByRole("table");
    await userEvent.setup().click(screen.getByRole("button", { name: "Word फाइल आयात करा" }));
    const sheet = within(await screen.findByRole("dialog", { name: "Word फाइल आयात करा" }));
    expect(sheet.getByLabelText("Word फाइल (.docx)")).toBeInTheDocument();
    expect(sheet.getByRole("button", { name: "आयात करा" })).toBeInTheDocument();
  });
});
