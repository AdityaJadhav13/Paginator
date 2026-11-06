/**
 * The page editor, hosted (plan §1 L2.4), on the test double with a fictional page: the page opened with its lock, a
 * move sent as a set with the page's revision and snapped modules, undo and redo, swap, take off and bring in, a move to
 * another page, another layout, Update text, a save in the check's exact words, a stale change reloaded with a notice,
 * a page held by someone else (read-only, ask to take over, hand over), the story text panel, the board's "Edit page"
 * link, and axe on the screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, fireEvent, screen, waitFor, within } from "../../src/test/render.tsx";
import { createMockApplicationEnvironment } from "../../src/mocks/index.ts";
import type { EditChangeDto, EditorPageDto } from "../../src/services/index.ts";
import { HEARTBEAT_MS } from "../../src/features/editor/PageEditorScreen.tsx";
import { renderAuth, resetBrowserState, seriousViolations } from "../auth/helpers.tsx";

vi.setConfig({ testTimeout: 30_000 });

const ORG = "org-demo-sahyadri";
const PUB = "pub-demo-pune-daily";
const EDITION = "edition-demo-2026-10-24";
const RUN = "run-demo-001";
const EDIT = (page = 1) => `/org/${ORG}/pub/${PUB}/editions/${EDITION}/runs/${RUN}/pages/${page}/edit`;
const OTHER = { id: "01900000-0000-7000-8000-000000000009", name: "Fictional Designer" };
const LEAD = "d0000000001";
const SECOND = "d0000000002";
const POOL = "d0000000003";

beforeEach(() => {
  // jsdom draws nothing: the canvas has no context and the outlines are kept as they come
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function open(options: { preset?: "sahyadri-editor" | "sahyadri-reporter"; page?: number } = {}) {
  const environment = createMockApplicationEnvironment();
  const original = environment.editor.change.bind(environment.editor);
  const change = vi.spyOn(environment.editor, "change");
  const rendered = renderAuth(EDIT(options.page), { preset: options.preset ?? "sahyadri-editor", environment });
  return { ...rendered, environment, change, original };
}

const sent = (change: ReturnType<typeof open>["change"], i = -1) => change.mock.calls.at(i)![0].change as EditChangeDto;
const modulesOf = (c: EditChangeDto) => (c.kind === "set" ? c.modules : []);
const ready = () => screen.findByRole("heading", { name: "Selected story" });
const onPage = () => within(screen.getByRole("region", { name: "On this page" }));
const select = async (name: RegExp) => userEvent.click(onPage().getByRole("button", { name }));
const canvas = () => screen.getByRole("application");

describe("opening a page", () => {
  it("opens the page with its lock, its stories, problems and history, and is axe clean", async () => {
    const { container } = open();
    expect(await screen.findByText("Opening the page…")).toBeInTheDocument();
    await ready();
    expect(screen.getByRole("heading", { level: 1, name: "Edit page 1" })).toBeInTheDocument();
    expect(screen.getByText("Page 1 · Front page")).toBeInTheDocument();
    expect(
      onPage()
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["“गुरुवारी पाणीपुरवठा बंद”", "“Fictional market report”"]);
    expect(screen.getByText("No problems: every story fits and nothing overlaps.")).toBeInTheDocument();
    expect(screen.getByText("No change yet: the page is as the layout made it.")).toBeInTheDocument();
    expect(screen.getByText("Use a larger screen to edit pages.")).toBeInTheDocument();
    expect(canvas()).toHaveAccessibleName(/^The page\. Click a story to select it/);
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("keeps the lock alive every 30 seconds and lets it go on leaving", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const environment = createMockApplicationEnvironment();
    const heartbeat = vi.spyOn(environment.editor, "heartbeat");
    const release = vi.spyOn(environment.editor, "release");
    const { unmount } = renderAuth(EDIT(), { preset: "sahyadri-editor", environment });
    await ready();
    await act(() => vi.advanceTimersByTimeAsync(HEARTBEAT_MS));
    expect(heartbeat).toHaveBeenCalledTimes(1);
    unmount();
    expect(release).toHaveBeenCalledWith({ orgId: ORG, pubId: PUB, runId: RUN, page: 1 });
  });

  it("shows a page in the problems' own words, each selecting its story", async () => {
    const environment = createMockApplicationEnvironment();
    const real = environment.editor.open.bind(environment.editor);
    vi.spyOn(environment.editor, "open").mockImplementation(async (input) => {
      const r = await real(input);
      if (!r.ok) return r;
      const view = {
        ...r.value.view,
        problems: [
          { kind: "overlap", stories: [LEAD, SECOND], mm: 4.2 },
          { kind: "overset", stories: [SECOND], lines: 1, words: 0 },
          { kind: "empty", stories: [], mm2: 1260 },
        ],
      };
      return { ok: true, value: { ...r.value, view } };
    });
    renderAuth(EDIT(), { preset: "sahyadri-editor", environment });
    const problems = within(await screen.findByRole("region", { name: "Problems" }));
    await userEvent.click(
      problems.getByRole("button", {
        name: "“गुरुवारी पाणीपुरवठा बंद” and “Fictional market report” overlap by 4 mm.",
      }),
    );
    expect(onPage().getByRole("button", { name: "“गुरुवारी पाणीपुरवठा बंद”" })).toHaveAttribute("aria-pressed", "true");
    expect(
      problems.getByRole("button", {
        name: "“Fictional market report”: 1 line of text does not fit and would not print.",
      }),
    ).toBeInTheDocument();
    expect(problems.getByText("About 13 cm² of the news area is empty.")).toBeInTheDocument();
  });

  it("a person without layout.edit sees the page read-only, never taking its lock", async () => {
    const environment = createMockApplicationEnvironment();
    const opened = vi.spyOn(environment.editor, "open");
    const got = vi.spyOn(environment.editor, "get");
    renderAuth(EDIT(), { preset: "sahyadri-reporter", environment });
    await ready();
    expect(opened).not.toHaveBeenCalled();
    expect(got).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save page" })).toBeDisabled();
  });
});

describe("changing the page", () => {
  it("a move is sent as a set with the page's revision and the modules snapped to the grid", async () => {
    const { change } = open();
    await ready();
    await select(/गुरुवारी/);
    canvas().focus();
    await userEvent.keyboard("{ArrowRight}");
    await waitFor(() => expect(change).toHaveBeenCalledTimes(1));
    const c = sent(change);
    expect(c).toMatchObject({ kind: "set", rev: 0 });
    expect(modulesOf(c).find((m) => m.story === LEAD)).toMatchObject({ x: 65, y: 60, w: 4, h: 120 });
    expect(await screen.findByText("Changed, not saved")).toBeInTheDocument();
    // the next change carries the new revision; Shift+arrow changes the size
    await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
    await waitFor(() => expect(change).toHaveBeenCalledTimes(2));
    expect(sent(change)).toMatchObject({ rev: 1 });
    expect(modulesOf(sent(change)).find((m) => m.story === LEAD)).toMatchObject({ x: 65, h: 125 });
  });

  it("sends one change at a time: a newer change replaces one still waiting", async () => {
    const { change, original: real } = open();
    await ready();
    let answer: () => void = () => {};
    change.mockImplementationOnce(async (input) => {
      await new Promise<void>((done) => (answer = done));
      return real(input);
    });
    await select(/गुरुवारी/);
    canvas().focus();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
    expect(change).toHaveBeenCalledTimes(1);
    await act(async () => answer());
    await waitFor(() => expect(change).toHaveBeenCalledTimes(2));
    expect(sent(change, 0)).toMatchObject({ rev: 0 });
    expect(modulesOf(sent(change, 0)).find((m) => m.story === LEAD)).toMatchObject({ y: 65 });
    expect(sent(change, 1)).toMatchObject({ rev: 1 }); // the third, the second never sent
    expect(modulesOf(sent(change, 1)).find((m) => m.story === LEAD)).toMatchObject({ y: 75 });
    await screen.findByText("Changed, not saved");
    expect(change).toHaveBeenCalledTimes(2);
  });

  it("undo and redo send the page's earlier and later module lists (Ctrl+Z, Shift+Ctrl+Z)", async () => {
    const { change } = open();
    await ready();
    await select(/गुरुवारी/);
    canvas().focus();
    await userEvent.keyboard("{ArrowRight}");
    await waitFor(() => expect(change).toHaveBeenCalledTimes(1));
    await screen.findByText("Changed, not saved");
    await userEvent.keyboard("{Control>}z{/Control}");
    await waitFor(() => expect(change).toHaveBeenCalledTimes(2));
    expect(sent(change)).toMatchObject({ kind: "set", rev: 1 });
    expect(modulesOf(sent(change)).find((m) => m.story === LEAD)).toMatchObject({ x: 15 });
    await waitFor(() => expect(screen.getByRole("button", { name: "Redo" })).toBeEnabled());
    await userEvent.keyboard("{Shift>}{Control>}z{/Control}{/Shift}");
    await waitFor(() => expect(change).toHaveBeenCalledTimes(3));
    expect(sent(change)).toMatchObject({ rev: 2 });
    expect(modulesOf(sent(change)).find((m) => m.story === LEAD)).toMatchObject({ x: 65 });
    await waitFor(() => expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(change).toHaveBeenCalledTimes(4));
    expect(modulesOf(sent(change)).find((m) => m.story === LEAD)).toMatchObject({ x: 15 });
  });

  it("swaps two stories' places", async () => {
    const { change } = open();
    await ready();
    await select(/गुरुवारी/);
    await userEvent.click(screen.getByRole("button", { name: "Swap with…" }));
    expect(screen.getByText(/Click the story to swap with/)).toBeInTheDocument();
    await userEvent.click(onPage().getByRole("button", { name: "Swap with this: “Fictional market report”" }));
    await waitFor(() => expect(change).toHaveBeenCalledTimes(1));
    const mods = modulesOf(sent(change));
    expect(mods.find((m) => m.story === LEAD)).toMatchObject({ x: 215, w: 2 });
    expect(mods.find((m) => m.story === SECOND)).toMatchObject({ x: 15, w: 4 });
  });

  it("takes a story off the page and brings one in from the stories not on it", async () => {
    const { change } = open();
    await ready();
    const pool = within(screen.getByRole("region", { name: "Not on this page" }));
    expect(pool.getByText("“Fictional brief left over”")).toBeInTheDocument();
    await userEvent.click(pool.getByRole("button", { name: "Bring in" }));
    await waitFor(() => expect(change).toHaveBeenCalledTimes(1));
    expect(modulesOf(sent(change)).find((m) => m.story === POOL)).toMatchObject({ x: 15, y: 60, w: 2, h: 90 });
    await waitFor(() => expect(screen.getByRole("button", { name: "Take off the page" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Take off the page" }));
    await waitFor(() => expect(change).toHaveBeenCalledTimes(2));
    expect(modulesOf(sent(change)).map((m) => m.story)).toEqual([LEAD, SECOND]);
  });

  it("refuses to move a locked story, saying why, and sends nothing", async () => {
    const { change } = open();
    await ready();
    await select(/गुरुवारी/);
    await userEvent.click(screen.getByRole("button", { name: "Lock in place" }));
    await waitFor(() => expect(change).toHaveBeenCalledTimes(1));
    expect(modulesOf(sent(change)).find((m) => m.story === LEAD)).toMatchObject({ locked: true });
    await waitFor(() => expect(screen.getByRole("button", { name: "Unlock" })).toBeEnabled());
    canvas().focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(
      await screen.findByText("“गुरुवारी पाणीपुरवठा बंद” is locked: unlock it to move it or change its size."),
    ).toBeInTheDocument();
    expect(change).toHaveBeenCalledTimes(1);
  });

  it("moves a story to another page of the run", async () => {
    const { change } = open();
    await ready();
    await select(/Fictional market/);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Move to page" }), "2");
    await userEvent.click(screen.getByRole("button", { name: "Move" }));
    await waitFor(() => expect(change).toHaveBeenCalledTimes(1));
    expect(sent(change)).toEqual({ kind: "move", rev: 0, story: SECOND, to: 2 });
    expect(await screen.findByText(/“Fictional market report” moved to page 2\./)).toBeInTheDocument();
    expect(onPage().getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
  });

  it("tries another layout, variant by variant, and updates the text", async () => {
    const { change } = open();
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "Try another layout" }));
    await waitFor(() => expect(change).toHaveBeenCalledTimes(1));
    expect(sent(change)).toEqual({ kind: "alternative", rev: 0, variant: 1 });
    expect(await screen.findByText("Lead on the other side. Undo brings back the last one.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try another layout" }));
    await waitFor(() => expect(change).toHaveBeenCalledTimes(2));
    expect(sent(change)).toEqual({ kind: "alternative", rev: 1, variant: 2 });
    await screen.findByText(/Lead at another width\./);
    await userEvent.click(screen.getByRole("button", { name: "Update text" }));
    await waitFor(() => expect(change).toHaveBeenCalledTimes(3));
    expect(sent(change)).toEqual({ kind: "refresh", rev: 2 });
    expect(await screen.findByText(/The stories' current text is set on the page\./)).toBeInTheDocument();
  });

  it("saves the page and says the independent check's verdict in the plan's words", async () => {
    const { environment } = open();
    const save = vi.spyOn(environment.editor, "save");
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "Save page" }));
    expect(save).toHaveBeenCalledWith({ orgId: ORG, pubId: PUB, runId: RUN, page: 1, rev: 0 });
    expect(await screen.findByText("Independent PDF/X-1a check: passed (1 warning)")).toBeInTheDocument();
    expect(screen.getByText("Fictional warning.")).toBeInTheDocument();
    expect(await screen.findByText(/Revision 1: saved/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/press-ready|PDF\/X-valid/i);
  });

  it("a failed check and a step after the export that failed are said too", async () => {
    const environment = createMockApplicationEnvironment();
    const real = environment.editor.save.bind(environment.editor);
    vi.spyOn(environment.editor, "save").mockImplementation(async (input) => {
      const r = await real(input);
      if (!r.ok) return r;
      const value: EditorPageDto = {
        ...r.value,
        pageState: { ...r.value.pageState, check: { passed: false, fails: 3, warnings: 0 } },
        saved: {
          ...r.value.saved!,
          error: { text: "The edition PDF could not be put together.", code: null, params: null },
          stale: [{ text: "A story changed after this page was set.", code: null, params: null }],
        },
      };
      return { ok: true, value };
    });
    renderAuth(EDIT(), { preset: "sahyadri-editor", environment });
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "Save page" }));
    expect(await screen.findByText("Independent PDF/X-1a check: failed (3 problems)")).toBeInTheDocument();
    expect(screen.getByText("The edition PDF could not be put together.")).toBeInTheDocument();
    expect(screen.getByText("A story changed after this page was set.")).toBeInTheDocument();
  });

  it("a change on an older revision (409 stale) shows the page as it is now, with a notice", async () => {
    const { environment, change } = open();
    await ready();
    const now = await environment.editor.get({ orgId: ORG, pubId: PUB, runId: RUN, page: 1 });
    const current = { ...(now.ok ? now.value : ({} as EditorPageDto)), rev: 5 };
    const view = current.view as { modules: { story: string }[] };
    current.view = { ...view, rev: 5, modules: view.modules.filter((m) => m.story === LEAD) };
    change.mockResolvedValueOnce({
      ok: false,
      error: { kind: "answer", status: 409, code: "stale", message: "", current },
    });
    await userEvent.click(screen.getByRole("button", { name: "Try another layout" }));
    expect(await screen.findByText(/The page changed meanwhile/)).toBeInTheDocument();
    expect(onPage().getAllByRole("button")).toHaveLength(1);
    await select(/गुरुवारी/);
    canvas().focus();
    await userEvent.keyboard("{ArrowRight}");
    await waitFor(() => expect(change).toHaveBeenCalledTimes(2));
    expect(sent(change)).toMatchObject({ kind: "set", rev: 5 });
  });
});

describe("one person at a time", () => {
  const heldBy = (page: EditorPageDto, lock: Partial<EditorPageDto["lock"]>): EditorPageDto => ({
    ...page,
    lock: { ...page.lock, ...lock },
  });

  it("a page changed here that another page's save took a story from says Needs saving and why, as the Desk", async () => {
    const environment = createMockApplicationEnvironment();
    const real = environment.editor.open.bind(environment.editor);
    const why = { text: "A story moved from this page to page 3: open it, fill the space and save it.", code: null, params: null };
    vi.spyOn(environment.editor, "open").mockImplementation(async (input) => {
      const r = await real(input);
      if (!r.ok) return r;
      const older = { text: "An article on this page was changed since the page's PDF was made.", code: null, params: null };
      const pageState = { ...r.value.pageState, editedUnsaved: true, needsSave: true, needsSaveReason: why, stale: [older] };
      return { ok: true, value: { ...r.value, pageState } };
    });
    renderAuth(EDIT(), { preset: "sahyadri-editor", environment });
    expect(await screen.findByText("Needs saving")).toBeInTheDocument();
    expect(screen.getByText(why.text)).toBeInTheDocument();
    expect(screen.getByText("An article on this page was changed since the page's PDF was made.")).toBeInTheDocument();
    expect(screen.queryByText("Changed, not saved")).not.toBeInTheDocument();
  });

  it("a page someone else holds is read-only, with Ask to take over", async () => {
    const environment = createMockApplicationEnvironment();
    const real = environment.editor.open.bind(environment.editor);
    vi.spyOn(environment.editor, "open").mockImplementation(async (input) => {
      const r = await real(input);
      return r.ok ? { ok: true, value: heldBy(r.value, { holder: OTHER, mine: false }) } : r;
    });
    const takeover = vi
      .spyOn(environment.editor, "takeover")
      .mockResolvedValue({ ok: true, value: { holder: OTHER, mine: false, expiresAt: null, askedBy: null } });
    const { container } = renderAuth(EDIT(), { preset: "sahyadri-editor", environment });
    expect(
      await screen.findByText("Fictional Designer is editing this page. You can look at it, not change it."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Try another layout" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Ask to take over" }));
    expect(takeover).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText("Asked. The page is yours if Fictional Designer does not answer within 30 seconds."),
    ).toBeInTheDocument();
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("a change refused because another person took the page (409 page_locked) shows them holding it", async () => {
    const { environment, change } = open();
    await ready();
    const real = environment.editor.get.bind(environment.editor);
    vi.spyOn(environment.editor, "get").mockImplementation(async (input) => {
      const r = await real(input);
      return r.ok ? { ok: true, value: heldBy(r.value, { holder: OTHER, mine: false }) } : r;
    });
    change.mockResolvedValueOnce({
      ok: false,
      error: { kind: "answer", status: 409, code: "page_locked", message: "" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Update text" }));
    expect(
      await screen.findByText("Another person holds this page now: your change was not made."),
    ).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Ask to take over" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save page" })).toBeDisabled();
  });

  it("the holder sees who asks to take over and can hand over", async () => {
    const environment = createMockApplicationEnvironment();
    const real = environment.editor.open.bind(environment.editor);
    vi.spyOn(environment.editor, "open").mockImplementation(async (input) => {
      const r = await real(input);
      return r.ok ? { ok: true, value: heldBy(r.value, { askedBy: OTHER }) } : r;
    });
    const release = vi.spyOn(environment.editor, "release");
    renderAuth(EDIT(), { preset: "sahyadri-editor", environment });
    expect(await screen.findByText("Fictional Designer asks to take over this page.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Hand over" }));
    expect(release).toHaveBeenCalledWith({ orgId: ORG, pubId: PUB, runId: RUN, page: 1 });
  });
});

describe("the story text panel", () => {
  it("saves the story's text as a new revision, then sets the page with it", async () => {
    const { environment, change } = open();
    const update = vi.spyOn(environment.stories, "update");
    await ready();
    await select(/गुरुवारी/);
    const panel = within(screen.getByRole("region", { name: "Story text" }));
    const headline = await panel.findByRole("textbox", { name: "Headline" });
    expect(headline.tagName).toBe("INPUT");
    expect(panel.getByRole("textbox", { name: "Body text" }).tagName).toBe("TEXTAREA");
    await userEvent.type(headline, " (fictional)");
    await userEvent.click(panel.getByRole("button", { name: "Save text and update the page" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const call = update.mock.calls[0]![0];
    expect(call.storyId).toBe("story-demo-004");
    expect(call.patch).toMatchObject({ headline: expect.stringMatching(/\(fictional\)$/) as string });
    expect(typeof call.patch.baseRevision).toBe("number");
    await waitFor(() => expect(change).toHaveBeenCalledTimes(1));
    expect(sent(change)).toEqual({ kind: "refresh", rev: 0 });
  });

  it("a story the run does not map to the newsroom is shown read-only", async () => {
    open();
    await ready();
    await select(/Fictional market/);
    expect(
      await screen.findByText("This story's text cannot be changed here: open it from Stories."),
    ).toBeInTheDocument();
  });
});

describe("the Pages board", () => {
  it("links each done page to the editor", async () => {
    URL.createObjectURL = vi.fn(() => "blob:fictional"); // the page thumbnails
    URL.revokeObjectURL = vi.fn();
    renderAuth(`/org/${ORG}/pub/${PUB}/editions/${EDITION}/layout?tab=pages`, { preset: "sahyadri-editor" });
    const link = await screen.findByRole("link", { name: "Edit page 1" });
    expect(link).toHaveAttribute("href", EDIT(1));
    expect(screen.queryByRole("link", { name: "Edit page 6" })).toBeNull(); // page 6 failed
  });
});

describe("the fix pass (L2.4 review)", () => {
  const held = (change: ReturnType<typeof open>["change"], real: ReturnType<typeof open>["original"]) => {
    let answer: () => void = () => {};
    change.mockImplementationOnce(async (input) => {
      await new Promise<void>((done) => (answer = done));
      return real(input);
    });
    return () => act(async () => answer());
  };

  it("a waiting change gives way to a newer one only when both lock the same stories at the same places", async () => {
    const { change, original } = open();
    await ready();
    const release = held(change, original);
    await select(/गुरुवारी/);
    canvas().focus();
    await userEvent.keyboard("{ArrowDown}"); // on its way
    await userEvent.click(screen.getByRole("button", { name: "Lock in place" })); // waits
    await select(/Fictional market/);
    canvas().focus();
    await userEvent.keyboard("{ArrowDown}"); // waits too: the lock before it must reach the engine first
    expect(change).toHaveBeenCalledTimes(1);
    await release();
    await waitFor(() => expect(change).toHaveBeenCalledTimes(3));
    expect(modulesOf(sent(change, 1)).find((m) => m.story === LEAD)).toMatchObject({ locked: true });
    expect(modulesOf(sent(change, 1)).find((m) => m.story === SECOND)).toMatchObject({ y: 60 });
    expect(sent(change, 2)).toMatchObject({ rev: 2 });
    expect(modulesOf(sent(change, 2)).find((m) => m.story === SECOND)).toMatchObject({ y: 65 });
  });

  it("Update after a text save waits for the changes on their way, then runs", async () => {
    const { change, original } = open();
    await ready();
    const release = held(change, original);
    await select(/गुरुवारी/);
    canvas().focus();
    await userEvent.keyboard("{ArrowDown}");
    const panel = within(screen.getByRole("region", { name: "Story text" }));
    await userEvent.type(await panel.findByRole("textbox", { name: "Headline" }), "!");
    await userEvent.click(panel.getByRole("button", { name: "Save text and update the page" }));
    expect(await panel.findByText(/saved/i)).toBeInTheDocument();
    expect(change).toHaveBeenCalledTimes(1);
    await release();
    await waitFor(() => expect(change).toHaveBeenCalledTimes(2));
    expect(sent(change)).toEqual({ kind: "refresh", rev: 1 });
  });

  it("after 409 story_changed only the typed field is sent, the other shows the story as it is now", async () => {
    const { environment } = open();
    const update = vi.spyOn(environment.stories, "update");
    await ready();
    await select(/गुरुवारी/);
    const panel = within(screen.getByRole("region", { name: "Story text" }));
    const headline = await panel.findByRole("textbox", { name: "Headline" });
    const now = await environment.stories.get({ orgId: ORG, pubId: PUB, storyId: "story-demo-004" });
    if (!now.ok) throw new Error("no story");
    const theirs = { ...now.value, revision: now.value.revision + 1, body: "Their fictional body." };
    update.mockResolvedValueOnce({
      ok: false,
      error: { kind: "answer", status: 409, code: "story_changed", message: "", current: theirs },
    });
    await userEvent.type(headline, " (mine)");
    await userEvent.click(panel.getByRole("button", { name: "Save text and update the page" }));
    expect(await panel.findByText(/Someone changed this story meanwhile/)).toBeInTheDocument();
    expect(update.mock.calls[0]![0].patch).toEqual({
      baseRevision: now.value.revision,
      headline: `${now.value.headline} (mine)`,
    });
    expect(panel.getByRole("textbox", { name: "Body text" })).toHaveValue("Their fictional body.");
    expect(headline).toHaveValue(`${now.value.headline} (mine)`);
    await userEvent.click(panel.getByRole("button", { name: "Save text and update the page" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1]![0].patch).toEqual({
      baseRevision: theirs.revision,
      headline: `${now.value.headline} (mine)`,
    });
  });

  it("typing not saved is kept when another story is selected and this one again", async () => {
    open();
    await ready();
    await select(/गुरुवारी/);
    let panel = within(screen.getByRole("region", { name: "Story text" }));
    await userEvent.type(await panel.findByRole("textbox", { name: "Headline" }), " draft");
    await select(/Fictional market/);
    await select(/गुरुवारी/);
    panel = within(screen.getByRole("region", { name: "Story text" }));
    expect(((await panel.findByRole("textbox", { name: "Headline" })) as HTMLInputElement).value).toMatch(/ draft$/);
  });

  it("a refused change is said in the engine's own words", async () => {
    const { change } = open();
    await ready();
    change.mockResolvedValueOnce({
      ok: false,
      error: {
        kind: "answer",
        status: 400,
        code: "edit_refused",
        message: "",
        current: { text: "Fictional refusal: the story would leave the news area.", code: null, params: null },
      },
    });
    await userEvent.click(screen.getByRole("button", { name: "Try another layout" }));
    expect(await screen.findByText("Fictional refusal: the story would leave the news area.")).toBeInTheDocument();
    expect(screen.getByText("The layout engine refused this change.")).toBeInTheDocument();
  });

  it("the editor away (503 editor_unavailable) says so, not that something went wrong", async () => {
    const environment = createMockApplicationEnvironment();
    vi.spyOn(environment.editor, "open").mockResolvedValue({
      ok: false,
      error: { kind: "answer", status: 503, code: "editor_unavailable", message: "" },
    });
    renderAuth(EDIT(), { preset: "sahyadri-editor", environment });
    expect(
      await screen.findByText("The page editor is not available just now. Try again in a minute."),
    ).toBeInTheDocument();
  });

  it("an answer older than the page shown is ignored; one without the drawn page keeps it and asks again", async () => {
    const { environment, change, original } = open();
    await ready();
    await select(/गुरुवारी/);
    canvas().focus();
    await userEvent.keyboard("{ArrowRight}");
    await screen.findByText("Changed, not saved"); // rev 1
    const old = await original({ orgId: ORG, pubId: PUB, runId: RUN, page: 1, change: { kind: "refresh", rev: 1 } });
    if (!old.ok) throw new Error("no page");
    const stripped = { ...old.value.view } as Record<string, unknown>;
    delete stripped["items"];
    change.mockResolvedValueOnce({ ok: true, value: { ...old.value, view: stripped } });
    const get = vi.spyOn(environment.editor, "get");
    await userEvent.click(screen.getByRole("button", { name: "Try another layout" }));
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByText(/This page cannot be shown/)).not.toBeInTheDocument();
    expect(onPage().getAllByRole("button")).toHaveLength(2);
    // an older revision of the page arriving late changes nothing
    change.mockResolvedValueOnce({
      ok: true,
      value: { ...old.value, rev: 0, view: { ...old.value.view, modules: [] } },
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Try another layout" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Try another layout" }));
    await waitFor(() => expect(change).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.getByRole("button", { name: "Try another layout" })).toBeEnabled());
    expect(onPage().getAllByRole("button")).toHaveLength(2);
  });

  it("a double click on Try another layout sends one change", async () => {
    const { change } = open();
    await ready();
    const another = screen.getByRole("button", { name: "Try another layout" });
    act(() => {
      fireEvent.click(another); // the second before the screen has caught up
      fireEvent.click(another);
    });
    expect(await screen.findByText(/Lead on the other side/)).toBeInTheDocument();
    expect(change).toHaveBeenCalledTimes(1);
  });

  it("lets the page go when the browser leaves it (pagehide)", async () => {
    const { environment } = open();
    const release = vi.spyOn(environment.editor, "release");
    await ready();
    window.dispatchEvent(new Event("pagehide"));
    expect(release).toHaveBeenCalledWith({ orgId: ORG, pubId: PUB, runId: RUN, page: 1 });
  });

  it("under 900 px the page is neither opened nor locked", async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    try {
      const { environment } = open();
      const opened = vi.spyOn(environment.editor, "open");
      expect(await screen.findByText("Use a larger screen to edit pages.")).toBeInTheDocument();
      await act(() => new Promise((done) => setTimeout(done, 50)));
      expect(opened).not.toHaveBeenCalled();
      expect(screen.queryByRole("application")).not.toBeInTheDocument();
    } finally {
      window.matchMedia = original;
    }
  });
});
