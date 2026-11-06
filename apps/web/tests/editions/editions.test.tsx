/**
 * Editions, /org/:orgId/pub/:pubId/editions (plan §1 L2.1, §10 PR 21 and PR 24): the list with its counts and links to
 * the stories, "Create edition" with an Idempotency-Key (the same on a retry) and edition_exists, "Send to the Desk"
 * (nothing Ready, spiked never sent, in progress, done, refused with each story named), the master table and the chosen
 * edition's detail, the Create edition sheet, the role rules, live updates,
 * the story editor's Edition, the Stories filter's real editions, Marathi and axe, and "Correct date and pages" (only
 * the fields changed sent, its refusals, none once released). On the test double; fictional data.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, screen, waitFor, within } from "../../src/test/render.tsx";
import { createMockApplicationEnvironment } from "../../src/mocks/index.ts";
import { DRAFTS_PREFIX } from "../../src/features/stories/drafts.ts";
import type { StoryDto } from "../../src/services/index.ts";
import { renderAuth, resetBrowserState, seriousViolations } from "../auth/helpers.tsx";

vi.setConfig({ testTimeout: 30_000 });

const ORG = "org-demo-sahyadri";
const PUB = "pub-demo-pune-daily";
const EDITIONS = `/org/${ORG}/pub/${PUB}/editions`;
const STORIES = `/org/${ORG}/pub/${PUB}/stories`;
const A = "edition-demo-2026-10-23";
const B = "edition-demo-2026-10-24";
const original = window.matchMedia;

let saved: { href: string; download: string }[] = [];
beforeEach(() => {
  saved = [];
  // jsdom has no object URLs and no downloads: record what would be saved
  URL.createObjectURL = vi.fn(() => "blob:fictional");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ href: this.href, download: this.download });
  });
});
afterEach(() => {
  resetBrowserState();
  window.matchMedia = original;
  vi.restoreAllMocks();
});

function phone() {
  window.matchMedia = (query: string) =>
    ({ matches: query.includes("767px"), media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList;
}

const list = () => screen.findByRole("table", { name: "Editions of Pune Daily Ledger" });
/** Chooses the edition in the table: its detail, a region named by its date. */
const item = async (date: string) => {
  await userEvent.click(within(await list()).getByRole("button", { name: date }));
  return screen.getByRole("region", { name: date });
};
/** Opens the "Create edition" sheet from the page header. */
const createSheet = async () => {
  await userEvent.click(await screen.findByRole("button", { name: "Create edition" }));
  return within(await screen.findByRole("dialog", { name: "Create edition" }));
};

