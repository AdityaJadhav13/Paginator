/**
 * Editions and layout, hosted (plan §1 L2.3): the edition's layout screen (Readiness, Ads, Lay out, Pages), the
 * Overview's Today card and the engine profile screen, on the test double with fictional data: each tab's loading,
 * empty, error and live states, a run started, followed (live and by polling) and cancelled, an ad picked from the
 * library and cleared, the downloads each role may have, the board's exact check wording (never "PDF/X-valid" or
 * "press-ready"), the Desk's words in English and Marathi, the profile's upload, and axe on every new screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, screen, waitFor, within } from "../../src/test/render.tsx";
import { createMockApplicationEnvironment } from "../../src/mocks/index.ts";
import { POLL_MS } from "../../src/features/layout/EditionLayoutScreen.tsx";
import { todayInIndia } from "../../src/features/layout/TodayCard.tsx";
import { deskWords } from "../../src/features/layout/desk-text.tsx";
import { renderAuth, resetBrowserState, seriousViolations } from "../auth/helpers.tsx";

vi.setConfig({ testTimeout: 30_000 });

const ORG = "org-demo-sahyadri";
const PUB = "pub-demo-pune-daily";
const A = "edition-demo-2026-10-23";
const B = "edition-demo-2026-10-24";
const LAYOUT = (edition: string, tab?: string) =>
  `/org/${ORG}/pub/${PUB}/editions/${edition}/layout${tab ? `?tab=${tab}` : ""}`;
const PROFILE = `/org/${ORG}/pub/${PUB}/engine-profile`;

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
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const tab = (name: string) => screen.findByRole("tab", { name });

describe("Readiness", () => {
  it("loads, then shows what the paper needs against what the edition has, and what stops a layout", async () => {
    const { container } = renderAuth(LAYOUT(B), { preset: "sahyadri-editor" });
    expect(await screen.findByRole("heading", { level: 1, name: "Edition of 24 October 2026" })).toBeInTheDocument();
    expect(await tab("Readiness")).toHaveAttribute("aria-selected", "true");
    const needs = within(screen.getByRole("table", { name: "What this paper needs" }));
    const stories = needs.getByRole("row", { name: /^Stories/ });
    expect(
      within(stories)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["Stories", "18", "1", "Short by 17"]);
    expect(screen.getByText("Stories measured ahead of the layout: 1 of 1.")).toBeInTheDocument();
    const blockers = within(screen.getByRole("region", { name: "What stops a layout: 1" }));
    expect(blockers.getByRole("link", { name: "गुरुवारी पाणीपुरवठा बंद" })).toHaveAttribute(
      "href",
      `/org/${ORG}/pub/${PUB}/stories/story-demo-004`,
    );
    expect(blockers.getByText("Its photo is still being prepared.")).toHaveAttribute("lang", "en");
    expect(screen.getByText("Every story in this edition is Ready.")).toBeInTheDocument();
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("says it is loading until the layout comes", async () => {
    const environment = createMockApplicationEnvironment();
    vi.spyOn(environment.layout, "getLayout").mockImplementation(() => new Promise(() => {}));
    renderAuth(LAYOUT(B), { preset: "sahyadri-editor", environment });
    expect(await screen.findByText("Loading the edition's layout…")).toBeInTheDocument();
    expect(screen.getByText("Loading the edition's layout…").closest('[role="status"]')).not.toBeNull();
  });

  it("lists the stories not Ready yet, with their state and a link", async () => {
    renderAuth(LAYOUT(A), { preset: "sahyadri-editor" });
    const notReady = within(await screen.findByRole("region", { name: "Not Ready yet: 2" }));
    expect(notReady.getByRole("link", { name: "घाटात मान्सून लवकर दाखल" })).toBeInTheDocument();
    expect(notReady.getByText("Filed")).toBeInTheDocument();
    expect(notReady.getByText("Editing")).toBeInTheDocument();
  });

  it("says when the layout cannot be fetched, and fetches it again", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setProblem({ kind: "network" }, ["layout.get"]);
    renderAuth(LAYOUT(B), { preset: "sahyadri-editor", environment });
    expect(await screen.findByText("Pageinator cannot be reached")).toBeInTheDocument();
    environment.sessionController.setProblem(null, ["layout.get"]);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("table", { name: "What this paper needs" })).toBeInTheDocument();
  });

  it("is fetched again when the edition's layout changes live", async () => {
    const { environment } = renderAuth(LAYOUT(B), { preset: "sahyadri-editor" });
    await screen.findByRole("region", { name: "What stops a layout: 1" });
    // the photo became ready: the story's live update, then the blocker is gone
    act(() => environment.sessionController.prepareAsset("asset-demo-001", "ready"));
    await waitFor(() => expect(screen.queryByRole("region", { name: /What stops a layout/ })).not.toBeInTheDocument());
  });
});

describe("Ads", () => {
  it("shows each back-page slot, picks its picture from the library, hears it fitted, and clears it", async () => {
    const { environment, container } = renderAuth(LAYOUT(B, "ads"), { preset: "sahyadri-editor" });
    const user = userEvent.setup();
    expect(
      await screen.findByText("Ad spaces filled: 0 of 2. Spaces without an image print as a grey box marked AD."),
    ).toBeInTheDocument();
    const slot = within(screen.getByRole("region", { name: "Ad space back-1" }));
    expect(slot.getByText("Page 8 · 330 × 170 mm")).toBeInTheDocument();
    expect(slot.getByText("Reserved space — prints as a grey box marked AD")).toBeInTheDocument();
    expect(await seriousViolations(container)).toEqual([]);

    await user.click(slot.getByRole("button", { name: "Choose an image" }));
    const sheet = within(await screen.findByRole("dialog", { name: "Choose an image for ad space back-1" }));
    await user.click(await sheet.findByRole("button", { name: /नदीकाठचा फेरफटका/ }));
    expect(await slot.findByText("Fitting the image into the space…")).toBeInTheDocument();
    act(() => environment.sessionController.layout.fitAd(B, "back-1"));
    expect(await slot.findByText("Image added")).toBeInTheDocument();
    expect(slot.getByRole("img", { name: "The picture chosen for ad space back-1" }).getAttribute("src")).toMatch(
      /\/assets\/[^/]+\/file\?variant=preview$/,
    );
    expect(screen.getByText(/Ad spaces filled: 1 of 2/)).toBeInTheDocument();

    await user.click(slot.getByRole("button", { name: "Remove image" }));
    const confirm = within(await screen.findByRole("dialog", { name: "Remove this ad image?" }));
    expect(
      confirm.getByText("Space back-1 will print as a grey box marked AD until you choose another image."),
    ).toBeInTheDocument();
    await user.click(confirm.getByRole("button", { name: "Remove image" }));
    expect(await slot.findByText("Reserved space — prints as a grey box marked AD")).toBeInTheDocument();
  });

  it("says why the Desk refused an ad, in Marathi too", async () => {
    const { environment } = renderAuth(LAYOUT(B, "ads"), { preset: "sahyadri-editor", language: "mr" });
    const user = userEvent.setup();
    const slot = within(await screen.findByRole("region", { name: "जाहिरात-जागा back-1" }));
    await user.click(slot.getByRole("button", { name: "चित्र निवडा" }));
    await user.click(await screen.findByRole("button", { name: /नदीकाठचा फेरफटका/ }));
    await slot.findByText("चित्र जागेत बसवत आहे…");
    act(() =>
      environment.sessionController.layout.fitAd(B, "back-1", {
        text: "The picture file is damaged or incomplete. Try saving it again.",
        code: "m.img.damaged",
        params: null,
      }),
    );
    expect(await slot.findByText("चित्राची फाइल खराब किंवा अपूर्ण आहे. ती पुन्हा जतन करून पाहा.")).toBeInTheDocument();
    expect(slot.getByText("चित्र नाकारले")).toBeInTheDocument();
  });

  it("lets the ads desk (ads.manage, no media.view) pick a ready picture for a slot", async () => {
    const { container } = renderAuth(LAYOUT(B, "ads"), { preset: "sahyadri-advertising" });
    const user = userEvent.setup();
    const slot = within(await screen.findByRole("region", { name: "Ad space back-1" }));
    await user.click(slot.getByRole("button", { name: "Choose an image" }));
    const sheet = within(await screen.findByRole("dialog", { name: "Choose an image for ad space back-1" }));
    await user.click(await sheet.findByRole("button", { name: /नदीकाठचा फेरफटका/ }));
    expect(await slot.findByText("Fitting the image into the space…")).toBeInTheDocument();
    expect(await seriousViolations(container)).toEqual([]);
    // the library itself stays closed to them
    expect(screen.queryByRole("link", { name: "Media" })).not.toBeInTheDocument();
  });

  it("offers no picking or clearing to a role the API would refuse", async () => {
    renderAuth(LAYOUT(B, "ads"), { preset: "sahyadri-reporter" });
    const slot = within(await screen.findByRole("region", { name: "Ad space back-1" }));
    expect(slot.queryByRole("button")).not.toBeInTheDocument();
  });

  it("says when an edition has no ad spaces", async () => {
    const environment = createMockApplicationEnvironment();
    const made = await environment.editions.create({
      orgId: ORG,
      pubId: PUB,
      input: { date: "2026-11-20", pages: 4, backPageAds: false },
      idempotencyKey: "k",
    });
    renderAuth(LAYOUT(made.ok ? made.value.id : "", "ads"), { preset: "sahyadri-editor", environment });
    expect(await screen.findByText("This edition has no ad spaces.")).toBeInTheDocument();
    expect(screen.getByText("The back page is all news (no ad spaces).")).toBeInTheDocument();
  });
});

describe("Lay out", () => {
  async function readyB() {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const environment = createMockApplicationEnvironment();
    // story-demo-004's photo ready: nothing stops a layout
    environment.sessionController.prepareAsset("asset-demo-001", "ready");
    const view = renderAuth(LAYOUT(B, "run"), { preset: "sahyadri-editor", environment });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    return { ...view, user };
  }

  it("starts a run, follows it page by page live, and shows its outcome", async () => {
    const { environment, user, container } = await readyB();
    const start = await screen.findByRole("button", { name: "Lay out the 8-page paper again" });
    expect(screen.getByText(/Ad spaces without an image: 2/)).toBeInTheDocument();
    expect(await seriousViolations(container)).toEqual([]);
    await user.click(start);
    const run = within(await screen.findByRole("region", { name: "Layout" }));
    expect(run.getByText("Waiting to start")).toBeInTheDocument();
    expect(run.getByText("Starting…")).toBeInTheDocument();
    const id = environment.sessionController.layout.latestRun(B)!;
    act(() =>
      environment.sessionController.layout.progress(id, {
        state: "layout",
        pages: [
          [1, "done"],
          [2, "working"],
        ],
        message: { text: "Laying out the pages", code: "m.run.layingOut", params: null },
      }),
    );
    expect(await run.findByText("Laying out pages")).toBeInTheDocument();
    expect(run.getByText("Pages done: 1 of 8")).toBeInTheDocument();
    expect(run.getByText("Laying out the pages")).toBeInTheDocument();
    expect(
      within(run.getByRole("list", { name: "Pages of this layout" })).getAllByRole("listitem")[1],
    ).toHaveTextContent("Page 2 · Inside pageLaying out");
    expect(run.getByText(/so far$/)).toBeInTheDocument();
    expect(await seriousViolations(container)).toEqual([]);

    act(() => environment.sessionController.layout.finish(id));
    const last = within(await screen.findByRole("region", { name: "Last layout" }));
    expect(last.getByText("Done")).toBeInTheDocument();
    expect(last.getByText("8 pages made.")).toBeInTheDocument();
    await user.click(last.getByRole("button", { name: "See the pages" }));
    expect(await tab("Pages")).toHaveAttribute("aria-selected", "true");
  });

  it("keeps following a run by asking every 3 s when a live update is missed", async () => {
    const { environment, user } = await readyB();
    await user.click(await screen.findByRole("button", { name: "Lay out the 8-page paper again" }));
    const run = within(await screen.findByRole("region", { name: "Layout" }));
    environment.liveController.drop(true);
    environment.sessionController.layout.progress(environment.sessionController.layout.latestRun(B)!, {
      state: "finishing",
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    expect(await run.findByText("Making the PDFs and previews")).toBeInTheDocument();
  });

  it("cancels a run after asking, and says so in the Desk's words", async () => {
    const { user } = await readyB();
    await user.click(await screen.findByRole("button", { name: "Lay out the 8-page paper again" }));
    const run = within(await screen.findByRole("region", { name: "Layout" }));
    await user.click(run.getByRole("button", { name: "Cancel layout" }));
    const confirm = within(await screen.findByRole("dialog", { name: "Cancel this layout?" }));
    await user.click(confirm.getByRole("button", { name: "Cancel layout" }));
    const last = within(await screen.findByRole("region", { name: "Last layout" }));
    expect(last.getByText("Cancelled")).toBeInTheDocument();
    expect(last.getByText("Cancelled before it started.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Layout" })).not.toBeInTheDocument();
  });

  it("shows a failed run's error in the Desk's words", async () => {
    const { environment, user } = await readyB();
    await user.click(await screen.findByRole("button", { name: "Lay out the 8-page paper again" }));
    await screen.findByRole("region", { name: "Layout" });
    act(() =>
      environment.sessionController.layout.finish(environment.sessionController.layout.latestRun(B)!, {
        state: "failed",
        error: {
          text: "The server was restarted while this run was in progress. Start it again.",
          code: "m.run.restarted",
          params: null,
        },
      }),
    );
    const last = within(await screen.findByRole("region", { name: "Last layout" }));
    expect(
      last.getByText("The server was restarted while this run was in progress. Start it again."),
    ).toBeInTheDocument();
  });

  it("says what stops a layout the API refused", async () => {
    const { environment, user } = await readyB();
    const start = await screen.findByRole("button", { name: "Lay out the 8-page paper again" });
    // the photo goes back to preparing and the screen has not heard yet
    environment.liveController.drop(true);
    environment.sessionController.prepareAsset("asset-demo-001", "received");
    await user.click(start);
    expect(
      await screen.findByText("This edition cannot be laid out yet: see Readiness for what stops it."),
    ).toBeInTheDocument();
    const why = within(screen.getByRole("list", { name: "What stops the layout" }));
    expect(why.getAllByRole("listitem").length).toBeGreaterThan(0);
  });

  it("times a run failed later by the stalled-run check from its start to its end, and says the restart once", async () => {
    const { environment, user } = await readyB();
    await user.click(await screen.findByRole("button", { name: "Lay out the 8-page paper again" }));
    await screen.findByRole("region", { name: "Layout" });
    const id = environment.sessionController.layout.latestRun(B)!;
    act(() => environment.sessionController.layout.progress(id, { state: "layout" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11 * 60_000);
    });
    const restarted = {
      text: "The server was restarted while this run was in progress. Start it again.",
      code: "m.run.restarted",
      params: null,
    };
    act(() =>
      environment.sessionController.layout.finish(id, { state: "failed", error: restarted, message: restarted }),
    );
    // the region first shows the older done run: wait for the failed run's refetch (slow under a full, loaded run)
    await screen.findByText(/^Stopped after 11 min/);
    const last = within(screen.getByRole("region", { name: "Last layout" }));
    expect(last.getByText(/^Stopped after 11 min/)).toBeInTheDocument();
    expect(last.getAllByText(restarted.text)).toHaveLength(1);
  });

  it("keeps the start button from a run something stops, and from a role that may not lay out", async () => {
    renderAuth(LAYOUT(B, "run"), { preset: "sahyadri-editor" });
    expect(await screen.findByRole("button", { name: "Lay out the 8-page paper again" })).toBeDisabled();
    expect(screen.getByText("Fix what stops a layout first: see Readiness.")).toBeInTheDocument();
  });

  it("tells a Reporter the engine profile is not theirs to see, instead of an empty page", async () => {
    const { container } = renderAuth(PROFILE, { preset: "sahyadri-reporter" });
    expect(await screen.findByText("You don't have access to the engine profile")).toBeInTheDocument();
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("shows a Reporter the last run, with nothing to start or cancel", async () => {
    renderAuth(LAYOUT(B, "run"), { preset: "sahyadri-reporter" });
    expect(await screen.findByRole("region", { name: "Last layout" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Lay out the/ })).not.toBeInTheDocument();
  });
});

describe("The Pages board", () => {
  it("shows every page with its preview and the independent check in exact words, and the stories not placed", async () => {
    const { container } = renderAuth(LAYOUT(B, "pages"), { preset: "sahyadri-editor" });
    const board = within(await screen.findByRole("list", { name: "Pages of this layout" }));
    expect(board.getAllByRole("region", { name: /^Page \d+ · / })).toHaveLength(8);
    const front = within(screen.getByRole("region", { name: "Page 1 · Front page" }));
    expect(front.getByText("Independent PDF/X-1a check: passed (2 warnings)")).toBeInTheDocument();
    expect(await front.findByRole("img", { name: "Preview of page 1" })).toHaveAttribute("src", "blob:fictional");
    expect(front.getByRole("link", { name: "गुरुवारी पाणीपुरवठा बंद" })).toBeInTheDocument();
    expect(
      front.getByText("About 18 mm of the page is left empty at the foot — add a short item or a photo"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Page 2 · Inside page" })).getByText(
        "Independent PDF/X-1a check: passed",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Page 3 · Inside page" })).getByText(
        "Independent PDF/X-1a check: failed (3 problems)",
      ),
    ).toBeInTheDocument();
    const failed = within(screen.getByRole("region", { name: "Page 6 · Inside page" }));
    expect(failed.getByText(/This page could not be laid out\./)).toBeInTheDocument();
    expect(failed.getByText("the layout search ran out of time")).toBeInTheDocument();
    const notPlaced = within(screen.getByRole("region", { name: "Not placed: 1" }));
    expect(notPlaced.getByText("Fictional brief left over")).toBeInTheDocument();
    expect(
      notPlaced.getByText("No room left — add pages, lower another story's priority, or pin it to a page"),
    ).toBeInTheDocument();
    expect(screen.getByText(/These files are a proof\./)).toBeInTheDocument();
    // the plan's wording rule (§2.3)
    expect(container.textContent).not.toMatch(/PDF\/X-valid|press-ready/i);
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("downloads what the role may have, each by a fresh 5-minute link", async () => {
    // a Reporter: proof.view (the PDFs), not export.press (the press files)
    renderAuth(LAYOUT(B, "pages"), { preset: "sahyadri-reporter" });
    const user = userEvent.setup();
    const downloads = within(await screen.findByRole("region", { name: "Downloads" }));
    expect(downloads.queryByRole("button", { name: "Press files (ZIP)" })).not.toBeInTheDocument();
    await user.click(downloads.getByRole("button", { name: "Edition PDF" }));
    await waitFor(() =>
      expect(saved).toEqual([{ href: "mock-store://runs/run-demo-001/edition.pdf", download: "edition.pdf" }]),
    );
    await user.click(
      within(screen.getByRole("region", { name: "Page 2 · Inside page" })).getByRole("button", {
        name: "PDF of page 2",
      }),
    );
    await waitFor(() =>
      expect(saved[1]).toEqual({ href: "mock-store://runs/run-demo-001/page-02.pdf", download: "page-02.pdf" }),
    );
    // a page not laid out has no PDF to download
    expect(
      within(screen.getByRole("region", { name: "Page 6 · Inside page" })).queryByRole("button"),
    ).not.toBeInTheDocument();
  });

  it("gives the press files to a Chief Editor (export.press)", async () => {
    renderAuth(LAYOUT(B, "pages"), { preset: "sahyadri-chief-editor" });
    const user = userEvent.setup();
    const downloads = within(await screen.findByRole("region", { name: "Downloads" }));
    await user.click(downloads.getByRole("button", { name: "Press files (ZIP)" }));
    await waitFor(() =>
      expect(saved).toEqual([{ href: "mock-store://runs/run-demo-001/press-files.zip", download: "press-files.zip" }]),
    );
  });

  it("says there are no pages yet before a layout is done", async () => {
    renderAuth(LAYOUT(A, "pages"), { preset: "sahyadri-editor" });
    expect(await screen.findByRole("heading", { name: "No pages yet" })).toBeInTheDocument();
  });

  it("says the board in Marathi, the Desk's words included, and an unknown code in the Desk's English", async () => {
    const { container } = renderAuth(LAYOUT(B, "pages"), { preset: "sahyadri-editor", language: "mr" });
    const front = within(await screen.findByRole("region", { name: "पान 1 · पहिले पान" }));
    expect(front.getByText("स्वतंत्र PDF/X-1a तपासणी: उत्तीर्ण (2 इशारे)")).toBeInTheDocument();
    expect(
      front.getByText("पानाच्या तळाशी सुमारे 18 मिमी रिकामे राहिले आहे — एखादी छोटी बातमी किंवा छायाचित्र जोडा"),
    ).toBeInTheDocument();
    expect(screen.getByText("मांडणीच्या शोधाची वेळ संपली")).toBeInTheDocument();
    expect(
      screen.getByText(
        "जागा उरली नाही — पाने वाढवा, दुसऱ्या बातमीचे प्राधान्य कमी करा, किंवा ती एखाद्या पानावर पिन करा",
      ),
    ).toBeInTheDocument();
    expect(await seriousViolations(container)).toEqual([]);
  });
});

describe("The Desk's words", () => {
  it("says a known code in the reader's language, the one-form for one, and anything else in English", () => {
    expect(deskWords({ text: "7 pages made.", code: "m.run.madeN", params: { n: 7 } }, "mr")).toEqual({
      text: "7 पाने तयार झाली.",
      english: false,
    });
    expect(
      deskWords({ text: "1 lines of text did not fit", code: "m.warn.overset", params: { n: 1 } }, "mr").text,
    ).toBe("मजकुराची 1 ओळ बसली नाही");
    expect(
      deskWords({ text: "3 lines of text did not fit", code: "m.warn.overset", params: { n: 3 } }, "mr").text,
    ).toBe("मजकुराच्या 3 ओळी बसल्या नाहीत");
    // a code the web does not carry, or one whose sentence its parameters do not fill: the Desk's own English
    expect(deskWords({ text: "Something new.", code: "m.run.brandNew", params: null }, "mr")).toEqual({
      text: "Something new.",
      english: true,
    });
    expect(deskWords({ text: "Measured 2 of 3 stories", code: "m.run.measured", params: { done: 2 } }, "mr")).toEqual({
      text: "Measured 2 of 3 stories",
      english: true,
    });
    expect(deskWords({ text: "Plain.", code: null, params: null }, "en")).toEqual({ text: "Plain.", english: true });
  });
});

describe("The Today card", () => {
  it("says there is no edition for today, with Create for whoever may create one", async () => {
    renderAuth(`/org/${ORG}`, { preset: "sahyadri-editor" });
    const today = await screen.findAllByRole("region", { name: "Today's edition" });
    const pune = within(today[0]!);
    expect(await pune.findByText("No edition for today.")).toBeInTheDocument();
    expect(pune.getByRole("link", { name: "Create today's edition" })).toHaveAttribute(
      "href",
      `/org/${ORG}/pub/${PUB}/editions?create=1`,
    );
  });

  it("shows today's edition: pages, stories ready against the need, the latest layout and a link", async () => {
    const environment = createMockApplicationEnvironment();
    const made = await environment.editions.create({
      orgId: ORG,
      pubId: PUB,
      input: { date: todayInIndia(), pages: 8, backPageAds: true },
      idempotencyKey: "k",
    });
    const { container } = renderAuth(`/org/${ORG}`, { preset: "sahyadri-editor", environment });
    const card = within((await screen.findAllByRole("region", { name: "Today's edition" }))[0]!);
    expect(await card.findByText("8 pages")).toBeInTheDocument();
    expect(await card.findByText("Stories Ready: 0 of about 18")).toBeInTheDocument();
    expect(card.getByText("Not laid out yet.")).toBeInTheDocument();
    expect(card.getByRole("link", { name: "Open today's edition" })).toHaveAttribute(
      "href",
      `/org/${ORG}/pub/${PUB}/editions/${made.ok ? made.value.id : ""}/layout`,
    );
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("counts briefs once, and pairs no earlier check result with a layout under way", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-10-24T06:00:00.000Z")); // edition B's day in India
    const environment = createMockApplicationEnvironment();
    environment.sessionController.prepareAsset("asset-demo-001", "ready");
    const before = await environment.layout.getLayout({ orgId: ORG, pubId: PUB, editionId: B });
    const readiness = before.ok ? before.value.readiness : null;
    expect(before.ok && before.value.board).toBeTruthy();
    const started = await environment.layout.startRun({ orgId: ORG, pubId: PUB, editionId: B, idempotencyKey: "k" });
    expect(started.ok).toBe(true);
    renderAuth(`/org/${ORG}`, { preset: "sahyadri-editor", environment });
    const card = within((await screen.findAllByRole("region", { name: "Today's edition" }))[0]!);
    expect(
      await card.findByText(`Stories Ready: ${readiness?.have.stories} of about ${readiness?.needs.stories}`),
    ).toBeInTheDocument();
    expect(card.getByText("Latest layout: Waiting to start")).toBeInTheDocument();
    expect(card.queryByText(/independent PDF\/X-1a check/)).not.toBeInTheDocument();
  });

  it("is the publication's Overview too, with its Stories and Editions (no placeholder)", async () => {
    const { container } = renderAuth(`/org/${ORG}/pub/${PUB}/overview`, { preset: "sahyadri-editor" });
    expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeInTheDocument();
    const today = await screen.findByRole("region", { name: "Today's edition" });
    expect(await within(today).findByText("No edition for today.")).toBeInTheDocument();
    expect(within(screen.getByRole("main")).getByRole("link", { name: /stories/i })).toHaveAttribute(
      "href",
      `/org/${ORG}/pub/${PUB}/stories`,
    );
    expect(screen.queryByText(/UI00\d/)).not.toBeInTheDocument();
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("opens the Create edition sheet from the card's link", async () => {
    renderAuth(`/org/${ORG}/pub/${PUB}/editions?create=1`, { preset: "sahyadri-editor" });
    expect(await screen.findByRole("dialog", { name: "Create edition" })).toBeInTheDocument();
  });

  it("links each edition of the Editions list to its layout", async () => {
    renderAuth(`/org/${ORG}/pub/${PUB}/editions`, { preset: "sahyadri-editor" });
    expect(await screen.findByRole("link", { name: "Lay out this edition" })).toHaveAttribute("href", LAYOUT(B));
  });
});

/** The operator's dataset upload, folded under its plain summary: opened. */
async function advanced(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByText("Advanced: upload an engine dataset bundle (for Pageinator staff)"));
  return within(screen.getByRole("region", { name: "Upload a dataset bundle" }));
}

