/**
 * The release (plan §1 L2.5), on the test double with fictional data: the Release tab's preflight list in words, the
 * pages' approval (Approve with the revision and SHA-256 shown, Unlock, 409 approval_stale), the G2 press test (the
 * warning, the evidence, the form), "Approve release" posting exactly the files shown (disabled while a check fails;
 * 409 approval_stale, release_refused, 502 archive_failed), a correction, the releases with their downloads, "Mark as
 * sent", the press's confirmation (409 already_confirmed) and the archive check; approval on the Pages board; what each
 * role sees; the live refresh; axe in English and Marathi. Never "press-ready" or "PDF/X-valid".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { act, render, screen, waitFor, within } from "../../src/test/render.tsx";
import { createMockApplicationEnvironment } from "../../src/mocks/index.ts";
import type { ApiProblem, EditionReleaseDto, OrgAccessDto, ReleaseItemDto } from "../../src/services/index.ts";
import { I18nProvider } from "../../src/i18n/I18nProvider.tsx";
import { layoutAccess, type LayoutAccess } from "../../src/features/layout/access.ts";
import { ReleaseProvider } from "../../src/features/release/release-context.tsx";
import { ReleaseTab } from "../../src/features/release/ReleaseTab.tsx";
import { renderAuth, resetBrowserState, seriousViolations } from "../auth/helpers.tsx";

vi.setConfig({ testTimeout: 30_000 });

const ORG = "org-demo-sahyadri";
const PUB = "pub-demo-pune-daily";
const B = "edition-demo-2026-10-24";
const RUN = "run-demo-001";
const TAB = (tab = "release") => `/org/${ORG}/pub/${PUB}/editions/${B}/layout?tab=${tab}`;
const SHA = (page: number) => String(page).padStart(2, "0").repeat(32);
const PERSON = { id: "01900000-0000-7000-8000-000000000001", name: "Fictional Chief" };
const AT = "2026-10-24T10:00:00.000+05:30";

let saved: { href: string; download: string }[] = [];
beforeEach(() => {
  saved = [];
  URL.createObjectURL = vi.fn(() => "blob:fictional");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ href: this.href, download: this.download });
  });
});
afterEach(() => {
  resetBrowserState();
  vi.restoreAllMocks();
});

const answer = (status: number, code: string, extra: Partial<Extract<ApiProblem, { kind: "answer" }>> = {}) => ({
  ok: false as const,
  error: { kind: "answer" as const, status, code, message: code, ...extra },
});

const file = (page: number, version = 1) => ({
  page,
  name: `2026-10-24_P0${page}${version > 1 ? `_v${version}` : ""}.pdf`,
  rev: 0,
  sha256: SHA(page),
  bytes: 1_234_567,
  replaces: version > 1 ? `2026-10-24_P0${page}.pdf` : null,
});

const released = (number: number, kind: "release" | "correction", files: ReleaseItemDto["files"]): ReleaseItemDto => ({
  id: `01900000-0000-7000-8000-00000000010${number}`,
  editionId: B,
  runId: RUN,
  number,
  kind,
  approvedBy: PERSON,
  approvedAt: AT,
  note: null,
  files,
  archive: { verifiedAt: AT, retainUntil: "2033-10-24T10:00:00.000+05:30", manifestSha256: "a".repeat(64) },
  deliveries: [],
  printProfile: null,
});

/** A fictional edition whose every check passed: two approved pages, ready to release. */
function ready(overrides: Partial<EditionReleaseDto> = {}): EditionReleaseDto {
  const page = (n: number) => ({
    runId: RUN,
    page: n,
    role: n === 1 ? "front" : "back",
    rev: 0,
    pdfSha256: SHA(n),
    check: { passed: true, fails: 0, warnings: 2 },
    needsSave: false,
    approval: { by: PERSON, at: AT, rev: 0, pdfSha256: SHA(n) },
    released: null,
  });
  return {
    editionId: B,
    runId: RUN,
    preflight: {
      passed: true,
      items: (["laid_out", "pdf_check", "saved", "approved", "press_test"] as const).map((check) => ({
        check,
        state: "passed" as const,
        pages: [],
        slots: [],
        printsOld: false,
        stories: [],
      })),
    },
    pages: [page(1), page(2)],
    candidate: { kind: "release", runId: RUN, files: [file(1), file(2)] },
    releases: [],
    needsPressTest: true,
    pressTest: {
      pageSha256: "b".repeat(64),
      acceptedOn: "2026-10-20",
      note: "Fictional test sheet",
      recordedBy: PERSON,
      recordedAt: AT,
    },
    ...overrides,
  };
}

