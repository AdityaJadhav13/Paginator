/**
 * Newsroom, /org/:orgId/pub/:pubId/newsroom: the board's columns and counts, the edition it opens on, its filters, the
 * photo flags, moves through the stories API (only those the story's `can` allows; a send-back with its comment), live
 * updates, a Reporter's own board, Marathi and axe. On the test double; fictional data only.
 */
import { afterEach, describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "../../src/test/render.tsx";
import { createMockApplicationEnvironment } from "../../src/mocks/index.ts";
import { defaultEdition, flagsOf } from "../../src/features/newsroom/NewsroomScreen.tsx";
import type { PubEditionDto, StoryListItemDto } from "../../src/services/index.ts";
import { renderAuth, resetBrowserState, seriousViolations } from "../auth/helpers.tsx";

const ORG = "org-demo-sahyadri";
const PUB = "pub-demo-pune-daily";
const BOARD = `/org/${ORG}/pub/${PUB}/newsroom`;

afterEach(() => resetBrowserState());

const column = (name: RegExp) => screen.getByRole("region", { name });
const cards = (name: RegExp) => within(column(name)).queryAllByRole("link").map((link) => link.textContent);

async function story(environment: ReturnType<typeof createMockApplicationEnvironment>, storyId: string) {
  const got = await environment.stories.get({ orgId: ORG, pubId: PUB, storyId });
  if (!got.ok) throw new Error("no such story");
  return got.value;
}

describe("the board's rules", () => {
  const edition = (id: string, date: string) => ({ id, date }) as PubEditionDto;
  it("opens on today's edition, else the next, else the newest", () => {
    const list = [edition("a", "2026-11-04"), edition("b", "2026-11-06"), edition("c", "2026-11-08")];
    expect(defaultEdition(list, "2026-11-06")).toBe("b");
    expect(defaultEdition(list, "2026-11-05")).toBe("b");
    expect(defaultEdition(list, "2026-12-01")).toBe("c");
    expect(defaultEdition([], "2026-12-01")).toBe("any");
  });

  it("flags only the photo's facts: none, no caption, refused; a brief needs none", () => {
    const item = (fields: Partial<StoryListItemDto>) => ({ isBrief: false, photo: null, ...fields }) as StoryListItemDto;
    const photo = { caption: "", status: "rejected" } as NonNullable<StoryListItemDto["photo"]>;
    expect(flagsOf(item({}))).toEqual(["noPhoto"]);
    expect(flagsOf(item({ isBrief: true }))).toEqual([]);
    expect(flagsOf(item({ photo }))).toEqual(["noCaption", "photoRefused"]);
    expect(flagsOf(item({ photo: { ...photo, caption: "A caption", status: "ready" } }))).toEqual([]);
  });
});

describe("Newsroom for the desk", () => {
  it("opens on the next edition (else the newest), with a counted column per state, and every edition on asking", async () => {
    const { container } = renderAuth(BOARD, { preset: "sahyadri-editor" });
    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { level: 1, name: "Newsroom" })).toBeInTheDocument();
    await screen.findByRole("heading", { name: "Ready: 1" });
    // the fixtures' editions are past: the newest, 24 October, holds one story
    expect(screen.getByRole("combobox", { name: "Edition" })).toHaveValue("edition-demo-2026-10-24");
    expect(cards(/^Ready/)).toEqual(["गुरुवारी पाणीपुरवठा बंद"]);
    expect(screen.getByRole("heading", { name: "Draft: 0" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^Spiked/ })).toBeNull();

    await user.selectOptions(screen.getByRole("combobox", { name: "Edition" }), "any");
    await screen.findByRole("heading", { name: "Held: 1" });
    expect(screen.getByRole("heading", { name: "Draft: 1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Filed: 1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Editing: 1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Placed: 0" })).toBeInTheDocument();
    const ring = screen.getByRole("link", { name: "Ring road work to resume next week" });
    expect(ring).toHaveAttribute("href", `${BOARD.replace("newsroom", "stories")}/story-demo-003`);

    await user.selectOptions(screen.getByRole("combobox", { name: "Edition" }), "none");
    await waitFor(() => expect(cards(/^Draft/)).toEqual(["बाजार समितीची निवडणूक रविवारी"]));
    expect(cards(/^Filed/)).toEqual([]);
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("filters by section and by who the story is given to", async () => {
    const environment = createMockApplicationEnvironment();
    renderAuth(`${BOARD}?edition=any`, { preset: "sahyadri-editor", environment });
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Held: 1" });
    const added = await environment.layout.addSection({ orgId: ORG, pubId: PUB, name: "City" });
    const city = added.ok ? added.value.items[0]!.id : "";
    const ring = await story(environment, "story-demo-003");
    await environment.stories.update({
      orgId: ORG,
      pubId: PUB,
      storyId: ring.id,
      patch: { baseRevision: ring.revision, sectionId: city },
    });
    await waitFor(() => expect(screen.getByText(/City · By Sahyadri Demo Editor/)).toBeInTheDocument());

    await user.selectOptions(screen.getByRole("combobox", { name: "Section" }), city);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Filed: 0" })).toBeInTheDocument());
    expect(cards(/^Editing/)).toEqual(["Ring road work to resume next week"]);
    await user.selectOptions(screen.getByRole("combobox", { name: "Section" }), "");

    await user.selectOptions(screen.getByRole("combobox", { name: "Given to" }), "user-demo-sahyadri-subeditor");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Held: 0" })).toBeInTheDocument());
    expect(cards(/^Editing/)).toEqual(["Ring road work to resume next week"]);
    await user.selectOptions(screen.getByRole("combobox", { name: "Given to" }), "none");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Held: 1" })).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Editing: 0" })).toBeInTheDocument();
  });

  it("flags a story with no photo, and a photo with no caption", async () => {
    const environment = createMockApplicationEnvironment();
    renderAuth(`${BOARD}?edition=any`, { preset: "sahyadri-editor", environment });
    await screen.findByRole("heading", { name: "Held: 1" });
    const ring = await story(environment, "story-demo-003");
    const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
    await environment.stories.update({
      orgId: ORG,
      pubId: PUB,
      storyId: ring.id,
      patch: { baseRevision: ring.revision, body: long },
    });
    const water = await story(environment, "story-demo-004");
    await environment.stories.updatePhoto({ orgId: ORG, pubId: PUB, storyId: water.id, baseRevision: water.revision, caption: "" });
    await waitFor(() => expect(within(column(/^Editing/)).getByText("No photo")).toBeInTheDocument());
    expect(within(column(/^Ready/)).getByText("No caption")).toBeInTheDocument();
    expect(within(column(/^Held/)).queryByText("No photo")).toBeNull(); // a brief
  });

  it("moves a story only to what its rules allow, by keyboard, and asks for a send-back's comment", async () => {
    const environment = createMockApplicationEnvironment();
    renderAuth(`${BOARD}?edition=any`, { preset: "sahyadri-editor", environment });
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Filed: 1" });
    const menu = screen.getByRole("button", { name: "Move “घाटात मान्सून लवकर दाखल”" });
    menu.focus();
    await user.keyboard("{Enter}");
    const items = within(screen.getByRole("menu")).getAllByRole("menuitem").map((item) => item.textContent);
    expect(items).toEqual(["Pick up", "Mark ready", "Send back to the reporter", "Hold", "Spike"]);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(await screen.findByText("“घाटात मान्सून लवकर दाखल” is now: Ready.")).toBeInTheDocument();
    await waitFor(() => expect(cards(/^Ready/)).toContain("घाटात मान्सून लवकर दाखल"));
    expect(screen.getByRole("heading", { name: "Filed: 0" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("link", { name: "घाटात मान्सून लवकर दाखल" })).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Move “Ring road work to resume next week”" }));
    await user.click(screen.getByRole("menuitem", { name: "Send back to the reporter" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Send back to the reporter" }));
    expect(within(dialog).getByText("Say why the story goes back.", { exact: false })).toBeInTheDocument();
    await user.type(within(dialog).getByRole("textbox"), "Needs the corporation's figures.");
    await user.click(within(dialog).getByRole("button", { name: "Send back to the reporter" }));
    await waitFor(() => expect(cards(/^Draft/)).toContain("Ring road work to resume next week"));
    expect((await story(environment, "story-demo-003")).status).toBe("draft");
  });

  it("shows a spiked story only when asked, and updates live when someone else moves one", async () => {
    const environment = createMockApplicationEnvironment();
    renderAuth(`${BOARD}?edition=any`, { preset: "sahyadri-editor", environment });
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Held: 1" });
    const held = await story(environment, "story-demo-005");
    await environment.stories.transition({
      orgId: ORG,
      pubId: PUB,
      storyId: held.id,
      to: "spiked",
      baseRevision: held.revision,
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
    });
    await waitFor(() => expect(screen.getByRole("heading", { name: "Held: 0" })).toBeInTheDocument());
    await user.click(screen.getByRole("checkbox", { name: "Show spiked stories" }));
    expect(cards(/^Spiked/)).toEqual(["जुना पूल दुरुस्तीसाठी बंद"]);
  });
});

describe("Newsroom for others", () => {
  it("shows a Reporter their own stories, with their own moves only and no assignee filter", async () => {
    renderAuth(`${BOARD}?edition=any`, { preset: "sahyadri-reporter" });
    const user = userEvent.setup();
    expect(await screen.findByText("You see the stories you report or are given.")).toBeInTheDocument();
    await screen.findByRole("heading", { name: "Draft: 1" });
    expect(screen.getByRole("heading", { name: "Editing: 0" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Given to" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Move “बाजार समितीची निवडणूक रविवारी”" }));
    expect(within(screen.getByRole("menu")).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Send to the desk",
    ]);
    // a filed story is the desk's now: no menu
    expect(screen.queryByRole("button", { name: "Move “घाटात मान्सून लवकर दाखल”" })).toBeNull();
  });

  it("speaks Marathi", async () => {
    renderAuth(`${BOARD}?edition=any`, { preset: "sahyadri-editor", language: "mr" });
    expect(await screen.findByRole("heading", { level: 1, name: "वृत्तकक्ष" })).toBeInTheDocument();
    expect(await screen.findByRole("combobox", { name: "आवृत्ती" })).toBeInTheDocument();
  });
});
