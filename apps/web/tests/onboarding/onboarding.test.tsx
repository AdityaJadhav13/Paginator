/**
 * Onboard a new paper (L4; packages/contracts onboard.ts) on the test double with fictional files: the step on the
 * engine profile and Templates screens for settings.edit (prominent without a ready profile), the limits checked before
 * anything is sent, the permission required, each file's progress, the job's step heard live and fetched while it
 * works, cancel, what we read, "Use this design", the test layout, each check and refusal code in English and Marathi,
 * and axe in each state.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { FILE_CHECK_CODES, ONBOARD_REJECT_CODES } from "@pageinator/contracts";
import { act, screen, within } from "../../src/test/render.tsx";
import { createMockApplicationEnvironment, type MockApplicationEnvironment } from "../../src/mocks/index.ts";
import { checkNote, refusedFile, rejectText } from "../../src/features/onboarding/OnboardingPanel.tsx";
import { translator } from "../../src/i18n/index.ts";
import { currentLocation, renderAuth, resetBrowserState, seriousViolations } from "../auth/helpers.tsx";

vi.setConfig({ testTimeout: 30_000 });

const ORG = "org-demo-sahyadri";
const PUB = "pub-demo-pune-daily";
const PROFILE = `/org/${ORG}/pub/${PUB}/engine-profile`;
const TEMPLATES = `/org/${ORG}/pub/${PUB}/templates`;

afterEach(() => {
  resetBrowserState();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const pdf = (name: string, size?: number) => {
  const file = new File(["%PDF-1.7 fictional"], name, { type: "application/pdf" });
  if (size !== undefined) Object.defineProperty(file, "size", { value: size });
  return file;
};
const editions = (count: number) =>
  Array.from({ length: count }, (_, i) => pdf(`Fictional Times 2026-09-${String(i + 1).padStart(2, "0")}.pdf`));

/** The publication without a ready engine profile: the step is the screen's main thing. */
function withoutProfile(): MockApplicationEnvironment {
  const environment = createMockApplicationEnvironment();
  vi.spyOn(environment.layout, "listProfiles").mockResolvedValue({ ok: true, value: { items: [], inUse: null } });
  return environment;
}

async function startWith(environment: MockApplicationEnvironment, files: File[]) {
  const user = userEvent.setup();
  const panel = within(await screen.findByRole("region", { name: "Set up your paper's design" }));
  await user.upload(panel.getByLabelText("Past edition PDFs"), files);
  await user.click(
    panel.getByLabelText("We own these pages and allow Pageinator to read them to learn our paper's design."),
  );
  await user.click(panel.getByRole("button", { name: "Upload and learn the design" }));
  await panel.findByText("Waiting for the design reader to start…");
  const got = await environment.layout.getOnboarding({ orgId: ORG, pubId: PUB });
  return { user, panel, id: got.ok ? got.value.current!.id : "" };
}