describe("Editions for the desk", () => {
  it("lists the editions newest first, with pages, counts and a link to their stories", async () => {
    renderAuth(EDITIONS, { preset: "sahyadri-editor" });
    expect(await screen.findByRole("heading", { level: 1, name: "Editions" })).toBeInTheDocument();
    const rows = within(await list()).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getByRole("button").textContent)).toEqual(["24 October 2026", "23 October 2026"]);
    expect(within(rows[0]!).getByText("1 Ready")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Nothing Ready")).toBeInTheDocument();
    // the newest is chosen first
    expect(within(rows[0]!).getByRole("button")).toHaveAttribute("aria-pressed", "true");
    const newer = within(screen.getByRole("region", { name: "24 October 2026" }));
    expect(newer.getByText(/8 pages · Ads on the back page · Volume 12 · Issue 302/)).toBeInTheDocument();
    expect(newer.getByText("Stories: 1 · Ready: 1 · Spiked: 0")).toBeInTheDocument();
    expect(newer.getByRole("link", { name: "Stories of 24 October 2026" })).toHaveAttribute("href", `${STORIES}?edition=${B}`);
    expect(newer.getByRole("button", { name: "Send to the Desk" })).toBeEnabled();
    // nothing Ready: no button, a plain line
    const older = within(await item("23 October 2026"));
    expect(within(rows[1]!).getByRole("button")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("region", { name: "24 October 2026" })).not.toBeInTheDocument();
    expect(older.getByText("Stories: 2 · Ready: 0 · Spiked: 0")).toBeInTheDocument();
    expect(older.queryByRole("button", { name: "Send to the Desk" })).not.toBeInTheDocument();
    expect(older.getByText("Nothing in this edition is Ready yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create edition" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("creates an edition with one Idempotency-Key, the same on a retry after no answer", async () => {
    const environment = createMockApplicationEnvironment();
    const create = vi.spyOn(environment.editions, "create");
    renderAuth(EDITIONS, { preset: "sahyadri-editor", environment });
    const user = userEvent.setup();
    await list();
    const sheet = await createSheet();
    const date = sheet.getByLabelText(/^Date/);
    await user.clear(date);
    await user.type(date, "2026-11-05");
    expect(sheet.getByRole("combobox", { name: "Pages" })).toHaveValue("8");
    await user.selectOptions(sheet.getByRole("combobox", { name: "Pages" }), "16");
    await user.click(sheet.getByRole("checkbox", { name: "Ads on the back page" }));
    await user.type(sheet.getByRole("textbox", { name: "Issue number" }), "303");

    environment.sessionController.setProblem({ kind: "network" }, ["editions.create"]);
    await user.click(sheet.getByRole("button", { name: "Create edition" }));
    expect(await sheet.findByText("Pageinator cannot be reached")).toBeInTheDocument();
    environment.sessionController.setProblem(null, ["editions.create"]);
    await user.click(sheet.getByRole("button", { name: "Create edition" }));

    expect(await screen.findByText("The edition of 5 November 2026 is created.")).toBeInTheDocument();
    // the sheet closes, focus goes back to its button, and the new edition is the one chosen
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create edition" })).toHaveFocus();
    const made = await screen.findByRole("region", { name: "5 November 2026" });
    expect(within(made).getByText("16 pages · Issue 303")).toBeInTheDocument();
    expect(create.mock.calls.map(([input]) => input.input)).toEqual([
      { date: "2026-11-05", pages: 16, backPageAds: false, issue: "303" },
      { date: "2026-11-05", pages: 16, backPageAds: false, issue: "303" },
    ]);
    expect(create.mock.calls[1]![0].idempotencyKey).toBe(create.mock.calls[0]![0].idempotencyKey);
  });

  it("says when that date already has an edition, and links to it", async () => {
    renderAuth(EDITIONS, { preset: "sahyadri-editor" });
    const user = userEvent.setup();
    await list();
    const sheet = await createSheet();
    const date = sheet.getByLabelText(/^Date/);
    await user.clear(date);
    await user.type(date, "2026-10-23");
    await user.click(sheet.getByRole("button", { name: "Create edition" }));
    expect(await sheet.findByText("There is already an edition for 23 October 2026. Open it instead.")).toBeInTheDocument();
    expect(sheet.getByRole("link", { name: "Stories of 23 October 2026" })).toHaveAttribute("href", `${STORIES}?edition=${A}`);
  });

  it("sends an edition's Ready stories to the Desk, as a file, saying how many and that spiked ones never go", async () => {
    const environment = createMockApplicationEnvironment();
    // a held story put in the newer edition, then spiked
    await environment.stories.update({ orgId: ORG, pubId: PUB, storyId: "story-demo-005", patch: { baseRevision: 1, editionId: B } });
    await environment.stories.transition({ orgId: ORG, pubId: PUB, storyId: "story-demo-005", to: "spiked", baseRevision: 2, idempotencyKey: "k" });
    let release = () => {};
    const real = environment.editions.deskBundle.bind(environment.editions);
    const bundle = vi.spyOn(environment.editions, "deskBundle").mockImplementationOnce(async (input) => {
      const answer = await real(input);
      return new Promise((resolve) => {
        release = () => resolve(answer);
      });
    });
    renderAuth(EDITIONS, { preset: "sahyadri-editor", environment });
    const user = userEvent.setup();
    const newer = within(await item("24 October 2026"));
    expect(newer.getByText("Stories: 2 · Ready: 1 · Spiked: 1")).toBeInTheDocument();
    expect(newer.getByText("Spiked stories are never sent: 1.")).toBeInTheDocument();

    await user.click(newer.getByRole("button", { name: "Send to the Desk" }));
    expect(await newer.findByText("Sending the Ready stories to the Desk…")).toBeInTheDocument();
    expect(newer.getByRole("button", { name: "Send to the Desk" })).toBeDisabled();
    await act(async () => release());
    expect(await newer.findByText("Stories downloaded: 1. Open the file in the Desk.")).toBeInTheDocument();
    expect(bundle).toHaveBeenCalledWith({ orgId: ORG, pubId: PUB, editionId: B });
    expect(saved).toEqual([{ href: "blob:fictional", download: "pageinator-stories-2026-10-24.zip" }]);
    expect(newer.getByRole("button", { name: "Send to the Desk" })).toBeEnabled();
  });

  it("says when nothing went, and lists each story the Desk would refuse", async () => {
    const environment = createMockApplicationEnvironment();
    vi.spyOn(environment.editions, "deskBundle").mockResolvedValueOnce({
      ok: true,
      value: { file: new Blob(["PK"]), filename: "pageinator-stories-2026-10-24.zip", stories: 0 },
    });
    renderAuth(EDITIONS, { preset: "sahyadri-editor", environment });
    const user = userEvent.setup();
    const newer = within(await item("24 October 2026"));
    await user.click(newer.getByRole("button", { name: "Send to the Desk" }));
    expect(await newer.findByText("Nothing was Ready, so no story was sent.")).toBeInTheDocument();

    environment.sessionController.setProblem(
      {
        kind: "answer",
        status: 409,
        code: "bundle_refused",
        message: "Some stories cannot be sent.",
        requestId: "req-1",
        details: [{ field: "stories.story-demo-004", message: "The story “Fictional water cut” has a photo the Desk cannot read." }],
      },
      ["editions.deskBundle"],
    );
    await user.click(newer.getByRole("button", { name: "Send to the Desk" }));
    expect(await newer.findByText("Some stories cannot be sent to the Desk as they are. Change them, then send again.")).toBeInTheDocument();
    // a reason the web does not word: the API's English, in the list (Marathi: tests/editions/bundle-marathi.test.tsx)
    expect(newer.getByText("The story “Fictional water cut” has a photo the Desk cannot read.").closest("li")).toBeInTheDocument();
  });

  it("fetches the list again when an edition or a story of the publication changes", async () => {
    const environment = createMockApplicationEnvironment();
    const listed = vi.spyOn(environment.editions, "list");
    renderAuth(EDITIONS, { preset: "sahyadri-editor", environment });
    await list();
    const before = listed.mock.calls.length;
    await environment.editions.create({ orgId: ORG, pubId: PUB, input: { date: "2026-11-06", pages: 4 }, idempotencyKey: "live" });
    expect(await within(await list()).findByRole("button", { name: "6 November 2026" })).toBeInTheDocument();
    await environment.stories.update({ orgId: ORG, pubId: PUB, storyId: "story-demo-002", patch: { baseRevision: 1, editionId: A } });
    expect(await within(await item("23 October 2026")).findByText("Stories: 3 · Ready: 0 · Spiked: 0")).toBeInTheDocument();
    expect(listed.mock.calls.length).toBeGreaterThan(before);
  });

  it("names the date of the edition already there in Marathi too", async () => {
    renderAuth(EDITIONS, { preset: "sahyadri-editor", language: "mr" });
    const user = userEvent.setup();
    await screen.findByRole("table", { name: "Pune Daily Ledger चे अंक" });
    await user.click(screen.getByRole("button", { name: "अंक तयार करा" }));
    const sheet = within(await screen.findByRole("dialog", { name: "नवीन अंक तयार करा" }));
    const date = sheet.getByLabelText(/^तारीख/);
    await user.clear(date);
    await user.type(date, "2026-10-23");
    await user.click(sheet.getByRole("button", { name: "अंक तयार करा" }));
    const message = await screen.findByText(/चा अंक आधीच आहे\. तोच उघडा\.$/);
    expect(message.textContent).not.toBe("त्या तारखेचा अंक आधीच आहे. तोच उघडा.");
    expect(message.textContent).toMatch(/2026/);
  });

  it("takes today's date (IST) when the form is used after midnight, unless a date was chosen", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-02T18:20:00Z")); // 23:50 IST, 2 November
      const environment = createMockApplicationEnvironment();
      const create = vi.spyOn(environment.editions, "create");
      renderAuth(EDITIONS, { preset: "sahyadri-editor", environment });
      const user = userEvent.setup();
      await list();
      await user.click(screen.getByRole("button", { name: "Create edition" }));
      const sheet = within(await screen.findByRole("dialog", { name: "Create edition" }));
      expect(sheet.getByLabelText(/^Date/)).toHaveValue("2026-11-02");
      vi.setSystemTime(new Date("2026-11-02T18:40:00Z")); // 00:10 IST, 3 November
      await user.click(sheet.getByRole("combobox", { name: "Pages" }));
      expect(sheet.getByLabelText(/^Date/)).toHaveValue("2026-11-03");
      vi.setSystemTime(new Date("2026-11-03T18:40:00Z")); // a day later again, submitted without focusing the form
      sheet.getByRole("button", { name: "Create edition" }).closest("form")!.requestSubmit();
      await waitFor(() => expect(create).toHaveBeenCalled());
      expect(create.mock.calls[0]![0].input.date).toBe("2026-11-04");
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops the \"sent\" line once the edition's counts change", async () => {
    const environment = createMockApplicationEnvironment();
    renderAuth(EDITIONS, { preset: "sahyadri-editor", environment });
    const user = userEvent.setup();
    const newer = within(await item("24 October 2026"));
    await user.click(newer.getByRole("button", { name: "Send to the Desk" }));
    expect(await newer.findByText("Stories downloaded: 1. Open the file in the Desk.")).toBeInTheDocument();
    await environment.stories.update({ orgId: ORG, pubId: PUB, storyId: "story-demo-002", patch: { baseRevision: 1, editionId: B } });
    expect(await newer.findByText("Stories: 2 · Ready: 1 · Spiked: 0")).toBeInTheDocument();
    expect(newer.queryByText("Stories downloaded: 1. Open the file in the Desk.")).not.toBeInTheDocument();
  });

  it("shows a failure with Retry, and an empty publication", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setProblem({ kind: "answer", status: 500, code: "server_error", message: "", requestId: "req-7" }, ["editions.list"]);
    renderAuth(EDITIONS, { preset: "sahyadri-editor", environment });
    expect(await screen.findByText("Something went wrong on our side")).toBeInTheDocument();
    environment.sessionController.setProblem(null, ["editions.list"]);
    vi.spyOn(environment.editions, "list").mockResolvedValueOnce({ ok: true, value: [] });
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "No editions yet." })).toBeInTheDocument();
    expect(screen.getByText("Make the first one with Create edition.")).toBeInTheDocument();
  });
});