describe("The engine profile", () => {
  it("shows the profile in use and the earlier versions", async () => {
    const { container } = renderAuth(PROFILE, { preset: "sahyadri-editor" });
    const inUse = within(await screen.findByRole("region", { name: "In use: version 2" }));
    expect(inUse.getByText("b".repeat(64))).toBeInTheDocument();
    expect(inUse.getByText("8 columns of 38.5 mm, gutter 4.2 mm")).toBeInTheDocument();
    expect(inUse.getByText("desk-engine 0.9.4 (fictional)")).toBeInTheDocument();
    expect(within(screen.getByRole("table", { name: "Earlier versions" })).getAllByRole("row")).toHaveLength(2);
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("is not offered to a role without settings.view", async () => {
    renderAuth(PROFILE, { preset: "sahyadri-subeditor" });
    expect(await screen.findByRole("heading", { level: 1, name: "Engine profile" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Engine profile" })).not.toBeInTheDocument();
    expect(screen.queryByText(/In use/)).not.toBeInTheDocument();
  });

  it("uploads a dataset bundle with its progress, hears it setting up, and shows the new profile in use", async () => {
    const { environment, container } = renderAuth(PROFILE, { preset: "sahyadri-chief-editor" });
    const user = userEvent.setup();
    const upload = await advanced(user);
    await user.upload(
      upload.getByLabelText(/Dataset bundle/),
      new File(["PK fictional"], "dataset.zip", { type: "application/zip" }),
    );
    let made: () => void = () => {};
    const create = environment.layout.createProfile.bind(environment.layout);
    vi.spyOn(environment.layout, "createProfile").mockImplementation(
      (input) => new Promise((resolve) => (made = () => resolve(create(input)))),
    );
    await user.click(upload.getByRole("button", { name: "Upload and set up" }));
    expect(await upload.findByText(/Setting up the engine from the dataset\./)).toBeInTheDocument();
    made();
    expect(await upload.findByText("Uploaded. The engine is setting it up.")).toBeInTheDocument();
    expect(await screen.findByText(/Setting up the engine from the dataset\./)).toBeInTheDocument();
    expect(await seriousViolations(container)).toEqual([]);
    act(() => environment.sessionController.layout.setUp("profile-new-001"));
    expect(await screen.findByRole("region", { name: "In use: version 3" })).toBeInTheDocument();
  });

  it("says why a dataset could not be set up in plain words, and no longer that it is setting up", async () => {
    const { environment } = renderAuth(PROFILE, { preset: "sahyadri-chief-editor" });
    const user = userEvent.setup();
    const upload = await advanced(user);
    await user.upload(
      upload.getByLabelText(/Dataset bundle/),
      new File(["PK"], "dataset.zip", { type: "application/zip" }),
    );
    await user.click(upload.getByRole("button", { name: "Upload and set up" }));
    await upload.findByText("Uploaded. The engine is setting it up.");
    act(() =>
      environment.sessionController.layout.setUp("profile-new-001", {
        code: "profile.no_pages",
        message: { text: "The bundle has no page models.", code: null, params: null },
      }),
    );
    expect(await screen.findByText("This dataset could not be set up.")).toBeInTheDocument();
    expect(
      screen.getByText("This dataset bundle has no measured pages in it, so the engine has nothing to set up from."),
    ).toBeInTheDocument();
    expect(screen.queryByText("The bundle has no page models.")).not.toBeInTheDocument();
    expect(upload.queryByText("Uploaded. The engine is setting it up.")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "In use: version 2" })).toBeInTheDocument();
  });

  it("sends nothing for a file that is not a ZIP", async () => {
    renderAuth(PROFILE, { preset: "sahyadri-chief-editor" });
    const user = userEvent.setup({ applyAccept: false });
    const upload = await advanced(user);
    await user.upload(upload.getByLabelText(/Dataset bundle/), new File(["x"], "notes.txt", { type: "text/plain" }));
    await user.click(upload.getByRole("button", { name: "Upload and set up" }));
    expect(
      await upload.findByText(
        "This is not a ZIP file. Choose the dataset bundle Pageinator gave you: a file ending in .zip.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the dataset upload folded away for staff, and says a worker failure in general Marathi words", async () => {
    const { environment } = renderAuth(PROFILE, { preset: "sahyadri-chief-editor", language: "mr" });
    const user = userEvent.setup();
    const summary = await screen.findByText("प्रगत: इंजिन डेटासेट संच अपलोड करा (Pageinator कर्मचाऱ्यांसाठी)");
    expect(summary.closest("details")).not.toHaveAttribute("open");
    await user.click(summary);
    const upload = within(screen.getByRole("region", { name: "डेटासेट संच अपलोड करा" }));
    await user.upload(upload.getByLabelText(/डेटासेट संच/), new File(["PK"], "dataset.zip", { type: "application/zip" }));
    await user.click(upload.getByRole("button", { name: "अपलोड करून तयार करा" }));
    await upload.findByText("अपलोड झाले. इंजिन ते तयार करत आहे.");
    act(() =>
      environment.sessionController.layout.setUp("profile-new-001", {
        code: "worker.timeout",
        message: { text: "fictional timeout", code: null, params: null },
      }),
    );
    expect(await screen.findByText(/तयार होताना इंजिन अनपेक्षितपणे थांबले/)).toBeInTheDocument();
    expect(upload.queryByText("अपलोड झाले. इंजिन ते तयार करत आहे.")).not.toBeInTheDocument();
  });

  it("is in the publication's navigation for settings.view, in Marathi too", async () => {
    renderAuth(PROFILE, { preset: "sahyadri-editor", language: "mr" });
    expect(await screen.findByRole("heading", { level: 1, name: "इंजिन प्रोफाइल" })).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "वापरात: आवृत्ती 2" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "इंजिन प्रोफाइल" }).length).toBeGreaterThan(0);
  });
});

describe("The publication's sections", () => {
  it("are added, moved, renamed, archived and brought back by the Chief Editor; a name is one section's", async () => {
    const { container } = renderAuth(PROFILE, { preset: "sahyadri-chief-editor" });
    const user = userEvent.setup();
    const panel = within(await screen.findByRole("region", { name: "Sections" }));
    expect(await panel.findByText("No sections yet.")).toBeInTheDocument();
    for (const name of ["Example City", "Example Sport"]) {
      await user.type(panel.getByLabelText("New section"), name);
      await user.click(panel.getByRole("button", { name: "Add section" }));
      expect(await panel.findByText(name)).toBeInTheDocument();
    }
    const order = () => panel.getAllByRole("listitem").map((item) => item.querySelector(".pg-sections__name")?.textContent);
    expect(order()).toEqual(["Example City", "Example Sport"]);
    await user.click(panel.getByRole("button", { name: "Move Example Sport up" }));
    await waitFor(() => expect(order()).toEqual(["Example Sport", "Example City"]));

    await user.type(panel.getByLabelText("New section"), "example city");
    await user.click(panel.getByRole("button", { name: "Add section" }));
    expect(await panel.findByText("This paper already has a section of that name. Use another name.")).toBeInTheDocument();

    await user.click(panel.getByRole("button", { name: "Rename Example City" }));
    const renamed = panel.getByLabelText("New name for Example City");
    await user.clear(renamed);
    await user.type(renamed, "Example Town");
    await user.click(panel.getByRole("button", { name: "Save" }));
    expect(await panel.findByText("Example Town")).toBeInTheDocument();

    await user.click(panel.getByRole("button", { name: "Archive Example Sport" }));
    expect(await panel.findByRole("heading", { name: "Archived sections" })).toBeInTheDocument();
    await user.click(panel.getByRole("button", { name: "Bring back Example Sport" }));
    await waitFor(() => expect(order()).toEqual(["Example Town", "Example Sport"]));
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("are in Marathi too", async () => {
    renderAuth(PROFILE, { preset: "sahyadri-editor", language: "mr" });
    const panel = within(await screen.findByRole("region", { name: "विभाग" }));
    expect(await panel.findByText("अजून कोणतेही विभाग नाहीत.")).toBeInTheDocument();
    expect(panel.getByRole("button", { name: "विभाग जोडा" })).toBeDisabled();
  });

  it("are not offered to a role without settings.view", async () => {
    renderAuth(PROFILE, { preset: "sahyadri-subeditor" });
    expect(await screen.findByRole("heading", { level: 1, name: "Engine profile" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Sections" })).not.toBeInTheDocument();
  });
});
