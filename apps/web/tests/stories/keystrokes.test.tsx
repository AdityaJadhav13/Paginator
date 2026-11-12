/**
 * The story editor never loses or changes a keystroke (the L2-H verification's findings 1–12, each reproduced here on
 * the test double, which cleans text and checks Idempotency-Keys as the API does):
 *   1 the API's cleaned text never rewrites a box being edited;  2 a save asked for during another runs after it, and
 *   a move waits for it;  3 leaving sends what waits, and the browser asks first;  4 creating keeps the screen and the
 *   focus;  5 the conflict choice is not raced by autosave;  6 "Keep my version" is a three-way merge, every differing
 *   field shown;  7 restoring a draft applies only its changes;  8, 9 the boxes take no typing while a question is
 *   open or a move is made;  10 an Idempotency-Key is retried only with its first body;  11 sign-out and drafts;
 *   12 the double answers like the API. Fictional data only.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, fireEvent, screen, waitFor, within } from "../../src/test/render.tsx";
import { createMockApplicationEnvironment, type MockApplicationEnvironment } from "../../src/mocks/index.ts";
import { DRAFTS_PREFIX, SIGNED_OUT_KEY, readDraft, writeDraft } from "../../src/features/stories/drafts.ts";
import type { StoryDto } from "../../src/services/index.ts";
import { currentLocation, renderAuth, resetBrowserState } from "../auth/helpers.tsx";

// autosave waits 1.5 s, and saves queue: under a full parallel run these need more than the default 5 s
vi.setConfig({ testTimeout: 30_000 });

const ORG = "org-demo-sahyadri";
const PUB = "pub-demo-pune-daily";
const STORIES = `/org/${ORG}/pub/${PUB}/stories`;
const at = (id: string) => `${STORIES}/${id}`;
const REPORTER = "user-demo-sahyadri-reporter";
const SLOW = { timeout: 10_000 };

afterEach(() => {
  resetBrowserState();
  vi.restoreAllMocks();
});

async function storyOf(environment: MockApplicationEnvironment, storyId: string): Promise<StoryDto> {
  const result = await environment.stories.get({ orgId: ORG, pubId: PUB, storyId });
  if (!result.ok) throw new Error("no story");
  return result.value;
}

/** Holds every update until released: a save in flight. */
function holdUpdates(environment: MockApplicationEnvironment) {
  const original = environment.stories.update.bind(environment.stories);
  let release: () => void = () => undefined;
  let held = new Promise<void>((resolve) => (release = resolve));
  const spy = vi.spyOn(environment.stories, "update").mockImplementation(async (input) => {
    await held;
    return original(input);
  });
  return {
    spy,
    release: () => {
      release();
      held = Promise.resolve();
    },
  };
}

const body = () => screen.getByLabelText("Body text") as HTMLTextAreaElement;

describe("1. The API's cleaned text never rewrites a box being edited", () => {
  it("keeps a space and a new line typed before a pause, and an NFC-changed word as typed", async () => {
    const { environment } = renderAuth(at("story-demo-002"), { preset: "sahyadri-reporter" });
    const user = userEvent.setup();
    const box = await screen.findByLabelText("Body text");
    await user.clear(box);
    await user.type(box, "Hello ");
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument(), SLOW);
    expect((await storyOf(environment, "story-demo-002")).body).toBe("Hello"); // the API strips it…
    expect(body().value).toBe("Hello "); // …the box keeps it
    await user.type(box, "world{enter}");
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument(), SLOW);
    expect(body().value).toBe("Hello world\n");
    await user.type(box, "Para two");
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument(), SLOW);
    expect(body().value).toBe("Hello world\nPara two");
    expect((await storyOf(environment, "story-demo-002")).body).toBe("Hello world\nPara two");

    // क + nukta, as an input method may send it: NFC makes one letter of it on the server, never in the box
    const decomposed = " क़ाद्री";
    fireEvent.change(box, { target: { value: `${body().value}${decomposed}` } });
    fireEvent.blur(box);
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument(), SLOW);
    expect(body().value).toBe(`Hello world\nPara two${decomposed}`);
    expect((await storyOf(environment, "story-demo-002")).body).toBe(`Hello world\nPara two${decomposed.normalize("NFC")}`);
  });
});