describe("Editions for other roles", () => {
  it("shows a role that sees no stories (Advertising: counts null) the editions without their counts", async () => {
    const environment = createMockApplicationEnvironment();
    const real = await environment.editions.list({ orgId: ORG, pubId: PUB });
    if (!real.ok) throw new Error("no editions");
    vi.spyOn(environment.editions, "list").mockResolvedValue({ ok: true, value: real.value.map((edition) => ({ ...edition, counts: null })) });
    renderAuth(EDITIONS, { preset: "sahyadri-editor", environment });
    const newer = within(await item("24 October 2026"));
    expect(newer.getByText(/8 pages/)).toBeInTheDocument();
    expect(newer.queryByText(/^Stories: /)).not.toBeInTheDocument();
    expect(within(await list()).queryByRole("columnheader", { name: "Status" })).not.toBeInTheDocument();
    expect(screen.queryByText("1 Ready")).not.toBeInTheDocument();
    expect(newer.queryByRole("button", { name: "Send to the Desk" })).not.toBeInTheDocument();
    expect(newer.getByRole("link", { name: "Stories of 24 October 2026" })).toBeInTheDocument();
  });

  it("tells a Reporter who types the address that their role cannot, with no Try again", async () => {
    renderAuth(EDITIONS, { preset: "sahyadri-reporter" });
    expect(await screen.findByText("Your role cannot do this. Ask the owner if you need it.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("shows a Sub-editor the editions, without Create edition or Send to the Desk", async () => {
    renderAuth(EDITIONS, { preset: "sahyadri-subeditor" });
    const newer = within(await item("24 October 2026"));
    expect(newer.getByText("Stories: 1 · Ready: 1 · Spiked: 0")).toBeInTheDocument();
    expect(newer.queryByRole("button", { name: "Send to the Desk" })).not.toBeInTheDocument();
    expect(newer.queryByText("Nothing in this edition is Ready yet.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create edition" })).not.toBeInTheDocument();
  });

  it("is in the publication's navigation for whoever may see editions, and not for a Reporter", async () => {
    const view = renderAuth(STORIES, { preset: "sahyadri-subeditor" });
    const nav = within(await screen.findByRole("navigation", { name: "Publication" }));
    expect(nav.getByRole("link", { name: "Editions" })).toHaveAttribute("href", EDITIONS);
    view.unmount();
    renderAuth(STORIES, { preset: "sahyadri-reporter" });
    const reporterNav = within(await screen.findByRole("navigation", { name: "Publication" }));
    expect(reporterNav.queryByRole("link", { name: "Editions" })).not.toBeInTheDocument();
  });
});

describe("Placing a story in an edition", () => {
  it("lets the desk choose a story's edition in the editor, saved as editionId, and take it out", async () => {
    const environment = createMockApplicationEnvironment();
    const update = vi.spyOn(environment.stories, "update");
    renderAuth(`${STORIES}/story-demo-002`, { preset: "sahyadri-editor", environment });
    const user = userEvent.setup();
    const select = await screen.findByRole("combobox", { name: "Edition" });
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual(["No edition", "24 October 2026", "23 October 2026"]);
    await user.selectOptions(select, B);
    await waitFor(() => expect(update).toHaveBeenCalledWith(expect.objectContaining({ patch: expect.objectContaining({ editionId: B }) })), { timeout: 10_000 });
    await waitFor(async () => {
      const story = await environment.stories.get({ orgId: ORG, pubId: PUB, storyId: "story-demo-002" });
      expect(story.ok && story.value.edition?.id).toBe(B);
    });
    await user.selectOptions(select, "");
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ patch: expect.objectContaining({ editionId: null }) })), { timeout: 10_000 });
    await waitFor(async () => {
      const story = await environment.stories.get({ orgId: ORG, pubId: PUB, storyId: "story-demo-002" });
      expect(story.ok && story.value.edition).toBeNull();
    });
  });

  it("offers only the edition's pages, and says clearly when a pin past them is not saved", async () => {
    const environment = createMockApplicationEnvironment();
    const made = await environment.editions.create({ orgId: ORG, pubId: PUB, input: { date: "2026-11-08", pages: 4 }, idempotencyKey: "four" });
    if (!made.ok) throw new Error("no edition");
    await environment.stories.update({ orgId: ORG, pubId: PUB, storyId: "story-demo-002", patch: { baseRevision: 1, pagePin: 9 } });
    renderAuth(`${STORIES}/story-demo-002`, { preset: "sahyadri-editor", environment });
    const user = userEvent.setup();
    const edition = await screen.findByRole("combobox", { name: "Edition" });
    await waitFor(() => expect(within(edition).getByRole("option", { name: "8 November 2026" })).toBeInTheDocument());
    await user.selectOptions(edition, made.value.id);
    const pin = screen.getByRole("combobox", { name: /^Page/ });
    expect(within(pin).getAllByRole("option").map((option) => option.textContent)).toEqual(["Any page", "Page 1", "Page 2", "Page 3", "Page 4", "Page 9"]);
    expect(await screen.findByText("Your latest changes are not saved. They are kept on this device.", {}, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByText("The edition has 4 pages, so this page is not in it. Choose a page from 1 to 4, or another edition.")).toBeInTheDocument();
    const story = await environment.stories.get({ orgId: ORG, pubId: PUB, storyId: "story-demo-002" });
    expect(story.ok && [story.value.edition, story.value.pagePin]).toEqual([null, 9]);
    // a page in the edition: saved, and the message goes
    await user.selectOptions(pin, "3");
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument(), { timeout: 10_000 });
    expect(screen.queryByText(/so this page is not in it/)).not.toBeInTheDocument();
  });

  it("restoring an old draft (no edition in it) keeps the story's edition: same version, and a newer one", async () => {
    const EDITOR = "user-demo-sahyadri-editor";
    const storyOf = async (environment: ReturnType<typeof createMockApplicationEnvironment>): Promise<StoryDto> => {
      const result = await environment.stories.get({ orgId: ORG, pubId: PUB, storyId: "story-demo-003" });
      if (!result.ok) throw new Error("no story");
      return result.value;
    };
    for (const newer of [false, true]) {
      const environment = createMockApplicationEnvironment();
      const story = await storyOf(environment);
      expect(story.edition?.id).toBe(A);
      // a draft written before editions: its fields have no editionId
      const old = { headline: story.headline, kicker: story.kicker, deck: story.deck, byline: story.byline, body: story.body, priority: story.priority, pagePin: story.pagePin, deskNote: story.deskNote };
      window.localStorage.setItem(
        `${DRAFTS_PREFIX}${EDITOR}`,
        JSON.stringify({ [story.id]: { fields: { ...old, body: "Restored body." }, base: old, baseRevision: story.revision, savedAt: "2026-10-22T05:00:00.000Z" } }),
      );
      if (newer) {
        await environment.stories.update({ orgId: ORG, pubId: PUB, storyId: story.id, patch: { baseRevision: story.revision, kicker: "Newer kicker" } });
      }
      const view = renderAuth(`${STORIES}/${story.id}`, { preset: "sahyadri-editor", environment });
      const user = userEvent.setup();
      await user.click(await screen.findByRole("button", { name: "Restore it" }));
      if (newer) await user.click(await screen.findByRole("button", { name: "Keep my version" }));
      await waitFor(async () => expect((await storyOf(environment)).body).toBe("Restored body."), { timeout: 10_000 });
      const now = await storyOf(environment);
      expect(now.edition?.id).toBe(A);
      if (newer) expect(now.kicker).toBe("Newer kicker");
      view.unmount();
      resetBrowserState();
    }
  });

  it("offers the Reporter no Edition: it is the desk's", async () => {
    renderAuth(`${STORIES}/story-demo-002`, { preset: "sahyadri-reporter" });
    await screen.findByLabelText("Body text");
    expect(screen.queryByRole("combobox", { name: "Edition" })).not.toBeInTheDocument();
  });

  it("offers every edition in the Stories filter to whoever may see them, not only those of the stories seen", async () => {
    const environment = createMockApplicationEnvironment();
    await environment.editions.create({ orgId: ORG, pubId: PUB, input: { date: "2026-11-07", pages: 8 }, idempotencyKey: "filter" });
    renderAuth(STORIES, { preset: "sahyadri-editor", environment });
    const filter = await screen.findByRole("combobox", { name: "Edition" });
    await waitFor(() => expect(within(filter).getByRole("option", { name: "7 November 2026" })).toBeInTheDocument());
  });
});

