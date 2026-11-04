/**
 * Sources (the news finder, L2.7): the trending topics (titles in both languages, source chips and counts, the "Big
 * story" badge, the language filter), the Pick drawer ("Find a photo" on only for a big story; the draft's progress
 * found by polling; the Draft story's link, the flagged sentences, "Made with Claude"; the engine's failures in plain
 * words), the photo choice (Safe to print / Needs permission; the rights tick required, and the API's 422), the AI-off
 * notice, Settings for whoever may change them (a source added, the house style saved), the story editor's notice and
 * sources, the Media drawer's licence and rights tick, and axe. On the test double; fictional data only.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, screen, waitFor, within } from "../../src/test/render.tsx";
import { createMockApplicationEnvironment } from "../../src/mocks/index.ts";
import { POLL_MS } from "../../src/features/news/PickDrawer.tsx";
import { renderAuth, resetBrowserState, seriousViolations } from "../auth/helpers.tsx";

const ORG = "org-demo-sahyadri";
const PUB = "pub-demo-pune-daily";
const SOURCES = `/org/${ORG}/pub/${PUB}/sources`;
const RAIN = "Heavy rain in Pune; schools shut";

afterEach(() => {
  resetBrowserState();
  vi.useRealTimers();
});

const topicCards = () => within(screen.getByRole("list", { name: "Topics from the last three days" })).getAllByRole("listitem");

async function openSources(options: Parameters<typeof renderAuth>[1] = {}, advanceTimers?: (ms: number) => void) {
  const view = renderAuth(SOURCES, { preset: "sahyadri-editor", ...options });
  const user = userEvent.setup(advanceTimers ? { advanceTimers } : {});
  await screen.findByRole("button", { name: RAIN });
  return { ...view, user };
}

async function pickRain(options: Parameters<typeof renderAuth>[1] = {}, advanceTimers?: (ms: number) => void) {
  const view = await openSources(options, advanceTimers);
  await view.user.click(screen.getByRole("button", { name: RAIN }));
  const sheet = within(await screen.findByRole("dialog", { name: "Pick this topic" }));
  return { ...view, sheet };
}

/** Picks the big story, lets the engine finish it, and waits for the drawer's poll to find it done. */
async function draftRain(outcome?: Parameters<ReturnType<typeof createMockApplicationEnvironment>["sessionController"]["finishNews"]>[1]) {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const environment = createMockApplicationEnvironment();
  const view = await pickRain({ environment }, vi.advanceTimersByTime.bind(vi));
  await view.user.click(view.sheet.getByRole("button", { name: "Draft the story" }));
  expect(await view.sheet.findByText("Claude is drafting the story…")).toHaveAttribute("role", "status");
  environment.sessionController.finishNews("draft-001", outcome);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(POLL_MS);
  });
  return { ...view, environment };
}