describe("2. A save asked for during another runs after it", () => {
  it("sends text typed during an in-flight save without another keystroke, and a move waits for it", async () => {
    const environment = createMockApplicationEnvironment();
    const hold = holdUpdates(environment);
    renderAuth(at("story-demo-002"), { preset: "sahyadri-reporter", environment });
    const user = userEvent.setup();
    const box = await screen.findByLabelText("Body text");
    await user.type(box, " one two");
    await waitFor(() => expect(hold.spy).toHaveBeenCalledTimes(1), SLOW); // save 1 in flight
    await user.type(box, " three four five");
    await new Promise((resolve) => setTimeout(resolve, 1700)); // the timer fires while save 1 waits
    await user.click(screen.getByRole("button", { name: "Send to the desk" })); // a move during the save
    expect(screen.getByText("Moving the story…")).toBeInTheDocument();
    expect(box).toHaveAttribute("readonly");
    hold.release();
    expect(await screen.findByText("The story is now: Filed.", {}, SLOW)).toBeInTheDocument();
    const story = await storyOf(environment, "story-demo-002");
    expect(story.body.endsWith(" one two three four five")).toBe(true);
    expect(story.status).toBe("filed");
    expect(body().value.endsWith(" one two three four five")).toBe(true);
  }, 10_000);
});

describe("3. Leaving sends what waits", () => {
  it("saves on leaving the screen within the pause, on pagehide with keepalive, and asks before closing", async () => {
    const environment = createMockApplicationEnvironment();
    const update = vi.spyOn(environment.stories, "update");
    const view = renderAuth(at("story-demo-002"), { preset: "sahyadri-reporter", environment });
    const user = userEvent.setup();
    const box = await screen.findByLabelText("Body text");
    await user.type(box, " पहिले");
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true); // something unsaved: the browser asks
    window.dispatchEvent(new Event("pagehide"));
    await waitFor(() => expect(update).toHaveBeenCalledWith(expect.objectContaining({ keepalive: true })));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument(), SLOW);
    const calm = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(calm);
    expect(calm.defaultPrevented).toBe(false);

    await user.type(box, " दुसरे");
    view.unmount(); // within the 1.5 s pause
    await waitFor(async () => expect((await storyOf(environment, "story-demo-002")).body).toContain("पहिले दुसरे"));
  });
});

describe("4. Creating a story keeps the screen, the boxes and the focus", () => {
  it("does not remount or move the focus, and keeps what was typed while the create was in flight", async () => {
    // the workspace takes a moment to resolve, as the real one does: a re-resolution would unmount the editor
    const environment = createMockApplicationEnvironment({ delay: () => new Promise<void>((resolve) => setTimeout(resolve, 30)) });
    environment.scenarios.setScenario({ mode: "latency", delayMs: 30, operations: ["organization.list"] });
    const original = environment.stories.create.bind(environment.stories);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(environment.stories, "create").mockImplementation(async (input) => {
      await held;
      return original(input);
    });
    const { container } = renderAuth(`${STORIES}/new`, { preset: "sahyadri-reporter", environment });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Headline"), "Fictional fair");
    await user.click(screen.getByLabelText("Body text")); // leaving the headline: the create goes
    await user.type(screen.getByLabelText("Body text"), "Typed while it was created.");
    const theBox = screen.getByLabelText("Body text");
    act(() => release());
    await waitFor(() => expect(currentLocation(container).pathname).toMatch(/\/stories\/story-new-001$/));
    await new Promise((resolve) => setTimeout(resolve, 50)); // a remount, if any, would happen now
    expect(screen.getByLabelText("Body text")).toBe(theBox); // the same box: not remounted
    expect(document.activeElement).toBe(theBox);
    await user.type(screen.getByLabelText("Body text"), " And after.");
    expect(body().value).toBe("Typed while it was created. And after.");
    await waitFor(async () => expect((await storyOf(environment, "story-new-001")).body).toBe("Typed while it was created. And after."), SLOW);
    expect(screen.getByLabelText("Headline")).toHaveValue("Fictional fair");
  });
});