describe("Set up your paper's design", () => {
  it("uploads past editions with the permission, shows the job's step live, what we read, then uses it", async () => {
    const environment = withoutProfile();
    const { container } = renderAuth(PROFILE, { preset: "sahyadri-chief-editor", environment });
    const panel = within(await screen.findByRole("region", { name: "Set up your paper's design" }));
    expect(panel.getByText(/Best: 12 to 20 whole editions from at least 3 weeks/)).toBeInTheDocument();
    expect(await seriousViolations(container)).toEqual([]);

    const presign = vi.spyOn(environment.media, "presign");
    const start = vi.spyOn(environment.layout, "startOnboarding");
    const { user, id } = await startWith(environment, editions(3));
    expect(presign).toHaveBeenCalledTimes(3);
    expect(presign).toHaveBeenCalledWith(expect.objectContaining({ purpose: "onboard_pdf", contentType: "application/pdf" }));
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ uploadIds: ["upload-001", "upload-002", "upload-003"] }));
    expect(await seriousViolations(container)).toEqual([]);

    act(() => environment.sessionController.layout.onboardProgress(id, { step: "reading", done: 3, total: 14 }));
    const working = within(screen.getByRole("region", { name: "Set up your paper's design" }));
    expect(await working.findByText("Reading the pages: 3 of 14")).toBeInTheDocument();
    expect(working.getByRole("progressbar", { name: "Reading the pages: 3 of 14" })).toHaveAttribute("value", "3");
    expect(await seriousViolations(container)).toEqual([]);

    act(() => environment.sessionController.layout.onboardFinish(id));
    expect(await working.findByText("We have read your paper's design")).toBeInTheDocument();
    expect(working.getByText("14 editions, 112 pages. The oldest 9 taught us the design; the rest tested it.")).toBeInTheDocument();
    expect(working.getByText("330 × 520 mm")).toBeInTheDocument();
    expect(working.getByText(/8 columns of 38\.5 mm, gutter 4\.2 mm/)).toBeInTheDocument();
    expect(working.getByText(/We saw 2 different column grids and use the most common one\./)).toBeInTheDocument();
    expect(working.getByText("Devanagari (Marathi, Hindi …)")).toBeInTheDocument();
    expect(working.getByText("3% of the text frames could not be read and were left out.")).toBeInTheDocument();
    expect(working.getByText(/Front page: 14 · Page 2 \(with the imprint\): 14/)).toBeInTheDocument();
    const checks = within(working.getByRole("table", { name: "Each file's check" }));
    expect(checks.getAllByRole("row")).toHaveLength(4);
    expect(checks.getByText("Used, with a note")).toBeInTheDocument();
    expect(checks.getByText(/It was not made with InDesign/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/press-ready|PDF\/X-valid/i);
    expect(await seriousViolations(container)).toEqual([]);

    const adopt = vi.spyOn(environment.layout, "adoptOnboarding");
    await user.click(working.getByRole("button", { name: "Use this design" }));
    expect(adopt).toHaveBeenCalledWith(expect.objectContaining({ id }));
    expect(await working.findByText("Your paper's design is in use")).toBeInTheDocument();
    expect(working.getByRole("link", { name: "Go to the templates" })).toHaveAttribute("href", TEMPLATES);

    await user.click(working.getByRole("button", { name: "Make a test layout" }));
    expect(await screen.findByRole("heading", { level: 1, name: /Edition of/ })).toBeInTheDocument();
    expect(currentLocation(container).pathname).toBe(`/org/${ORG}/pub/${PUB}/editions/edition-demo-2026-10-24/layout`);
  });

  it("checks the limits before sending: PDFs only, 200 MB each, 3 to 40 files, and the permission", async () => {
    const environment = withoutProfile();
    renderAuth(PROFILE, { preset: "sahyadri-chief-editor", environment });
    const user = userEvent.setup({ applyAccept: false });
    const panel = within(await screen.findByRole("region", { name: "Set up your paper's design" }));
    const input = panel.getByLabelText("Past edition PDFs");
    const presign = vi.spyOn(environment.media, "presign");

    await user.upload(input, [new File(["x"], "notes.docx", { type: "application/msword" }), pdf("huge.pdf", 201 * 1024 ** 2)]);
    expect(await panel.findByText("notes.docx is not a PDF, so it was not added.")).toBeInTheDocument();
    expect(panel.getByText("huge.pdf is larger than 200 MB, so it was not added.")).toBeInTheDocument();

    await user.upload(input, editions(2));
    expect(panel.getByText("Editions chosen: 2 of at most 40")).toBeInTheDocument();
    await user.click(panel.getByRole("button", { name: "Upload and learn the design" }));
    expect(await panel.findByText("Choose at least 3 past editions.")).toBeInTheDocument();
    expect(panel.getByText("Tick the box to confirm the pages are yours to share.")).toBeInTheDocument();

    await user.upload(input, editions(3));
    expect(panel.getByText("Editions chosen: 3 of at most 40")).toBeInTheDocument();
    await user.click(panel.getByRole("button", { name: "Upload and learn the design" }));
    expect(panel.getByText("Tick the box to confirm the pages are yours to share.")).toBeInTheDocument();
    expect(presign).not.toHaveBeenCalled();

    await user.click(panel.getByRole("button", { name: "Remove Fictional Times 2026-09-03.pdf" }));
    expect(panel.getByText("Editions chosen: 2 of at most 40")).toBeInTheDocument();

    await user.upload(input, Array.from({ length: 41 }, (_, i) => pdf(`many-${i}.pdf`)));
    expect(panel.getByText("Editions chosen: 40 of at most 40")).toBeInTheDocument();
    expect(panel.getByText("At most 40 files. many-38.pdf and any after it were not added.")).toBeInTheDocument();
  });

  it("shows each file's progress while uploading, and stops; a retry goes on without sending a file again", async () => {
    const environment = withoutProfile();
    const { container } = renderAuth(PROFILE, { preset: "sahyadri-chief-editor", environment });
    const user = userEvent.setup();
    const panel = within(await screen.findByRole("region", { name: "Set up your paper's design" }));
    await user.upload(panel.getByLabelText("Past edition PDFs"), editions(3));
    await user.click(
      panel.getByLabelText("We own these pages and allow Pageinator to read them to learn our paper's design."),
    );
    const send = environment.media.send.bind(environment.media);
    let sends = 0;
    vi.spyOn(environment.media, "send").mockImplementation((input) => {
      sends += 1;
      if (sends !== 2) return send(input);
      input.onProgress?.(0.4);
      // the second file hangs until it is stopped
      return new Promise((resolve) =>
        input.signal?.addEventListener("abort", () =>
          resolve({ ok: false, error: { kind: "answer", status: 0, code: "upload_cancelled", message: "" } }),
        ),
      );
    });
    await user.click(panel.getByRole("button", { name: "Upload and learn the design" }));
    expect(
      await panel.findByRole("progressbar", { name: "Uploading Fictional Times 2026-09-02.pdf: 40%" }),
    ).toBeInTheDocument();
    expect(panel.getByText("Uploaded")).toBeInTheDocument();
    expect(panel.getAllByText("Waiting to upload")).toHaveLength(1);
    expect(await seriousViolations(container)).toEqual([]);
    await user.click(panel.getByRole("button", { name: "Stop uploading" }));
    expect(await panel.findByText(/Uploading stopped\./)).toBeInTheDocument();
    await user.click(panel.getByRole("button", { name: "Upload and learn the design" }));
    expect(await panel.findByText("Waiting for the design reader to start…")).toBeInTheDocument();
    expect(sends).toBe(4); // the first file was not sent again
  });

  it("takes dropped files too", async () => {
    renderAuth(PROFILE, { preset: "sahyadri-chief-editor", environment: withoutProfile() });
    const panel = within(await screen.findByRole("region", { name: "Set up your paper's design" }));
    const zone = panel.getByText("Drag the PDFs here, or choose them below.").parentElement!;
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.drop(zone, { dataTransfer: { files: editions(3) } });
    expect(await panel.findByText("Editions chosen: 3 of at most 40")).toBeInTheDocument();
  });

  it("cancels the job, and fetches it every 3 s while it works", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const environment = withoutProfile();
    renderAuth(PROFILE, { preset: "sahyadri-chief-editor", environment });
    const { user, panel } = await startWith(environment, editions(3));
    const fetches = vi.spyOn(environment.layout, "getOnboarding");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    expect(fetches).toHaveBeenCalled();
    await user.click(panel.getByRole("button", { name: "Cancel" }));
    expect(await panel.findByText("The last attempt was cancelled.")).toBeInTheDocument();
    expect(panel.getByLabelText("Past edition PDFs")).toBeInTheDocument();
  });

  it("says why the set made no design and each file's check, plainly; then lets them try again", async () => {
    const environment = withoutProfile();
    const { container } = renderAuth(PROFILE, { preset: "sahyadri-chief-editor", environment });
    const { user, panel, id } = await startWith(environment, editions(3));
    act(() =>
      environment.sessionController.layout.onboardFinish(id, {
        state: "rejected",
        code: "onboard.too_many_excluded",
        files: [
          { n: 1, status: "refused", date: null, pages: 8, notes: [{ code: "onboard.scanned", count: null }] },
          { n: 2, status: "refused", date: "2026-09-02", pages: 8, notes: [{ code: "onboard.no_unicode", count: null }] },
          { n: 3, status: "warning", date: "2026-09-03", pages: 8, notes: [{ code: "onboard.frames_excluded", count: 7 }] },
        ],
      }),
    );
    expect(await panel.findByText("We could not learn your paper's design from these files")).toBeInTheDocument();
    expect(panel.getByText(/A person from Pageinator will look at it and contact you\./)).toBeInTheDocument();
    expect(panel.getAllByText("Left out")).toHaveLength(2);
    expect(panel.getByText("Not found")).toBeInTheDocument();
    expect(panel.getByText(/Tell us your font names; we will check them\./)).toBeInTheDocument();
    expect(panel.getByText("Text frames that could not be read, left out: 7.")).toBeInTheDocument();
    expect(await seriousViolations(container)).toEqual([]);
    await user.click(panel.getByRole("button", { name: "Try again with other files" }));
    expect(panel.getByLabelText("Past edition PDFs")).toBeInTheDocument();
  });

  it("says a worker failure in general words", async () => {
    const environment = withoutProfile();
    renderAuth(PROFILE, { preset: "sahyadri-chief-editor", environment });
    const { panel, id } = await startWith(environment, editions(3));
    act(() => environment.sessionController.layout.onboardFinish(id, { state: "failed", code: "worker.timeout" }));
    expect(await panel.findByText("Something went wrong while reading your editions")).toBeInTheDocument();
    expect(panel.getByText(/The design reader stopped unexpectedly\./)).toBeInTheDocument();
  });

  it("is a quieter step once a profile is ready, on Templates and the engine profile", async () => {
    const { container } = renderAuth(TEMPLATES, { preset: "sahyadri-chief-editor" });
    const user = userEvent.setup();
    const panel = within(await screen.findByRole("region", { name: "Learn the design again from past editions" }));
    expect(panel.queryByLabelText("Past edition PDFs")).not.toBeInTheDocument();
    await user.click(panel.getByRole("button", { name: "Choose past editions" }));
    expect(panel.getByLabelText("Past edition PDFs")).toBeInTheDocument();
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("is on the engine profile screen too, quietly, with a profile in use", async () => {
    renderAuth(PROFILE, { preset: "sahyadri-chief-editor" });
    expect(await screen.findByRole("region", { name: "Learn the design again from past editions" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Set up your paper's design" })).not.toBeInTheDocument();
  });

  it("is not offered without settings.edit", async () => {
    renderAuth(PROFILE, { preset: "sahyadri-reporter" });
    expect(await screen.findByRole("heading", { level: 1, name: "Engine profile" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Learn the design again|Set up your paper's design/ })).not.toBeInTheDocument();
  });

  it("reads in Marathi", async () => {
    renderAuth(PROFILE, { preset: "sahyadri-chief-editor", language: "mr", environment: withoutProfile() });
    const panel = within(await screen.findByRole("region", { name: "तुमच्या वृत्तपत्राची रचना तयार करा" }));
    expect(panel.getByLabelText("जुन्या अंकांच्या PDF")).toBeInTheDocument();
    expect(panel.getByRole("button", { name: "अपलोड करा आणि रचना शिका" })).toBeInTheDocument();
  });
});

describe("Each code in plain words", () => {
  const en = translator("en");
  const mr = translator("mr");

  it("says every file check in English and Marathi, each its own", () => {
    for (const t of [en, mr]) {
      const said = FILE_CHECK_CODES.map((code) => checkNote({ code, count: 4 }, t));
      expect(new Set(said).size).toBe(FILE_CHECK_CODES.length);
      for (const text of said) expect(text).not.toMatch(/[{}]|onboard\./);
    }
    expect(checkNote({ code: "onboard.frames_excluded", count: 4 }, mr)).toContain("4");
    expect(checkNote({ code: "onboard.no_unicode", count: null }, en)).toMatch(/Tell us your font names/);
  });

  it("says every refusal of the set in English and Marathi, and a worker failure in general words", () => {
    for (const t of [en, mr]) {
      const said = ONBOARD_REJECT_CODES.map((code) =>
        rejectText({ code, params: code === "onboard.no_template" ? { role: "back" } : null, message: "x" }, t),
      );
      expect(new Set(said).size).toBe(ONBOARD_REJECT_CODES.length);
      for (const text of said) expect(text).not.toMatch(/[{}]|onboard\./);
      expect(rejectText({ code: "worker.crashed", params: null, message: "x" }, t)).toBe(t("onboarding.reject.worker"));
    }
    expect(rejectText({ code: "onboard.no_template", params: { role: "back" }, message: "x" }, en)).toBe(
      "We found no page to use as the back page. Include whole editions, with every page.",
    );
    expect(rejectText({ code: "onboard.too_many_excluded", params: null, message: "x" }, mr)).toMatch(/Pageinator मधील एक व्यक्ती/);
  });

  it("names the file a start refused (body.uploadIds.<i>), and leaves other refusals to the general message", () => {
    const chosen = ["a.pdf", "b.pdf", "c.pdf"].map((name) => ({ file: new File(["%PDF-"], name) }));
    const answer = (field: string) =>
      ({ kind: "answer", status: 400, code: "invalid_request", message: "", details: [{ field, message: "x" }] }) as const;
    expect(refusedFile(answer("body.uploadIds.1"), chosen)).toBe("b.pdf");
    expect(refusedFile(answer("body.permission"), chosen)).toBeNull();
    expect(refusedFile({ kind: "network" }, chosen)).toBeNull();
  });
});