describe("Trending topics", () => {
  it("lists topics with both titles, source chips, counts and the big story badge, and filters by language", async () => {
    const { user, container } = await openSources();
    expect(screen.getByRole("heading", { level: 1, name: "Sources" })).toBeInTheDocument();
    expect(topicCards()).toHaveLength(3);
    const rain = within(topicCards()[0]!);
    expect(rain.getByText("पुण्यात मुसळधार पाऊस, शाळांना सुट्टी")).toHaveAttribute("lang", "mr");
    expect(rain.getByText("Big story")).toBeInTheDocument();
    expect(rain.getByText("Fictional Deccan Herald")).toBeInTheDocument();
    expect(rain.getByText("Sources: 3")).toBeInTheDocument();
    expect(rain.getByText("Reports: 3")).toBeInTheDocument();
    expect(within(topicCards()[1]!).queryByText("Big story")).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "English" }));
    await waitFor(() => expect(topicCards()).toHaveLength(2));
    expect(screen.queryByRole("button", { name: "Grape exports from Nashik rise" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Marathi" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Ring road tenders opened" })).not.toBeInTheDocument());
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("shows the titles in Marathi first for a Marathi reader", async () => {
    renderAuth(SOURCES, { preset: "sahyadri-editor", language: "mr" });
    expect(await screen.findByRole("button", { name: "पुण्यात मुसळधार पाऊस, शाळांना सुट्टी" })).toHaveAttribute("lang", "mr");
    expect(screen.getByText(RAIN)).toHaveAttribute("lang", "en");
    expect(screen.getAllByText("मोठी बातमी").length).toBeGreaterThan(0);
  });

  it("with the AI part off, lists the latest headlines by source, not as topics, with nothing to pick", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setNewsAi("off");
    const { container } = renderAuth(SOURCES, { preset: "sahyadri-editor", environment });
    expect(await screen.findByText("The AI part is off; collection still works")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 2, name: "Latest headlines" })).toBeInTheDocument();
    expect(screen.getByText(/Not grouped into topics/)).toBeInTheDocument();
    const deccan = screen.getByRole("list", { name: "Headlines from Fictional Deccan Herald" });
    expect(within(deccan).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Heavy rain shuts Pune schools",
      "Ring road tenders opened",
    ]);
    expect(within(deccan).getByRole("link", { name: "Ring road tenders opened" })).toHaveAttribute(
      "href",
      "https://source-demo-3.example/news/item-demo-5",
    );
    expect(screen.queryByRole("list", { name: "Topics from the last three days" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: RAIN })).not.toBeInTheDocument();
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("refuses a pick while the AI part is off, and queues no draft", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setNewsAi("off");
    const picked = await environment.news.pick({
      orgId: ORG,
      pubId: PUB,
      topicId: "topic-demo-1",
      pick: { language: "mr", length: "short", findPhoto: false },
      idempotencyKey: "key-off",
    });
    expect(picked).toMatchObject({ ok: false, error: { status: 409, code: "ai_off" } });
    expect(await environment.news.getDraft({ orgId: ORG, pubId: PUB, draftId: "draft-001" })).toMatchObject({ ok: false });
  });

  it("is the desk's: Settings only for whoever may change them", async () => {
    await openSources({ preset: "sahyadri-subeditor" });
    expect(screen.queryByRole("tab", { name: "Settings" })).not.toBeInTheDocument();
    resetBrowserState();
    renderAuth(SOURCES, { preset: "sahyadri-owner" });
    expect(await screen.findByRole("tab", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Trending" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("Pick a topic", () => {
  it("turns Find a photo on for a big story only, and lists the topic's reports with links", async () => {
    const { user, sheet } = await pickRain();
    expect(sheet.getByRole("checkbox", { name: "Find a photo" })).toBeChecked();
    expect(await sheet.findByRole("link", { name: "Heavy rain shuts Pune schools" })).toHaveAttribute(
      "href",
      "https://source-demo-3.example/news/item-demo-3",
    );
    expect(sheet.getByRole("radio", { name: "Marathi" })).toBeChecked();
    await user.click(sheet.getByRole("button", { name: "Close dialog" }));
    await user.click(screen.getByRole("button", { name: "Ring road tenders opened" }));
    const other = within(await screen.findByRole("dialog", { name: "Pick this topic" }));
    expect(other.getByRole("checkbox", { name: "Find a photo" })).not.toBeChecked();
    expect(other.getByRole("radio", { name: "English" })).toBeChecked();
  });

  it("sends the choices, polls until done, links the Draft story, lists flagged sentences and marks it Made with Claude", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const environment = createMockApplicationEnvironment();
    const pick = vi.spyOn(environment.news, "pick");
    const getDraft = vi.spyOn(environment.news, "getDraft");
    const { user, sheet, container } = await pickRain({ environment }, vi.advanceTimersByTime.bind(vi));
    await user.click(sheet.getByRole("radio", { name: "Short" }));
    await user.click(sheet.getByRole("button", { name: "Draft the story" }));
    expect(await sheet.findByText("Claude is drafting the story…")).toBeInTheDocument();
    expect(pick.mock.calls[0]![0]).toMatchObject({ topicId: "topic-demo-1", pick: { language: "mr", length: "short", findPhoto: true } });
    expect(pick.mock.calls[0]![0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    expect(sheet.getByText("Claude is drafting the story…")).toBeInTheDocument();
    environment.sessionController.finishNews("draft-001", { flagged: ["शहरातील सखल भागात पाणी साचले."] });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    expect(await sheet.findByText("Done. The story is in Stories as a Draft, given to you.")).toBeInTheDocument();
    expect(sheet.getByRole("link", { name: "Open the draft story" })).toHaveAttribute("href", `/org/${ORG}/pub/${PUB}/stories/story-news-001`);
    expect(sheet.getByText("Made with Claude — check before use")).toBeInTheDocument();
    expect(sheet.getByText("शहरातील सखल भागात पाणी साचले.")).toHaveAttribute("lang", "mr");
    // polling stops once it is done
    const calls = getDraft.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    });
    expect(getDraft.mock.calls.length).toBe(calls);
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("says plainly why a draft failed, and the topic may be picked again", async () => {
    const { sheet } = await draftRain({ error: { code: "ai.refused", message: "refused" } });
    expect(await sheet.findByText("Claude declined to write this story. Write it by hand from the sources.")).toBeInTheDocument();
    expect(sheet.getByRole("button", { name: "Draft the story" })).toBeEnabled();
  });

  it("names an engine failure it has no words for in general terms", async () => {
    const { sheet } = await draftRain({ error: { code: "worker.crashed", message: "x" } });
    expect(await sheet.findByText("Something went wrong while drafting. Try again.")).toBeInTheDocument();
  });
});

describe("Choose a photo", () => {
  it("labels each photo, and chooses a Needs-permission one only with the rights ticked", async () => {
    const { user, sheet, environment, container } = await draftRain();
    const cards = within(await sheet.findByRole("region", { name: "Choose a photo" })).getAllByRole("listitem");
    expect(cards).toHaveLength(3);
    expect(within(cards[0]!).getByText("Safe to print")).toBeInTheDocument();
    expect(within(cards[0]!).getByText("Licence: CC BY 4.0")).toBeInTheDocument();
    expect(within(cards[0]!).getByText("Credit: Fictional Photographer / photos.example, CC BY 4.0")).toBeInTheDocument();
    expect(within(cards[0]!).queryByRole("checkbox")).not.toBeInTheDocument();
    const needs = within(cards[2]!);
    expect(needs.getByText("Needs permission")).toBeInTheDocument();
    const choose = vi.spyOn(environment.news, "choosePhoto");
    await user.click(needs.getByRole("button", { name: "Choose this photo" }));
    expect(needs.getByRole("alert")).toHaveTextContent('Tick "We have the right to print this" first.');
    expect(choose).not.toHaveBeenCalled();
    await user.click(needs.getByRole("checkbox", { name: "We have the right to print this" }));
    await user.click(needs.getByRole("button", { name: "Choose this photo" }));
    expect(await sheet.findByText("The photo is in the Media library and is now the story's photo.")).toBeInTheDocument();
    expect(choose.mock.calls[0]![0]).toMatchObject({ draftId: "draft-001", index: 2, rightsConfirmed: true });
    const story = await environment.stories.get({ orgId: ORG, pubId: PUB, storyId: "story-news-001" });
    expect(story.ok && story.value.photo?.assetId).toBe("asset-news-001");
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("shows the API's 422 rights_needed plainly", async () => {
    const { user, sheet, environment } = await draftRain();
    vi.spyOn(environment.news, "choosePhoto").mockResolvedValue({
      ok: false,
      error: { kind: "answer", status: 422, code: "rights_needed", message: "" },
    });
    const cards = within(await sheet.findByRole("region", { name: "Choose a photo" })).getAllByRole("listitem");
    await user.click(within(cards[0]!).getByRole("button", { name: "Choose this photo" }));
    expect(await sheet.findByText('This photo needs permission: tick "We have the right to print this" first.')).toBeInTheDocument();
  });
});

describe("Settings", () => {
  it("adds a source, collects now, saves the house style, and shows the AI spend", async () => {
    const environment = createMockApplicationEnvironment();
    const { user } = await openSources({ environment, preset: "sahyadri-owner" });
    await user.click(screen.getByRole("tab", { name: "Settings" }));
    const feeds = await screen.findByRole("table", { name: "Feeds" });
    expect(await within(feeds).findByText("Fictional Konkan Varta")).toBeInTheDocument();
    expect(within(feeds).getByText("The feed did not answer in time.")).toBeInTheDocument();
    expect(screen.getByText("This month: ₹412.50")).toBeInTheDocument();
    expect(screen.getByText("Today: ₹26.00 of the ₹300.00 daily limit")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add a source" }));
    const sheet = within(await screen.findByRole("dialog", { name: "Add a source" }));
    await user.type(sheet.getByRole("textbox", { name: "Name" }), "Fictional Nagpur Patrika");
    await user.type(sheet.getByRole("textbox", { name: "Feed address" }), "https://nagpur.example/rss");
    await user.click(sheet.getByRole("button", { name: "Save the source" }));
    expect(await within(feeds).findByText("Fictional Nagpur Patrika")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Collect now" }));
    expect(await screen.findByText("Collecting. New topics appear in a few minutes.")).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "House style" }), "Short sentences. Numbers in digits.");
    await user.clear(screen.getByRole("spinbutton", { name: "Collect every (hours)" }));
    await user.type(screen.getByRole("spinbutton", { name: "Collect every (hours)" }), "6");
    await user.click(screen.getByRole("button", { name: "Save the settings" }));
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    const settings = await environment.news.getSettings({ orgId: ORG, pubId: PUB });
    expect(settings.ok && settings.value).toMatchObject({ houseStyle: "Short sentences. Numbers in digits.", collectEveryHours: 6 });
  });

  it("puts Collect now in the header for whoever may change the settings only", async () => {
    await openSources({ preset: "sahyadri-subeditor" });
    expect(screen.queryByRole("button", { name: "Collect now" })).not.toBeInTheDocument();
    resetBrowserState();
    await openSources({ preset: "sahyadri-owner" });
    expect((await screen.findByRole("button", { name: "Collect now" })).closest(".pg-page-header")).not.toBeNull();
  });

  it("adds the suggested public feeds once, and words a feed's problem in Marathi", async () => {
    const { user } = await openSources({ preset: "sahyadri-owner" });
    await user.click(screen.getByRole("tab", { name: "Settings" }));
    const feeds = await screen.findByRole("table", { name: "Feeds" });
    await within(feeds).findByText("Fictional Konkan Varta");
    await user.click(screen.getByRole("button", { name: "Add suggested sources" }));
    expect(await within(feeds).findByText("Fictional Maharashtra News")).toBeInTheDocument();
    expect(within(feeds).getByText("https://suggested-mr.example/feed.xml")).toBeInTheDocument();
    expect(screen.getByText(/The suggested sources this list did not have are added/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add suggested sources" }));
    await waitFor(() => expect(within(feeds).getAllByText("Fictional Maharashtra News")).toHaveLength(1));
    expect(within(feeds).getAllByRole("row")).toHaveLength(1 + 5 + 2);

    resetBrowserState();
    renderAuth(SOURCES, { preset: "sahyadri-owner", language: "mr" });
    const user2 = userEvent.setup();
    await user2.click(await screen.findByRole("tab", { name: "सेटिंग्ज" }));
    expect(await screen.findByText("फीडने वेळेत उत्तर दिले नाही.")).toBeInTheDocument();
  });

  it("deletes a source after asking", async () => {
    const { user } = await openSources({ preset: "sahyadri-owner" });
    await user.click(screen.getByRole("tab", { name: "Settings" }));
    const feeds = await screen.findByRole("table", { name: "Feeds" });
    await user.click(await within(feeds).findByRole("button", { name: "Actions for Fictional City Wire" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Delete this source?" })).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(within(feeds).queryByText("Fictional City Wire")).not.toBeInTheDocument());
  });
});

describe("The draft story and its photo elsewhere", () => {
  it("marks the story Made with Claude and lists its sources in the editor; the Media drawer ticks the rights", async () => {
    const environment = createMockApplicationEnvironment();
    const where = { orgId: ORG, pubId: PUB };
    const picked = await environment.news.pick({ ...where, topicId: "topic-demo-1", pick: { language: "en", length: "standard", findPhoto: true }, idempotencyKey: "key-1" });
    expect(picked.ok).toBe(true);
    environment.sessionController.finishNews("draft-001");
    // the API refuses a Needs-permission photo without the tick
    expect(await environment.news.choosePhoto({ ...where, draftId: "draft-001", index: 2, rightsConfirmed: false })).toMatchObject({
      ok: false,
      error: { code: "rights_needed" },
    });

    const view = renderAuth(`/org/${ORG}/pub/${PUB}/stories/story-news-001`, { environment, preset: "sahyadri-editor" });
    expect(await screen.findByText("Made with Claude — check before use")).toBeInTheDocument();
    const sources = within(screen.getByRole("region", { name: "Sources" }));
    expect(sources.getByRole("link", { name: "Heavy rain shuts Pune schools" })).toHaveAttribute("href", "https://source-demo-3.example/news/item-demo-3");
    expect(sources.getByText("For the editor; not printed.")).toBeInTheDocument();
    expect(await seriousViolations(view.container)).toEqual([]);
  });

  it("shows a found photo's licence in the Media drawer, and ticks the rights of one that needs permission", async () => {
    const environment = createMockApplicationEnvironment();
    const where = { orgId: ORG, pubId: PUB };
    await environment.news.pick({ ...where, topicId: "topic-demo-1", pick: { language: "en", length: "standard", findPhoto: true }, idempotencyKey: "key-1" });
    environment.sessionController.finishNews("draft-001");
    const chosen = await environment.news.choosePhoto({ ...where, draftId: "draft-001", index: 2, caption: "Fictional flooded street", rightsConfirmed: true });
    expect(chosen.ok).toBe(true);
    // as the library would list a found photo whose rights nobody has ticked yet
    const list = environment.media.list.bind(environment.media);
    vi.spyOn(environment.media, "list").mockImplementation(async (input) => {
      const real = await list(input);
      if (!real.ok) return real;
      const items = real.value.items.map((item) =>
        item.licence ? { ...item, licence: { ...item.licence, rightsConfirmed: null } } : item,
      );
      return { ok: true, value: { ...real.value, items } };
    });
    const confirm = vi.spyOn(environment.media, "confirmRights");

    const { container } = renderAuth(`/org/${ORG}/pub/${PUB}/media`, { environment, preset: "sahyadri-editor" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Fictional flooded street/ }));
    const sheet = within(await screen.findByRole("dialog", { name: "Fictional flooded street" }));
    expect(sheet.getByText("Needs permission")).toBeInTheDocument();
    expect(sheet.getByText("unknown")).toBeInTheDocument();
    expect(sheet.getByRole("link", { name: "https://photos.example/page/3" })).toBeInTheDocument();
    expect(sheet.getByText("This photo is printed only after someone confirms the right to print it.")).toBeInTheDocument();
    expect(await seriousViolations(container)).toEqual([]);
    await user.click(sheet.getByRole("button", { name: "We have the right to print this" }));
    expect(await sheet.findByText(/^Right to print confirmed by Sahyadri Demo Editor/)).toBeInTheDocument();
    expect(confirm.mock.calls[0]![0]).toMatchObject({ assetId: "asset-news-001" });
    expect(sheet.queryByRole("button", { name: "We have the right to print this" })).not.toBeInTheDocument();
  });
});