function withView(view: EditionReleaseDto) {
  const environment = createMockApplicationEnvironment();
  const get = vi.spyOn(environment.release, "get").mockResolvedValue({ ok: true, value: view });
  return { environment, get };
}

const region = (name: string | RegExp) => within(screen.getByRole("region", { name }));

/** "Approve release" asks first: it cannot be undone. */
async function approveRelease(user: ReturnType<typeof userEvent.setup>, name = "Approve release") {
  await user.click(await screen.findByRole("button", { name }));
  const dialog = within(await screen.findByRole("dialog"));
  await user.click(dialog.getByRole("button", { name }));
}

describe("the Release tab on the double", () => {
  it("lists only the real checks in words, the pages, the press test and why the release waits; axe clean", async () => {
    const { container } = renderAuth(TAB(), { preset: "sahyadri-chief-editor" });
    expect(await screen.findByRole("tab", { name: "Release" })).toHaveAttribute("aria-selected", "true");
    const checks = region("Checks before release");
    expect(
      await checks.findByText("The release waits until every failed check below is put right."),
    ).toBeInTheDocument();
    const rows = checks.getAllByRole("listitem").filter((li) => li.parentElement?.className === "pg-release__checks");
    expect(rows.map((li) => li.querySelector(".pg-layout__status")?.textContent)).toEqual([
      "FailedEvery page is laid out",
      "FailedEvery page passed the independent PDF/X-1a check",
      "PassedEvery page is saved and prints the edition's newest text",
      "PassedNo story is on two pages, overlaps another or runs off its page",
      "PassedThe issue number is set",
      "FailedEvery back-page ad space has its image",
      "FailedEvery page is approved",
      "FailedThe press test is on record",
      "WarningReady stories the layout left out",
    ]);
    // the pages a check names reach the editor; the ad spaces the Ads tab
    const pdf = within(rows[1]!);
    expect(pdf.getByRole("link", { name: "Edit page 3" })).toHaveAttribute(
      "href",
      `/org/${ORG}/pub/${PUB}/editions/${B}/runs/${RUN}/pages/3/edit`,
    );
    expect(within(rows[5]!).getByText("Ad spaces without an image: back-1, back-2")).toBeInTheDocument();
    expect(within(rows[8]!).getByText("Fictional brief left over")).toBeInTheDocument();

    const pages = within(screen.getByRole("table", { name: "Pages and approval" }));
    const front = pages.getByRole("row", { name: /^Page 1 · Front page/ });
    expect(within(front).getByText("Independent PDF/X-1a check: passed (2 warnings)")).toBeInTheDocument();
    expect(within(front).getByText("Not approved")).toBeInTheDocument();
    const six = pages.getByRole("row", { name: /^Page 6/ });
    expect(within(six).getByText("It has no PDF yet, so it cannot be approved.")).toBeInTheDocument();
    expect(within(six).getByRole("button", { name: "Approve page 6" })).toBeDisabled();

    const press = region("Press test");
    expect(press.getByText("Pages with photos or ads have not been press-tested")).toBeInTheDocument();
    expect(press.getByText("No press test is on record.")).toBeInTheDocument();

    const release = region("Release");
    expect(release.getByText("The release waits until every check above passes.")).toBeInTheDocument();
    expect(release.getByRole("button", { name: "Approve release" })).toBeDisabled();
    expect(region("Releases").getByText("No release yet.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/press-ready|PDF\/X-valid/i);
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("speaks Marathi and is axe clean there too", async () => {
    const { container } = renderAuth(TAB(), { preset: "sahyadri-chief-editor", language: "mr" });
    expect(await screen.findByRole("tab", { name: "प्रकाशित आवृत्ती" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("प्रत्येक पान मंजूर आहे")).toBeInTheDocument();
    expect(screen.getAllByText("अनुत्तीर्ण").length).toBeGreaterThan(0);
    expect(screen.getByText("छायाचित्रे किंवा जाहिराती असलेली पाने छापखान्यात तपासलेली नाहीत")).toBeInTheDocument();
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("approves a page with the revision and SHA-256 it shows, and a Chief Editor unlocks it", async () => {
    const environment = createMockApplicationEnvironment();
    const approve = vi.spyOn(environment.release, "approvePage");
    renderAuth(TAB(), { preset: "sahyadri-chief-editor", environment });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Approve page 1" }));
    expect(approve).toHaveBeenCalledWith({ orgId: ORG, pubId: PUB, runId: RUN, page: 1, rev: 0, pdfSha256: SHA(1) });
    const front = within(screen.getByRole("row", { name: /^Page 1 · Front page/ }));
    expect(await front.findByText(/^Approved by Sahyadri Demo Chief Editor, /)).toBeInTheDocument();
    await user.click(front.getByRole("button", { name: "Unlock page 1" }));
    expect(await front.findByText("Not approved")).toBeInTheDocument();
  });

  it("says the page changed when the approval is stale, and shows it as it is now", async () => {
    const environment = createMockApplicationEnvironment();
    vi.spyOn(environment.release, "approvePage").mockResolvedValue(answer(409, "approval_stale"));
    const get = vi.spyOn(environment.release, "get");
    renderAuth(TAB(), { preset: "sahyadri-editor", environment });
    await userEvent.click(await screen.findByRole("button", { name: "Approve page 2" }));
    expect(await screen.findByText(/^The page changed since you looked, so it was not approved\./)).toBeInTheDocument();
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("is fetched again on the edition's live layout hint", async () => {
    const { environment } = renderAuth(TAB(), { preset: "sahyadri-editor" });
    const get = vi.spyOn(environment.release, "get");
    await screen.findByRole("region", { name: "Checks before release" });
    act(() => environment.liveController.emit(ORG, { type: "layout", publicationId: PUB, editionId: B, runId: RUN }));
    await waitFor(() => expect(get).toHaveBeenCalled());
  });

  it("says when the release cannot be fetched, and fetches it again", async () => {
    const environment = createMockApplicationEnvironment();
    const get = vi.spyOn(environment.release, "get").mockResolvedValueOnce({ ok: false, error: { kind: "network" } });
    renderAuth(TAB(), { preset: "sahyadri-editor", environment });
    expect(await screen.findByText("Pageinator cannot be reached")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("region", { name: "Checks before release" })).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("records the press test (settings.edit), refusing a malformed SHA-256, and shows the evidence", async () => {
    renderAuth(TAB(), { preset: "sahyadri-chief-editor" });
    const user = userEvent.setup();
    const press = within(await screen.findByRole("region", { name: "Press test" }));
    await user.type(press.getByLabelText("SHA-256 of the test page's PDF"), "not a hash");
    await user.click(press.getByRole("button", { name: "Save the press test" }));
    expect(press.getByText("Enter the SHA-256 as 64 characters, 0-9 and a-f.")).toBeInTheDocument();
    expect(press.getByText("Enter the day the press accepted it.")).toBeInTheDocument();
    await user.clear(press.getByLabelText("SHA-256 of the test page's PDF"));
    await user.type(press.getByLabelText("SHA-256 of the test page's PDF"), "C".repeat(64));
    await user.type(press.getByLabelText("Accepted by the press on"), "2026-10-20");
    await user.type(press.getByLabelText("Note (optional)"), "Fictional sheet");
    await user.click(press.getByRole("button", { name: "Save the press test" }));
    expect(await press.findByText("c".repeat(64))).toBeInTheDocument();
    expect(press.getByText("Fictional sheet")).toBeInTheDocument();
    expect(press.getByText(/^Recorded by Sahyadri Demo Chief Editor, /)).toBeInTheDocument();
    const checks = within(screen.getByRole("region", { name: "Checks before release" }));
    expect(within(checks.getByText("The press test is on record").parentElement!).getByText("Passed")).toBeTruthy();
  });
});

describe("the folio", () => {
  const folioFailed = () =>
    ready({
      preflight: {
        passed: false,
        items: [{ check: "folio", state: "failed", pages: [1], slots: [], printsOld: false, stories: [] }],
      },
    });

  it("sets the issue number from the failed folio check (edition.edit), not by editing page 1", async () => {
    const { environment, get } = withView(folioFailed());
    const update = vi.spyOn(environment.editions, "update");
    renderAuth(TAB(), { preset: "sahyadri-chief-editor", environment });
    const user = userEvent.setup();
    const checks = within(await screen.findByRole("region", { name: "Checks before release" }));
    const issue = await checks.findByLabelText("Issue number");
    expect(checks.queryByRole("link", { name: "Edit page 1" })).not.toBeInTheDocument();
    expect(issue).toHaveValue("302");
    await user.clear(issue);
    await user.type(issue, "303");
    await user.click(checks.getByRole("button", { name: "Save" }));
    expect(update).toHaveBeenCalledWith({
      orgId: ORG,
      pubId: PUB,
      editionId: B,
      patch: { volume: "12", issue: "303", price: "₹5" },
    });
    expect(await checks.findByText("Saved. The checks are run again.")).toBeInTheDocument();
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("sends to page 1 when page 1 prints an older folio than the edition has", async () => {
    const { environment } = withView(
      ready({
        preflight: {
          passed: false,
          items: [{ check: "folio", state: "failed", pages: [1], slots: [], printsOld: true, stories: [] }],
        },
      }),
    );
    renderAuth(TAB(), { preset: "sahyadri-chief-editor", environment });
    const checks = within(await screen.findByRole("region", { name: "Checks before release" }));
    expect(
      await checks.findByText(
        "Page 1 prints an older volume, issue number or price: lay out again, or update the text on page 1 and save it.",
      ),
    ).toBeInTheDocument();
    expect(checks.getByRole("link", { name: "Edit page 1" })).toBeInTheDocument();
  });

  it("asks someone else to set it when the person cannot edit the edition", async () => {
    const { environment } = withView(folioFailed());
    renderAuth(TAB(), { preset: "sahyadri-subeditor", environment });
    const checks = within(await screen.findByRole("region", { name: "Checks before release" }));
    expect(
      await checks.findByText("Ask an Editor or a Chief Editor to set the issue number of this edition."),
    ).toBeInTheDocument();
    expect(checks.queryByLabelText("Issue number")).not.toBeInTheDocument();
  });
});

describe("approving the release", () => {
  it("posts exactly the files it shows, with their SHA-256 and an Idempotency-Key", async () => {
    const { environment } = withView(ready());
    const create = vi
      .spyOn(environment.release, "create")
      .mockResolvedValue({ ok: true, value: released(1, "release", [file(1), file(2)]) });
    const { container } = renderAuth(TAB(), { preset: "sahyadri-chief-editor", environment });
    const user = userEvent.setup();
    const release = within(await screen.findByRole("region", { name: "Release" }));
    expect(release.getByText(/^Approving the release keeps these 2 files in the archive/)).toBeInTheDocument();
    const files = within(release.getByRole("table", { name: "The files to release" }));
    expect(files.getByRole("row", { name: new RegExp(`^2026-10-24_P01.pdf 0 ${SHA(1)} 1,234,567$`) })).toBeTruthy();
    // the G2 evidence on record
    const press = region("Press test");
    expect(press.getByText("b".repeat(64))).toBeInTheDocument();
    expect(press.getByText("Fictional test sheet")).toBeInTheDocument();
    expect(press.queryByText("Pages with photos or ads have not been press-tested")).not.toBeInTheDocument();
    expect(await seriousViolations(container)).toEqual([]);

    await user.type(release.getByLabelText("Note (optional)"), "Fictional night note");
    // it asks first, restating what is approved; Cancel posts nothing
    await user.click(release.getByRole("button", { name: "Approve release" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Approve this release?" }));
    expect(
      dialog.getByText(
        "You approve the release of these 2 files. They are kept in the archive, locked, exactly as checked. This cannot be undone.",
      ),
    ).toBeTruthy();
    await user.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(create).not.toHaveBeenCalled();
    await approveRelease(user);
    expect(create).toHaveBeenCalledWith({
      orgId: ORG,
      pubId: PUB,
      editionId: B,
      files: [
        { page: 1, sha256: SHA(1) },
        { page: 2, sha256: SHA(2) },
      ],
      note: "Fictional night note",
      idempotencyKey: expect.any(String),
    });
  });

  it("refetches and says the files changed on 409 approval_stale", async () => {
    const { environment, get } = withView(ready());
    vi.spyOn(environment.release, "create").mockResolvedValue(answer(409, "approval_stale", { current: null }));
    renderAuth(TAB(), { preset: "sahyadri-chief-editor", environment });
    await approveRelease(userEvent.setup());
    expect(await screen.findByText(/^The files changed since you looked, so nothing was released\./)).toBeTruthy();
    expect(get).toHaveBeenCalledTimes(2);
  });

  const refusal = answer(409, "release_refused", {
    details: [
      { field: "preflight.approved", message: "Not passed on pages 2." },
      { field: "nothing_to_release", message: "No page changed since the last release." },
      { field: "preflight.unknown_check", message: "Not passed." },
    ],
  });
  /** The view after the refusal: page 2 lost its approval meanwhile. */
  const afterRefusal = () =>
    ready({
      preflight: {
        passed: true,
        items: [{ check: "approved", state: "failed", pages: [2], slots: [], printsOld: false, stories: [] }],
      },
    });

  it("says why on 409 release_refused, each reason in the reader's words, inside the alert", async () => {
    const { environment } = withView(afterRefusal());
    vi.spyOn(environment.release, "create").mockResolvedValue(refusal);
    renderAuth(TAB(), { preset: "sahyadri-chief-editor", environment });
    await approveRelease(userEvent.setup());
    const alert = within(await screen.findByRole("alert"));
    expect(alert.getByText("This edition cannot be released yet: see the checks that failed.")).toBeTruthy();
    const why = within(alert.getByRole("list", { name: "Why it was refused" }));
    expect(why.getAllByRole("listitem").map((li) => [li.textContent, li.getAttribute("lang")])).toEqual([
      ["Every page is approved: pages 2", null],
      ["Nothing changed since the last release.", null],
      // a check this screen does not know keeps the API's English
      ["Not passed.", "en"],
    ]);
  });

  it("says why on 409 release_refused in Marathi", async () => {
    const { environment } = withView(afterRefusal());
    vi.spyOn(environment.release, "create").mockResolvedValue(refusal);
    renderAuth(TAB(), { preset: "sahyadri-chief-editor", environment, language: "mr" });
    await approveRelease(userEvent.setup(), "प्रकाशित आवृत्ती मंजूर करा");
    const why = within(await screen.findByRole("list", { name: "नाकारण्याचे कारण" }));
    expect(why.getByText("प्रत्येक पान मंजूर आहे: पाने 2")).toBeTruthy();
    expect(why.getByText("मागील प्रकाशित आवृत्तीनंतर काहीही बदलले नाही.")).toBeTruthy();
  });

  it("says in plain words that nothing was released on 502 archive_failed, and uses a new key next time", async () => {
    const { environment } = withView(ready());
    const create = vi.spyOn(environment.release, "create").mockResolvedValue(answer(502, "archive_failed"));
    renderAuth(TAB(), { preset: "sahyadri-chief-editor", environment });
    const user = userEvent.setup();
    await approveRelease(user);
    expect(
      await screen.findByText(
        "The files could not be kept in the archive, so nothing was released. Try again in a few minutes.",
      ),
    ).toBeTruthy();
    // archive_failed: nothing was made, so the next try is a new request
    await approveRelease(user);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[0]![0].idempotencyKey).not.toBe(create.mock.calls[1]![0].idempotencyKey);
  });

  it("keeps the Idempotency-Key when no answer came", async () => {
    const { environment } = withView(ready());
    const create = vi.spyOn(environment.release, "create").mockResolvedValue({ ok: false, error: { kind: "network" } });
    renderAuth(TAB(), { preset: "sahyadri-chief-editor", environment });
    const user = userEvent.setup();
    await approveRelease(user);
    await screen.findByText("Pageinator cannot be reached");
    await approveRelease(user);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[0]![0].idempotencyKey).toBe(create.mock.calls[1]![0].idempotencyKey);
    // a changed note is a new request, so a new key
    await user.type(region("Release").getByLabelText("Note (optional)"), "Fictional");
    await approveRelease(user);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(3));
    expect(create.mock.calls[2]![0].idempotencyKey).not.toBe(create.mock.calls[1]![0].idempotencyKey);
  });

  it("shows a correction replacing the earlier file, and keeps the earlier release and its receipts", async () => {
    const first = {
      ...released(1, "release", [file(1), file(2)]),
      deliveries: [
        {
          id: "01900000-0000-7000-8000-000000000201",
          method: "download" as const,
          sentBy: PERSON,
          sentAt: AT,
          note: null,
          files: [{ name: "2026-10-24_P01.pdf", sha256: SHA(1), bytes: 1_234_567 }],
          confirmation: { pressPerson: "Fictional Press Manager", at: AT, note: null, recordedBy: PERSON },
        },
      ],
    };
    const fixed = { ...file(1, 2), sha256: "e".repeat(64) };
    const { environment } = withView(
      ready({ candidate: { kind: "correction", runId: RUN, files: [fixed] }, releases: [first] }),
    );
    renderAuth(TAB(), { preset: "sahyadri-chief-editor", environment });
    const release = within(await screen.findByRole("region", { name: "Release" }));
    expect(release.getByText("Replaces 2026-10-24_P01.pdf")).toBeInTheDocument();
    // one file: the singular
    expect(
      release.getByText(
        "A correction: the page changed since the last release replaces its earlier file. The earlier release stays on record.",
      ),
    ).toBeInTheDocument();
    expect(release.getByRole("button", { name: "Approve correction" })).toBeEnabled();
    const old = region("Release 1");
    expect(
      old.getByText(
        "Confirmed by Fictional Press Manager at the press, 24 Oct 2026, 10:00 am (recorded by Fictional Chief).",
      ),
    ).toBeTruthy();
    expect(old.queryByRole("button", { name: "Record the press's confirmation" })).not.toBeInTheDocument();
  });
});

describe("the releases", () => {
  const sentOne = (): ReleaseItemDto => ({
    ...released(1, "release", [file(1), file(2)]),
    deliveries: [
      {
        id: "01900000-0000-7000-8000-000000000201",
        method: "download",
        sentBy: PERSON,
        sentAt: AT,
        note: "Fictional mail",
        files: [{ name: "2026-10-24_P01.pdf", sha256: SHA(1), bytes: 1_234_567 }],
        confirmation: null,
      },
    ],
  });

  it("downloads a released file by its 5-minute link, newest release first", async () => {
    const { environment } = withView(
      ready({
        candidate: null,
        releases: [released(2, "correction", [file(1, 2)]), released(1, "release", [file(1), file(2)])],
      }),
    );
    renderAuth(TAB(), { preset: "sahyadri-chief-editor", environment });
    await screen.findByRole("region", { name: "Correction 2" });
    const titles = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(titles.indexOf("Correction 2")).toBeLessThan(titles.indexOf("Release 1"));
    expect(screen.getByText("Nothing changed since the last release.")).toBeInTheDocument();
    const link = vi.spyOn(environment.release, "fileLink").mockResolvedValue({
      ok: true,
      value: { url: "https://store.example/fictional", expiresAt: AT },
    });
    await userEvent.click(region("Release 1").getByRole("button", { name: "Download 2026-10-24_P02.pdf" }));
    await waitFor(() =>
      expect(saved).toEqual([{ href: "https://store.example/fictional", download: "2026-10-24_P02.pdf" }]),
    );
    expect(link).toHaveBeenCalledWith({
      orgId: ORG,
      pubId: PUB,
      releaseId: released(1, "release", []).id,
      name: "2026-10-24_P02.pdf",
    });
  });

  it("marks a release as sent with a note, and lists the receipt", async () => {
    const environment = createMockApplicationEnvironment();
    const view = ready({ candidate: null, releases: [released(1, "release", [file(1)])] });
    const get = vi.spyOn(environment.release, "get").mockResolvedValue({ ok: true, value: view });
    const send = vi.spyOn(environment.release, "markSent").mockImplementation(async () => {
      get.mockResolvedValue({ ok: true, value: { ...view, releases: [sentOne()] } });
      return { ok: true, value: sentOne() };
    });
    renderAuth(TAB(), { preset: "sahyadri-chief-editor", environment });
    const user = userEvent.setup();
    const one = within(await screen.findByRole("region", { name: "Release 1" }));
    await user.type(one.getByLabelText("Note on the sending (optional)"), "Fictional mail");
    await user.click(one.getByRole("button", { name: "Mark as sent" }));
    expect(send).toHaveBeenCalledWith({
      orgId: ORG,
      pubId: PUB,
      releaseId: view.releases[0]!.id,
      note: "Fictional mail",
    });
    expect(await one.findByText("Sent by Fictional Chief, 24 Oct 2026, 10:00 am")).toBeInTheDocument();
    expect(one.getByText("The press has not confirmed yet.")).toBeInTheDocument();
  });

  it("records the press's confirmation once, and says so on 409 already_confirmed", async () => {
    const { environment } = withView(ready({ candidate: null, releases: [sentOne()] }));
    const confirm = vi
      .spyOn(environment.release, "confirm")
      .mockResolvedValueOnce(answer(409, "already_confirmed"))
      .mockResolvedValueOnce({ ok: true, value: sentOne() });
    renderAuth(TAB(), { preset: "sahyadri-chief-editor", environment });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Record the press's confirmation" }));
    const dialog = within(await screen.findByRole("dialog", { name: "The press's confirmation" }));
    await user.click(dialog.getByRole("button", { name: "Record the confirmation" }));
    expect(dialog.getByText("Enter who at the press confirmed.")).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
    await user.type(dialog.getByLabelText("Who at the press"), "Fictional Press Manager");
    await user.click(dialog.getByRole("button", { name: "Record the confirmation" }));
    expect(confirm).toHaveBeenCalledWith({
      orgId: ORG,
      pubId: PUB,
      releaseId: sentOne().id,
      deliveryId: "01900000-0000-7000-8000-000000000201",
      pressPerson: "Fictional Press Manager",
    });
    expect(await dialog.findByText("The press's confirmation is already recorded for this sending.")).toBeTruthy();
    await user.click(dialog.getByRole("button", { name: "Record the confirmation" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("checks the archive copy file by file", async () => {
    const { environment } = withView(
      ready({ candidate: null, releases: [released(1, "release", [file(1), file(2)])] }),
    );
    vi.spyOn(environment.release, "verify").mockResolvedValue({
      ok: true,
      value: {
        checkedAt: AT,
        ok: false,
        files: [
          { name: "2026-10-24_P01.pdf", sha256: SHA(1), ok: true },
          { name: "2026-10-24_P02.pdf", sha256: SHA(2), ok: false },
        ],
      },
    });
    renderAuth(TAB(), { preset: "sahyadri-subeditor", environment });
    const one = within(await screen.findByRole("region", { name: "Release 1" }));
    await userEvent.click(one.getByRole("button", { name: "Check the archive copy" }));
    expect(await one.findByText("Archive copy checked 24 Oct 2026, 10:00 am: some files do not match.")).toBeTruthy();
    const results = one.getAllByRole("listitem").map((li) => li.textContent);
    expect(results).toEqual(expect.arrayContaining(["Matches2026-10-24_P01.pdf", "Does not match2026-10-24_P02.pdf"]));
  });
});

describe("what each role sees", () => {
  it("hides approval, release, downloads, sending and the press test form from a sub-editor", async () => {
    const { environment } = withView(
      ready({
        pages: ready().pages.map((p) => ({ ...p, approval: null })),
        releases: [released(1, "release", [file(1)])],
      }),
    );
    renderAuth(TAB(), { preset: "sahyadri-subeditor", environment });
    await screen.findByRole("region", { name: "Release 1" });
    for (const name of [
      /^Approve page/,
      /^Unlock page/,
      "Approve release",
      /^Download/,
      "Mark as sent",
      "Save the press test",
    ]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Check the archive copy" })).toBeInTheDocument();
    expect(region("Release 1").getByText("2026-10-24_P01.pdf", { selector: "td > span" })).toBeInTheDocument();
  });

  it("derives approval, unlocking, release and correction from the permissions, as the API does", () => {
    const org = (orgRole: string, roles: string[], grants: string[]) =>
      ({
        org: { id: ORG },
        orgRole,
        twoStep: { required: false, satisfied: false },
        publications: [{ id: PUB, roles, grants }],
      }) as unknown as OrgAccessDto;
    const pick = (a: LayoutAccess) => [a.approve, a.unlock, a.release, a.correct, a.press, a.archive, a.settingsEdit];
    // an Editor with both grants approves pages and the release, but cannot unlock, correct or send
    expect(pick(layoutAccess(org("member", ["editor"], ["page_approve", "release_approve"]), PUB))).toEqual([
      true,
      false,
      true,
      false,
      false,
      true,
      false,
    ]);
    expect(pick(layoutAccess(org("member", ["chief_editor"], []), PUB))).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(pick(layoutAccess(org("member", ["prepress"], []), PUB))).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
      false,
    ]);
    expect(pick(layoutAccess(org("member", ["reporter"], []), PUB))).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
      false,
    ]);
  });

  it("tells a release approver without release.correct that a correction is the Chief Editor's", () => {
    const environment = createMockApplicationEnvironment();
    const access = layoutAccess(
      {
        org: { id: ORG },
        orgRole: "member",
        twoStep: { required: false, satisfied: false },
        publications: [{ id: PUB, roles: ["editor"], grants: ["release_approve"] }],
      } as unknown as OrgAccessDto,
      PUB,
    );
    render(
      <MemoryRouter>
        <I18nProvider>
          <ReleaseProvider release={environment.release}>
            <ReleaseTab
              where={{ orgId: ORG, pubId: PUB, editionId: B }}
              load={{
                status: "ready",
                value: ready({ candidate: { kind: "correction", runId: RUN, files: [file(1, 2)] } }),
              }}
              access={access}
              onRefresh={() => {}}
              onTab={() => {}}
            />
          </ReleaseProvider>
        </I18nProvider>
      </MemoryRouter>,
    );
    expect(
      screen.getByText(
        "Only someone who can approve corrections (a Chief Editor, the Owner or an Admin) can approve a correction.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve correction" })).not.toBeInTheDocument();
  });

  it("disables approval of a page that needs saving, with the reason", async () => {
    const { environment } = withView(ready({ pages: [{ ...ready().pages[0]!, approval: null, needsSave: true }] }));
    renderAuth(TAB(), { preset: "sahyadri-editor", environment });
    expect(await screen.findByRole("button", { name: "Approve page 1" })).toBeDisabled();
    expect(screen.getByText("It needs saving in the page editor before it can be approved.")).toBeInTheDocument();
  });
});

describe("approval on the Pages board", () => {
  it("shows each page's approval and approves from its card", async () => {
    renderAuth(TAB("pages"), { preset: "sahyadri-editor" });
    const user = userEvent.setup();
    const card = within(await screen.findByRole("region", { name: "Page 2 · Inside page" }));
    expect(await card.findByText("Not approved")).toBeInTheDocument();
    await user.click(card.getByRole("button", { name: "Approve page 2" }));
    expect(await card.findByText(/^Approved by Sahyadri Demo Editor, /)).toBeInTheDocument();
  });

  it("offers Unlock on an approved card to a Chief Editor", async () => {
    const environment = createMockApplicationEnvironment();
    await environment.sessionController.actAs("sahyadri-chief-editor", async () => {
      await environment.release.get({ orgId: ORG, pubId: PUB, editionId: B });
      await environment.release.approvePage({ orgId: ORG, pubId: PUB, runId: RUN, page: 1, rev: 0, pdfSha256: SHA(1) });
    });
    renderAuth(TAB("pages"), { preset: "sahyadri-chief-editor", environment });
    const card = within(await screen.findByRole("region", { name: "Page 1 · Front page" }));
    await userEvent.click(await card.findByRole("button", { name: "Unlock page 1" }));
    expect(await card.findByText("Not approved")).toBeInTheDocument();
  });
});