describe("5–6. The conflict: a three-way merge, chosen without a race", () => {
  it("shows every field that differs, and keeps their fields while putting mine on top on the first click", async () => {
    const environment = createMockApplicationEnvironment();
    environment.liveController.drop(true); // no live update reaches this screen: its next save meets their version
    renderAuth(at("story-demo-003"), { preset: "sahyadri-editor", environment });
    const user = userEvent.setup();
    const box = await screen.findByLabelText("Body text");
    // someone else changes the kicker and the byline meanwhile
    const now = await storyOf(environment, "story-demo-003");
    await environment.stories.update({ orgId: ORG, pubId: PUB, storyId: now.id, patch: { baseRevision: now.revision, kicker: "Their kicker", byline: "Their byline" } });
    await user.clear(box);
    await user.type(box, "My body.");
    await user.click(screen.getByLabelText("Kicker")); // the blur-save meets their version
    const panel = (await screen.findByRole("heading", { name: "Someone else changed this story" })).closest("section")!;
    for (const field of ["Kicker", "Byline", "Body text"]) {
      expect(within(panel).getByRole("heading", { name: field })).toBeInTheDocument();
    }
    expect(within(panel).getByText("Their kicker")).toBeInTheDocument();
    // 8: no typing while the question is open
    expect(screen.getByLabelText("Kicker")).toHaveAttribute("readonly");
    await user.click(within(panel).getByRole("button", { name: "Keep my version" }));
    expect(screen.queryByRole("heading", { name: "Someone else changed this story" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument(), SLOW);
    expect(await storyOf(environment, "story-demo-003")).toMatchObject({ body: "My body.", kicker: "Their kicker", byline: "Their byline" });
    expect(screen.getByLabelText("Kicker")).toHaveValue("Their kicker");
  });
});

describe("7. Restoring a draft applies only its changes", () => {
  it("merges a current draft onto newer fields, and sends a stale one through the conflict screen", async () => {
    const environment = createMockApplicationEnvironment();
    const opened = await storyOf(environment, "story-demo-002");
    const base = { headline: opened.headline, kicker: "", deck: "", byline: opened.byline, body: opened.body, priority: 3, pagePin: null, editionId: null, sectionId: null, deskNote: "", caption: "", credit: "" };
    // the draft changed only the body, on version 1; the server then got a new kicker (version 2)
    await environment.stories.update({ orgId: ORG, pubId: PUB, storyId: opened.id, patch: { baseRevision: 1, kicker: "Newer kicker" } });
    writeDraft(REPORTER, opened.id, { fields: { ...base, body: "Draft body." }, base, baseRevision: 1, savedAt: "2026-10-22T05:00:00.000Z" });
    renderAuth(at(opened.id), { preset: "sahyadri-reporter", environment });
    const user = userEvent.setup();
    expect(await screen.findByText("The story has been changed since then. Restoring puts your text over those changes.")).toBeInTheDocument();
    expect(screen.getByLabelText("Body text")).toHaveAttribute("readonly"); // 8: not while the question is open
    await user.click(screen.getByRole("button", { name: "Restore it" }));
    const panel = (await screen.findByRole("heading", { name: "Someone else changed this story" })).closest("section")!;
    await user.click(within(panel).getByRole("button", { name: "Keep my version" }));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument(), SLOW);
    expect(await storyOf(environment, opened.id)).toMatchObject({ body: "Draft body.", kicker: "Newer kicker" });
  });
});

describe("7b. A tab closed while a change was on its way", () => {
  it("knows the newer version as its own change, and restores the rest on top of it without a conflict", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setPreset("sahyadri-reporter");
    const opened = await storyOf(environment, "story-demo-002");
    const base = { headline: opened.headline, kicker: "", deck: "", byline: opened.byline, body: opened.body, priority: 3, pagePin: null, editionId: null, sectionId: null, deskNote: "", caption: "", credit: "" };
    const sending = { ...base, body: "closing the tab " };
    // the change arrived (version 2, cleaned), the tab was closed before its answer, with more typed after it
    await environment.stories.update({ orgId: ORG, pubId: PUB, storyId: opened.id, patch: { baseRevision: 1, body: sending.body } });
    writeDraft(REPORTER, opened.id, { fields: { ...base, body: "closing the tab right now" }, base, baseRevision: 1, sending, savedAt: "2026-10-22T05:00:00.000Z" });
    renderAuth(at(opened.id), { environment });
    const user = userEvent.setup();
    expect(await screen.findByText("Unsaved text on this device")).toBeInTheDocument();
    expect(screen.queryByText(/has been changed since then/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restore it" }));
    expect(screen.queryByRole("heading", { name: "Someone else changed this story" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument(), SLOW);
    expect((await storyOf(environment, opened.id)).body).toBe("closing the tab right now");
  });
});

describe("10. An Idempotency-Key is retried only with its first body", () => {
  it("retries a create whose answer was lost with the same key and body, then changes the rest: one story", async () => {
    const environment = createMockApplicationEnvironment();
    const original = environment.stories.create.bind(environment.stories);
    let lose = true;
    const create = vi.spyOn(environment.stories, "create").mockImplementation(async (input) => {
      const answer = await original(input); // made on the server…
      if (!lose) return answer;
      lose = false;
      return { ok: false, error: { kind: "network" } }; // …and the answer lost
    });
    renderAuth(`${STORIES}/new`, { preset: "sahyadri-reporter", environment });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Headline"), "Fictional once");
    await user.click(screen.getByLabelText("Body text"));
    expect(await screen.findByText("Your latest changes are not saved. They are kept on this device.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Body text"), "Typed after the lost answer.");
    await user.click(screen.getByLabelText("Headline"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument(), SLOW);
    const [first, second] = create.mock.calls.map(([input]) => input);
    expect(second!.idempotencyKey).toBe(first!.idempotencyKey);
    expect(second!.input).toEqual(first!.input);
    const listed = await environment.stories.list({ orgId: ORG, pubId: PUB, filter: { q: "Fictional once" } });
    expect(listed.ok && listed.value.items).toHaveLength(1);
    expect(await storyOf(environment, "story-new-001")).toMatchObject({ body: "Typed after the lost answer." });
  });

  it("keeps the create's key and body on this device, so a reload retries it rather than making a second story", async () => {
    const environment = createMockApplicationEnvironment();
    const original = environment.stories.create.bind(environment.stories);
    let lost = 0;
    // the answer is lost twice (the try, and the try as the screen is left); the browser is then closed
    vi.spyOn(environment.stories, "create").mockImplementation(async (input) => {
      const answer = await original(input);
      if (lost >= 2) return answer;
      lost += 1;
      return { ok: false, error: { kind: "network" } };
    });
    const first = renderAuth(`${STORIES}/new`, { preset: "sahyadri-reporter", environment });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Headline"), "Fictional reload");
    await user.click(screen.getByLabelText("Body text"));
    await screen.findByText("Your latest changes are not saved. They are kept on this device.");
    expect(readDraft(REPORTER, `new:${PUB}`)?.create?.input.headline).toBe("Fictional reload");
    first.unmount();
    await waitFor(() => undefined);
    renderAuth(`${STORIES}/new`, { environment });
    await user.click(await screen.findByRole("button", { name: "Restore it" }));
    await user.click(screen.getByLabelText("Body text"));
    await user.click(screen.getByLabelText("Headline"));
    const listed = await environment.stories.list({ orgId: ORG, pubId: PUB, filter: { q: "Fictional reload" } });
    await waitFor(() => expect(listed.ok && listed.value.items).toHaveLength(1));
  });

  it("answers 422 for a key reused with another body, as the API does", async () => {
    const environment = createMockApplicationEnvironment();
    const where = { orgId: ORG, pubId: PUB };
    expect((await environment.stories.create({ ...where, input: { headline: "A" }, idempotencyKey: "k" })).ok).toBe(true);
    expect((await environment.stories.create({ ...where, input: { headline: "A" }, idempotencyKey: "k" })).ok).toBe(true);
    expect(await environment.stories.create({ ...where, input: { headline: "B" }, idempotencyKey: "k" })).toMatchObject({
      ok: false,
      error: { status: 422, code: "idempotency_key_reused" },
    });
  });

  it("makes the send-back comment part of the move's key", async () => {
    const environment = createMockApplicationEnvironment();
    const transition = vi.spyOn(environment.stories, "transition");
    renderAuth(at("story-demo-001"), { preset: "sahyadri-editor", environment });
    const user = userEvent.setup();
    environment.sessionController.setProblem({ kind: "answer", status: 400, code: "invalid_request", message: "" }, ["stories.transition"]);
    await user.click(await screen.findByRole("button", { name: "Send back to the reporter" }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.type(dialog.getByLabelText("Why it goes back"), "First reason.");
    await user.click(dialog.getByRole("button", { name: "Send back to the reporter" }));
    await waitFor(() => expect(transition).toHaveBeenCalledTimes(1));
    environment.sessionController.setProblem(null, ["stories.transition"]);
    await user.clear(dialog.getByLabelText("Why it goes back"));
    await user.type(dialog.getByLabelText("Why it goes back"), "Second reason.");
    await user.click(dialog.getByRole("button", { name: "Send back to the reporter" }));
    expect(await screen.findByText("The story is now: Draft.")).toBeInTheDocument();
    const keys = transition.mock.calls.map(([input]) => input.idempotencyKey);
    expect(keys[1]).not.toBe(keys[0]);
  });
});

describe("11. Sign-out and the drafts on this device", () => {
  it("asks first when stories have unsaved text, and deletes it only after the sign-out succeeded", async () => {
    const environment = createMockApplicationEnvironment();
    writeDraft(REPORTER, "story-demo-002", {
      fields: { headline: "x", kicker: "", deck: "", byline: "", body: "Unsaved.", priority: 3, pagePin: null, editionId: null, sectionId: null, deskNote: "", caption: "", credit: "" },
      base: { headline: "x", kicker: "", deck: "", byline: "", body: "", priority: 3, pagePin: null, editionId: null, sectionId: null, deskNote: "", caption: "", credit: "" },
      baseRevision: 1,
      savedAt: "2026-10-22T05:00:00.000Z",
    });
    renderAuth(STORIES, { preset: "sahyadri-reporter", environment });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^Account:/ })); // Sign out sits in the account menu
    await user.click(await screen.findByRole("button", { name: "Sign out" }));
    const ask = within(await screen.findByRole("dialog", { name: "Unsaved text on this device" }));
    expect(ask.getByText("Stories with unsaved text on this device: 1. Signing out deletes that text.")).toBeInTheDocument();
    await user.click(ask.getByRole("button", { name: "Cancel" }));
    expect(window.localStorage.getItem(`${DRAFTS_PREFIX}${REPORTER}`)).not.toBeNull();

    // a sign-out that fails keeps them (the person is still signed in)
    environment.sessionController.setProblem({ kind: "network" }, ["session.signOut"]);
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Sign out anyway" }));
    expect(await screen.findByRole("heading", { level: 1, name: "You are signed in" })).toBeInTheDocument();
    expect(window.localStorage.getItem(`${DRAFTS_PREFIX}${REPORTER}`)).not.toBeNull();

    environment.sessionController.setProblem(null, ["session.signOut"]);
    await user.click(screen.getAllByRole("button", { name: "Sign out" })[0]!);
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Sign out anyway" }));
    await screen.findByRole("heading", { level: 1, name: "Sign in" });
    expect(window.localStorage.getItem(`${DRAFTS_PREFIX}${REPORTER}`)).toBeNull();
    // and nothing is written for that person again in this tab
    writeDraft(REPORTER, "late", { fields: {} as never, base: {} as never, baseRevision: null, savedAt: "" });
    expect(window.localStorage.getItem(`${DRAFTS_PREFIX}${REPORTER}`)).toBeNull();
  });

  it("stops keeping drafts and clears them when the person signs out in another tab", async () => {
    renderAuth(at("story-demo-002"), { preset: "sahyadri-reporter" });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Body text"), " in this tab");
    expect(window.localStorage.getItem(`${DRAFTS_PREFIX}${REPORTER}`)).not.toBeNull();
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: SIGNED_OUT_KEY, newValue: JSON.stringify({ userId: REPORTER, at: "x" }) }));
    });
    expect(window.localStorage.getItem(`${DRAFTS_PREFIX}${REPORTER}`)).toBeNull();
    fireEvent.change(screen.queryByLabelText("Body text") ?? document.body, { target: { value: "typed after" } });
    expect(window.localStorage.getItem(`${DRAFTS_PREFIX}${REPORTER}`)).toBeNull();
  });
});

describe("12. The double answers like the API", () => {
  it("cleans the text it keeps, so an answer can differ from what was sent", async () => {
    const environment = createMockApplicationEnvironment();
    const now = await storyOf(environment, "story-demo-002");
    const answer = await environment.stories.update({
      orgId: ORG,
      pubId: PUB,
      storyId: now.id,
      patch: { baseRevision: now.revision, body: "  one  \r\ntwo \u0007 " },
    });
    expect(answer).toMatchObject({ ok: true, value: { body: "one\ntwo" } });
  });
});