describe("Editions: Marathi and axe", () => {
  it("is in Marathi", async () => {
    renderAuth(EDITIONS, { preset: "sahyadri-editor", language: "mr" });
    expect(await screen.findByRole("heading", { level: 1, name: "अंक" })).toBeInTheDocument();
    expect(await screen.findByRole("table", { name: "Pune Daily Ledger चे अंक" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Desk कडे पाठवा" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "अंक तयार करा" })).toBeInTheDocument();
  });

  it("has no serious axe violations, on a desktop and on a phone", async () => {
    const view = renderAuth(EDITIONS, { preset: "sahyadri-editor" });
    await list();
    expect(await seriousViolations(view.container)).toEqual([]);
    view.unmount();
    phone();
    const small = renderAuth(EDITIONS, { preset: "sahyadri-subeditor" });
    await list();
    expect(await seriousViolations(small.container)).toEqual([]);
  });

  it("opens Create edition as a sheet that Esc closes, focus back on its button, and has no serious axe violations", async () => {
    const view = renderAuth(EDITIONS, { preset: "sahyadri-editor" });
    const user = userEvent.setup();
    await list();
    const sheet = await createSheet();
    expect(sheet.getByRole("heading", { level: 2, name: "Create edition" })).toHaveFocus();
    expect(await seriousViolations(view.container)).toEqual([]);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create edition" })).toHaveFocus();
  });

  it("chooses an edition from the keyboard", async () => {
    renderAuth(EDITIONS, { preset: "sahyadri-editor" });
    const user = userEvent.setup();
    const table = within(await list());
    table.getByRole("button", { name: "24 October 2026" }).focus();
    await user.tab();
    expect(table.getByRole("button", { name: "23 October 2026" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(table.getByRole("button", { name: "23 October 2026" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "23 October 2026" })).toBeInTheDocument();
  });
});

describe("Correcting an edition's date and pages", () => {
  const CORRECT = "Correct date and pages";
  /** Opens the correction sheet from the chosen edition's detail. */
  const correctSheet = async (detail: ReturnType<typeof within>) => {
    await userEvent.click(detail.getByRole("button", { name: CORRECT }));
    return within(await screen.findByRole("dialog", { name: CORRECT }));
  };

  it("opens a sheet for the desk, sends only the fields changed, and says it is done", async () => {
    const environment = createMockApplicationEnvironment();
    const update = vi.spyOn(environment.editions, "update");
    const view = renderAuth(EDITIONS, { preset: "sahyadri-editor", environment });
    const user = userEvent.setup();
    const sheet = await correctSheet(within(await item("23 October 2026")));
    expect(sheet.getByRole("heading", { level: 2, name: CORRECT })).toHaveFocus();
    expect(sheet.getByText(/^Layouts already made for this edition are set aside/)).toBeInTheDocument();
    expect(sheet.getByLabelText(/^Date/)).toHaveValue("2026-10-23");
    expect(sheet.getByRole("combobox", { name: "Pages" })).toHaveValue("8");
    expect(sheet.getByRole("checkbox", { name: "Ads on the back page" })).toBeChecked();
    expect(await seriousViolations(view.container)).toEqual([]);
    // nothing changed: nothing is sent
    await user.click(sheet.getByRole("button", { name: "Save the correction" }));
    expect(await sheet.findByText("Nothing is changed yet.")).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();

    const date = sheet.getByLabelText(/^Date/);
    await user.clear(date);
    await user.type(date, "2026-10-25");
    await user.selectOptions(sheet.getByRole("combobox", { name: "Pages" }), "4");
    await user.click(sheet.getByRole("button", { name: "Save the correction" }));
    expect(await screen.findByText("The edition is corrected: 25 October 2026, 4 pages.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(update.mock.calls.map(([input]) => [input.editionId, input.patch])).toEqual([
      [A, { date: "2026-10-25", pages: 4 }],
    ]);
    // now the newest, and still the one chosen
    const corrected = within(await screen.findByRole("region", { name: "25 October 2026" }));
    expect(corrected.getByText(/^4 pages · Ads on the back page/)).toBeInTheDocument();
    const rows = within(await list()).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getByRole("button").textContent)).toEqual(["25 October 2026", "24 October 2026"]);
    expect(corrected.getByRole("button", { name: CORRECT })).toHaveFocus();
  });

  it("says when another edition has that date, or a layout is running, and keeps the sheet open", async () => {
    const environment = createMockApplicationEnvironment();
    renderAuth(EDITIONS, { preset: "sahyadri-editor", environment });
    const user = userEvent.setup();
    const sheet = await correctSheet(within(await item("23 October 2026")));
    const date = sheet.getByLabelText(/^Date/);
    await user.clear(date);
    await user.type(date, "2026-10-24");
    await user.click(sheet.getByRole("button", { name: "Save the correction" }));
    expect(await sheet.findByText("There is already an edition for that date. Open it instead.")).toBeInTheDocument();

    environment.sessionController.setProblem(
      { kind: "answer", status: 409, code: "run_active", message: "A run is active.", requestId: "req-2" },
      ["editions.update"],
    );
    await user.clear(date);
    await user.type(date, "2026-10-26");
    await user.click(sheet.getByRole("button", { name: "Save the correction" }));
    expect(await sheet.findByText("A layout of this edition is already running. Wait for it, or cancel it first.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: CORRECT })).toBeInTheDocument();
  });

  it("shows a released edition one plain line and no button; a role without edition.edit sees neither", async () => {
    const environment = createMockApplicationEnvironment();
    const real = await environment.editions.list({ orgId: ORG, pubId: PUB });
    if (!real.ok) throw new Error("no editions");
    vi.spyOn(environment.editions, "list").mockResolvedValue({
      ok: true,
      value: real.value.map((edition) => (edition.id === B ? { ...edition, status: "released" as const } : edition)),
    });
    const view = renderAuth(EDITIONS, { preset: "sahyadri-editor", environment });
    const released = within(await item("24 October 2026"));
    expect(released.getByText("This edition is released: its date and pages can no longer change.")).toBeInTheDocument();
    expect(released.queryByRole("button", { name: CORRECT })).not.toBeInTheDocument();
    expect(within(await item("23 October 2026")).getByRole("button", { name: CORRECT })).toBeInTheDocument();
    view.unmount();

    renderAuth(EDITIONS, { preset: "sahyadri-subeditor" });
    const newer = within(await item("24 October 2026"));
    expect(newer.queryByRole("button", { name: CORRECT })).not.toBeInTheDocument();
    expect(newer.queryByText(/its date and pages can no longer change/)).not.toBeInTheDocument();
  });

  it("the test double, as the API, refuses a date another edition has (409 edition_exists, that edition)", async () => {
    const environment = createMockApplicationEnvironment();
    const where = { orgId: ORG, pubId: PUB, editionId: A };
    expect((await environment.editions.update({ ...where, patch: { pages: 4 } })).ok).toBe(true);
    const taken = await environment.editions.update({ ...where, patch: { date: "2026-10-24" } });
    expect(taken).toMatchObject({ ok: false, error: { status: 409, code: "edition_exists", current: { id: B } } });
  });

  it("is in Marathi", async () => {
    renderAuth(EDITIONS, { preset: "sahyadri-editor", language: "mr" });
    const user = userEvent.setup();
    await screen.findByRole("table", { name: "Pune Daily Ledger चे अंक" });
    await user.click(screen.getByRole("button", { name: "तारीख आणि पाने दुरुस्त करा" }));
    const sheet = within(await screen.findByRole("dialog", { name: "तारीख आणि पाने दुरुस्त करा" }));
    expect(sheet.getByLabelText(/^तारीख/)).toBeInTheDocument();
    expect(sheet.getByRole("combobox", { name: "पाने" })).toBeInTheDocument();
    expect(sheet.getByRole("checkbox", { name: "शेवटच्या पानावर जाहिराती" })).toBeInTheDocument();
    expect(sheet.getByRole("button", { name: "दुरुस्ती जतन करा" })).toBeInTheDocument();
    expect(sheet.getByText(/^या अंकाच्या आधी केलेल्या मांडण्या बाजूला ठेवल्या जातात/)).toBeInTheDocument();
  });
});
