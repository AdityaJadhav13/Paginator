/**
 * Comments, notifications and live updates on screen (plan §10 PR 23), on the test double, whose live double delivers
 * what the API's stream would to this browser's person: the comments panel (threads, post with one Idempotency-Key per
 * text, reply, change, resolve), the notifications drawer, live updates merged into the story editor without ever
 * rewriting a box being typed in or composed in (an input method), `resync` fetching afresh, the Stories list's notice,
 * and sign-out ending the stream. Marathi and axe. Fictional data only.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, fireEvent, screen, waitFor, within } from "../../src/test/render.tsx";
import { createMockApplicationEnvironment, type MockApplicationEnvironment } from "../../src/mocks/index.ts";
import { renderAuth, resetBrowserState, seriousViolations } from "../auth/helpers.tsx";
import { notificationLink, notificationText } from "../../src/features/live/Notifications.tsx";
import { translator } from "../../src/i18n/index.ts";

// autosave waits 1.5 s: under a full parallel run these need more than the default 5 s
vi.setConfig({ testTimeout: 30_000 });

const ORG = "org-demo-sahyadri";
const PUB = "pub-demo-pune-daily";
const STORIES = `/org/${ORG}/pub/${PUB}/stories`;
const at = (id: string) => `${STORIES}/${id}`;
const SLOW = { timeout: 10_000 };
/** The drawer's sentences for the reporter's fictional notifications: the story's headline and where it stands. */
const COMMENTED = "Sahyadri Demo Editor commented on “घाटात मान्सून लवकर दाखल”. It is now: Filed.";
const COMMENTED_002 = "Sahyadri Demo Editor commented on “बाजार समितीची निवडणूक रविवारी”. It is now: Draft.";
const GIVEN = "Sahyadri Demo Editor gave you the story “बाजार समितीची निवडणूक रविवारी”. It is now: Draft.";

afterEach(() => {
  resetBrowserState();
  vi.restoreAllMocks();
});

async function storyOf(environment: MockApplicationEnvironment, storyId: string) {
  const result = await environment.stories.get({ orgId: ORG, pubId: PUB, storyId });
  if (!result.ok) throw new Error("no story");
  return result.value;
}

/** Another person changes the story's fields, on another computer: this browser hears it once they are done. */
async function theyChange(environment: MockApplicationEnvironment, storyId: string, patch: Record<string, string>) {
  await act(() =>
    environment.sessionController.actAs("sahyadri-editor", async () => {
      const now = await storyOf(environment, storyId);
      const result = await environment.stories.update({ orgId: ORG, pubId: PUB, storyId, patch: { baseRevision: now.revision, ...patch } });
      if (!result.ok) throw new Error(`their change failed: ${result.error.kind}`);
    }),
  );
}

async function theyComment(environment: MockApplicationEnvironment, storyId: string, body: string) {
  await act(() =>
    environment.sessionController.actAs("sahyadri-editor", async () => {
      const result = await environment.comments.create({ orgId: ORG, pubId: PUB, storyId, body, idempotencyKey: `key-${body}` });
      if (!result.ok) throw new Error("their comment failed");
    }),
  );
}

describe("The comments panel", () => {
  it("shows the threads oldest first, a reply under its thread, and the resolved ones folded away", async () => {
    const { container } = renderAuth(at("story-demo-001"), { preset: "sahyadri-reporter" });
    const panel = within(await screen.findByRole("region", { name: "Comments (3)" }));
    expect(panel.getByText("पहिल्या पावसाची तारीख तपासा.")).toBeInTheDocument();
    expect(panel.getByRole("list", { name: "Replies to Sahyadri Demo Editor" })).toHaveTextContent("तपासतो, संध्याकाळपर्यंत कळवतो.");
    expect(panel.getByText("Resolved threads (1)").closest("details")).not.toHaveAttribute("open");
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("posts a comment once, with the same Idempotency-Key when a lost answer is retried", async () => {
    const environment = createMockApplicationEnvironment();
    const create = vi.spyOn(environment.comments, "create");
    renderAuth(at("story-demo-001"), { preset: "sahyadri-reporter", environment });
    const user = userEvent.setup();
    const panel = within(await screen.findByRole("region", { name: "Comments (3)" }));
    await user.click(panel.getByRole("button", { name: "Post the comment" }));
    expect(panel.getByText("Write something first.")).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();

    await user.type(panel.getByLabelText("Write a comment"), "तारीख 12 जून आहे.");
    environment.sessionController.setProblem({ kind: "network" }, ["comments.create"]);
    await user.click(panel.getByRole("button", { name: "Post the comment" }));
    expect(await panel.findByText("Pageinator cannot be reached")).toBeInTheDocument();
    environment.sessionController.setProblem(null, ["comments.create"]);
    await user.click(panel.getByRole("button", { name: "Post the comment" }));
    expect(await panel.findByText("Your comment is posted.")).toBeInTheDocument();
    expect(panel.getByText("तारीख 12 जून आहे.")).toBeInTheDocument();
    expect(panel.getByLabelText("Write a comment")).toHaveValue("");
    const keys = create.mock.calls.map(([input]) => input.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it("replies to a thread, changes the person's own comment, and resolves and reopens a thread", async () => {
    renderAuth(at("story-demo-001"), { preset: "sahyadri-reporter" });
    const user = userEvent.setup();
    const panel = within(await screen.findByRole("region", { name: "Comments (3)" }));
    await user.click(panel.getByRole("button", { name: "Reply to Sahyadri Demo Editor" }));
    await user.type(panel.getByLabelText("Your reply to Sahyadri Demo Editor"), "आणखी एक तपशील.");
    await user.click(panel.getByRole("button", { name: "Post the reply" }));
    expect(await panel.findByText("Your reply is posted.")).toBeInTheDocument();
    expect(panel.getByRole("list", { name: "Replies to Sahyadri Demo Editor" })).toHaveTextContent("आणखी एक तपशील.");

    // their own reply: they may change it
    const mine = panel.getByText("तपासतो, संध्याकाळपर्यंत कळवतो.").closest("article")!;
    await user.click(within(mine).getByRole("button", { name: "Change your comment" }));
    const box = panel.getByLabelText("Your comment");
    await user.clear(box);
    await user.type(box, "तपासले: 12 जून.");
    await user.click(panel.getByRole("button", { name: "Save the change" }));
    expect(await panel.findByText("Your comment is changed.")).toBeInTheDocument();
    expect(panel.getByText("तपासले: 12 जून.")).toBeInTheDocument();
    expect(within(mine).getByText("(changed)")).toBeInTheDocument();

    // the story is theirs: they resolve the editor's thread, and it folds away
    await user.click(panel.getByRole("button", { name: "Resolve the thread" }));
    expect(await panel.findByText("The thread is resolved.")).toBeInTheDocument();
    expect(panel.getByText("Every thread here is resolved.")).toBeInTheDocument();
    expect(panel.getByText("Resolved threads (2)")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^Comments/ })).toHaveFocus();
    await user.click(panel.getByText("Resolved threads (2)"));
    await user.click(panel.getAllByRole("button", { name: "Reopen the thread" })[0]!);
    expect(await panel.findByText("The thread is open again.")).toBeInTheDocument();
  });

  it("shows a comment another person writes, but waits while a box here is being typed in or composed in", async () => {
    const environment = createMockApplicationEnvironment();
    renderAuth(at("story-demo-001"), { preset: "sahyadri-reporter", environment });
    const user = userEvent.setup();
    const panel = within(await screen.findByRole("region", { name: "Comments (3)" }));
    await theyComment(environment, "story-demo-001", "पहिली नवीन टिप्पणी.");
    expect(await panel.findByText("पहिली नवीन टिप्पणी.")).toBeInTheDocument();

    const list = vi.spyOn(environment.comments, "list");
    const box = panel.getByLabelText("Write a comment");
    await user.type(box, "माझा मजकूर");
    fireEvent.compositionStart(box); // a phonetic Marathi keyboard composing a word
    await theyComment(environment, "story-demo-001", "दुसरी नवीन टिप्पणी.");
    expect(list).not.toHaveBeenCalled(); // nothing moves under the person's typing
    fireEvent.compositionEnd(box);
    expect(list).not.toHaveBeenCalled(); // still in the box
    expect(box).toHaveValue("माझा मजकूर");
    expect(box).toHaveFocus();

    await user.tab(); // the box is left: the update shows now
    expect(await panel.findByText("दुसरी नवीन टिप्पणी.")).toBeInTheDocument();
    expect(panel.getByLabelText("Write a comment")).toHaveValue("माझा मजकूर");
  });

  it("sends the text as counted (trimmed), and keeps its new comment when a fetch already on its way answers", async () => {
    const environment = createMockApplicationEnvironment();
    const create = vi.spyOn(environment.comments, "create");
    renderAuth(at("story-demo-001"), { preset: "sahyadri-reporter", environment });
    const user = userEvent.setup();
    const panel = within(await screen.findByRole("region", { name: "Comments (3)" }));
    const list = environment.comments.list.bind(environment.comments);
    let release = () => {};
    vi.spyOn(environment.comments, "list").mockImplementation(async (input) => {
      const answer = await list(input); // answered now, before the comment below exists
      await new Promise<void>((resolve) => (release = resolve));
      return answer;
    });
    act(() => environment.liveController.emit(ORG, { type: "resync" }));
    // the stream's word of the new comment is late: only the fetch already on its way answers
    vi.spyOn(environment.liveController, "emit").mockImplementation(() => {});
    await user.type(panel.getByLabelText("Write a comment"), "  नवी टिप्पणी  ");
    await user.click(panel.getByRole("button", { name: "Post the comment" }));
    expect(await panel.findByText("Your comment is posted.")).toBeInTheDocument();
    expect(create.mock.calls[0]![0].body).toBe("नवी टिप्पणी");
    act(() => release());
    await new Promise((resolve) => setTimeout(resolve, 50));
    act(() => release());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(panel.getByText("नवी टिप्पणी")).toBeInTheDocument();
  });

  it("stops showing the comments when a live fetch finds the story is no longer the person's", async () => {
    const environment = createMockApplicationEnvironment();
    renderAuth(at("story-demo-001"), { preset: "sahyadri-reporter", environment });
    const panel = within(await screen.findByRole("region", { name: /^Comments/ }));
    await panel.findByText("पहिल्या पावसाची तारीख तपासा.");
    environment.sessionController.setProblem({ kind: "answer", status: 404, code: "not_found", message: "" }, ["comments.list"]);
    act(() => environment.liveController.emit(ORG, { type: "resync" }));
    await waitFor(() => expect(panel.queryByText("पहिल्या पावसाची तारीख तपासा.")).not.toBeInTheDocument());
  });

  it("is in Marathi, and has no serious axe violations", async () => {
    const { container } = renderAuth(at("story-demo-001"), { preset: "sahyadri-reporter", language: "mr" });
    const panel = within(await screen.findByRole("region", { name: "टिप्पण्या (3)" }));
    expect(panel.getByLabelText("टिप्पणी लिहा")).toBeInTheDocument();
    expect(panel.getByText("निकाली निघालेल्या चर्चा (1)")).toBeInTheDocument();
    expect(await seriousViolations(container)).toEqual([]);
  });
});

describe("The notifications drawer", () => {
  it("counts the unread ones, lists them newest first, and marks one read", async () => {
    const { container } = renderAuth(STORIES, { preset: "sahyadri-reporter" });
    const user = userEvent.setup();
    const button = await screen.findByRole("button", { name: "Notifications 1 unread" });
    await user.click(button);
    const drawer = within(await screen.findByRole("dialog", { name: "Notifications" }));
    const items = await drawer.findAllByRole("listitem");
    expect(items[0]).toHaveTextContent(COMMENTED);
    expect(items[0]).toHaveTextContent("New");
    expect(items[1]).toHaveTextContent(GIVEN);
    expect(await seriousViolations(container.ownerDocument.body)).toEqual([]);

    await user.click(drawer.getByRole("button", { name: `Mark as read: ${COMMENTED}` }));
    expect(await drawer.findByText("Marked read.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument());
    await user.click(drawer.getByLabelText("Show only unread ones"));
    expect(await drawer.findByText("Nothing unread.")).toBeInTheDocument();
  });

  it("opens what a notification is about, at its comment, and marks it read", async () => {
    const environment = createMockApplicationEnvironment();
    const markRead = vi.spyOn(environment.notifications, "markRead");
    renderAuth(STORIES, { preset: "sahyadri-reporter", environment });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^Notifications/ }));
    const drawer = within(await screen.findByRole("dialog", { name: "Notifications" }));
    await user.click(await drawer.findByRole("link", { name: COMMENTED }));
    expect(markRead).toHaveBeenCalledWith({ orgId: ORG, ids: ["notification-demo-002"] });
    await waitFor(() => expect(document.getElementById("comment-comment-demo-001")).toHaveFocus());
  });

  it("hears a new notification live, and marks all of them read", async () => {
    const environment = createMockApplicationEnvironment();
    renderAuth(STORIES, { preset: "sahyadri-reporter", environment });
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Notifications 1 unread" });
    await theyComment(environment, "story-demo-001", "बातमी छान आहे.");
    expect(await screen.findByRole("button", { name: "Notifications 2 unread" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Notifications/ }));
    const drawer = within(await screen.findByRole("dialog", { name: "Notifications" }));
    await drawer.findAllByText(COMMENTED);
    await user.click(drawer.getByRole("button", { name: "Mark all as read" }));
    expect(await drawer.findByText("All of them are marked read.")).toBeInTheDocument();
    expect(drawer.queryByText("New")).not.toBeInTheDocument();
  });

  it("shows older ones a page at a time", async () => {
    const environment = createMockApplicationEnvironment();
    renderAuth(STORIES, { preset: "sahyadri-reporter", environment });
    const user = userEvent.setup();
    await screen.findByRole("button", { name: /^Notifications/ });
    for (let n = 0; n < 20; n += 1) await theyComment(environment, "story-demo-001", `टिप्पणी ${n}`);
    await user.click(screen.getByRole("button", { name: /^Notifications/ }));
    const drawer = within(await screen.findByRole("dialog", { name: "Notifications" }));
    await waitFor(() => expect(drawer.getAllByRole("listitem")).toHaveLength(20));
    await user.click(drawer.getByRole("button", { name: "Show older ones" }));
    await waitFor(() => expect(drawer.getAllByRole("listitem")).toHaveLength(23));
    expect(drawer.queryByRole("button", { name: "Show older ones" })).not.toBeInTheDocument();
  });

  it("brings older ones even when a live notification arrives while they load", async () => {
    const environment = createMockApplicationEnvironment();
    renderAuth(STORIES, { preset: "sahyadri-reporter", environment });
    const user = userEvent.setup();
    await screen.findByRole("button", { name: /^Notifications/ });
    for (let n = 0; n < 20; n += 1) await theyComment(environment, "story-demo-001", `टिप्पणी ${n}`);
    const list = environment.notifications.list.bind(environment.notifications);
    let release = () => {};
    vi.spyOn(environment.notifications, "list").mockImplementation(async (input) => {
      if (input.cursor) await new Promise<void>((resolve) => (release = resolve));
      return list(input);
    });
    await user.click(screen.getByRole("button", { name: /^Notifications/ }));
    const drawer = within(await screen.findByRole("dialog", { name: "Notifications" }));
    await waitFor(() => expect(drawer.getAllByRole("listitem")).toHaveLength(20));
    await user.click(drawer.getByRole("button", { name: "Show older ones" }));
    await theyComment(environment, "story-demo-001", "आणखी एक"); // the first page is fetched again meanwhile
    await waitFor(() => expect(drawer.getAllByText(COMMENTED)[0]).toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 50));
    act(() => release());
    await waitFor(() => expect(drawer.getAllByRole("listitem")).toHaveLength(24));
    expect(drawer.queryByRole("button", { name: /older ones/ })).not.toBeInTheDocument();
  });

  it("counts again once an opened notification is marked read, and says so when it could not be", async () => {
    const environment = createMockApplicationEnvironment();
    renderAuth(STORIES, { preset: "sahyadri-reporter", environment });
    const user = userEvent.setup();
    await theyComment(environment, "story-demo-002", "पहिली");
    await user.click(await screen.findByRole("button", { name: "Notifications 2 unread" }));
    let drawer = within(await screen.findByRole("dialog", { name: "Notifications" }));
    await user.click((await drawer.findAllByRole("link", { name: COMMENTED_002 }))[0]!);
    expect(await screen.findByRole("button", { name: "Notifications 1 unread" })).toBeInTheDocument();

    environment.sessionController.setProblem({ kind: "network" }, ["notifications.read"]);
    await user.click(screen.getByRole("button", { name: "Notifications 1 unread" }));
    drawer = within(await screen.findByRole("dialog", { name: "Notifications" }));
    await drawer.findAllByText("New");
    const unread = drawer.getAllByRole("listitem").find((item) => within(item).queryByText("New"))!;
    await user.click(within(unread).getByRole("link"));
    expect(await screen.findByText("The notification you opened could not be marked read: it is still unread.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Notifications 1 unread" })).toBeInTheDocument();
  });

  it("is in Marathi", async () => {
    renderAuth(STORIES, { preset: "sahyadri-reporter", language: "mr" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "सूचना 1 न वाचलेल्या" }));
    const drawer = within(await screen.findByRole("dialog", { name: "सूचना" }));
    expect(
      await drawer.findByText(
        "Sahyadri Demo Editor यांनी “घाटात मान्सून लवकर दाखल” या बातमीवर टिप्पणी केली. बातमीची स्थिती आता: डेस्ककडे पाठवली.",
      ),
    ).toBeInTheDocument();
    expect(
      drawer.getByText("Sahyadri Demo Editor यांनी एका बातमीवर टिप्पणी केली. ही बातमी आता तुमच्यासाठी इथे नाही."),
    ).toBeInTheDocument();
    expect(drawer.getByRole("button", { name: "सर्व वाचल्या म्हणून खूण करा" })).toBeInTheDocument();
    // the mark-one button names its notification in the page's language, the joining colon included
    expect(
      drawer.getByRole("button", {
        name: "वाचली म्हणून खूण करा: Sahyadri Demo Editor यांनी “घाटात मान्सून लवकर दाखल” या बातमीवर टिप्पणी केली. बातमीची स्थिती आता: डेस्ककडे पाठवली.",
      }),
    ).toHaveTextContent(/^वाचली म्हणून खूण करा$/);
    expect(translator("en")("notifications.markOneNamed", { notification: "X" })).toBe("Mark as read: X");
  });

  it("names a story only while the reader still sees it, and then leads nowhere and shows nothing of it", async () => {
    renderAuth(STORIES, { preset: "sahyadri-reporter" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^Notifications/ }));
    const dialog = await screen.findByRole("dialog", { name: "Notifications" });
    const drawer = within(dialog);
    const items = await drawer.findAllByRole("listitem");
    const gone = items.at(-1)!;
    expect(gone).toHaveTextContent("Sahyadri Demo Editor commented on a story. The story is no longer here for you.");
    expect(within(gone).queryByRole("link")).not.toBeInTheDocument();
    // the desk's own story, which a Reporter does not see: neither its headline nor its status
    expect(dialog).not.toHaveTextContent("Ring road work to resume next week");
    expect(dialog).not.toHaveTextContent("Editing");
  });

  it("follows the story as it is now: a move by the desk shows in the sentence", async () => {
    const environment = createMockApplicationEnvironment();
    renderAuth(STORIES, { preset: "sahyadri-reporter", environment });
    await act(() =>
      environment.sessionController.actAs("sahyadri-editor", async () => {
        const now = await storyOf(environment, "story-demo-001");
        const moved = await environment.stories.transition({ orgId: ORG, pubId: PUB, storyId: "story-demo-001", to: "editing", baseRevision: now.revision, idempotencyKey: "move-001" });
        if (!moved.ok) throw new Error("the move failed");
      }),
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^Notifications/ }));
    const drawer = within(await screen.findByRole("dialog", { name: "Notifications" }));
    expect(
      await drawer.findByText("Sahyadri Demo Editor commented on “घाटात मान्सून लवकर दाखल”. It is now: Editing."),
    ).toBeInTheDocument();
  });

  it("names who accepted an invitation, and leads to the team", async () => {
    renderAuth(`/org/${ORG}`, { preset: "sahyadri-editor" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Notifications 1 unread" }));
    const drawer = within(await screen.findByRole("dialog", { name: "Notifications" }));
    expect(await drawer.findByRole("link", { name: "Sahyadri Demo Photo Editor accepted your invitation." })).toHaveAttribute(
      "href",
      `/org/${ORG}/team`,
    );
  });
});

describe("A notification's sentences", () => {
  const base = {
    id: "n",
    publicationId: "p",
    storyId: "s",
    commentId: null,
    invitationId: null,
    actor: null,
    story: { headline: "पाणीपुरवठा बंद", status: "ready" as const },
    invitee: null,
    createdAt: "2026-10-22T09:00:00.000Z",
    readAt: null,
  };
  it("say the story and its status without an actor, in both languages, and fall back when it is gone", () => {
    const en = translator("en");
    const mr = translator("mr");
    expect(notificationText({ ...base, kind: "story_filed" }, en)).toBe("“पाणीपुरवठा बंद” was sent to the desk. It is now: Ready.");
    expect(notificationText({ ...base, kind: "story_sent_back" }, en)).toBe("Your story “पाणीपुरवठा बंद” was sent back to you. It is now: Ready.");
    expect(notificationText({ ...base, kind: "story_assigned", story: null }, en)).toBe(
      "A story was given to you. The story is no longer here for you.",
    );
    expect(notificationText({ ...base, kind: "comment" }, mr)).toBe(
      `“पाणीपुरवठा बंद” या बातमीवर नवीन टिप्पणी आली आहे. बातमीची स्थिती आता: ${mr("status.ready")}.`,
    );
    expect(notificationText({ ...base, kind: "invitation_accepted", story: null, invitee: { id: "u", name: "Fictional Reporter" } }, mr)).toBe(
      "Fictional Reporter यांनी तुमचे निमंत्रण स्वीकारले.",
    );
    expect(notificationText({ ...base, kind: "invitation_accepted", story: null }, en)).toBe("Your invitation was accepted.");
    expect(notificationLink({ ...base, kind: "comment", story: null }, "o", true)).toBeNull();
  });
});

describe("Live updates in the story editor", () => {
  const box = (label: string) => screen.getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement;

  it("puts another person's change into the boxes the person did not change, and keeps what they typed", async () => {
    const environment = createMockApplicationEnvironment();
    renderAuth(at("story-demo-001"), { preset: "sahyadri-reporter", environment });
    const user = userEvent.setup();
    const body = await screen.findByLabelText("Body text");
    await user.type(body, " माझी भर.");
    await theyChange(environment, "story-demo-001", { headline: "घाटात मान्सून आज दाखल" });
    expect(await screen.findByText("Sahyadri Demo Editor changed this story. Their changes are in the boxes now; what you typed is kept.")).toBeInTheDocument();
    expect(box("Headline")).toHaveValue("घाटात मान्सून आज दाखल");
    expect(box("Body text").value).toMatch(/ माझी भर\.$/);
    // the person's text goes on top of theirs, with no conflict
    await user.tab();
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument(), SLOW);
    const saved = await storyOf(environment, "story-demo-001");
    expect(saved.headline).toBe("घाटात मान्सून आज दाखल");
    expect(saved.body).toMatch(/माझी भर\.$/);
    expect(screen.queryByRole("heading", { name: "Someone else changed this story" })).not.toBeInTheDocument();
  });

  it("never rewrites the box being typed in, nor any box while an input method composes: it waits", async () => {
    const environment = createMockApplicationEnvironment();
    renderAuth(at("story-demo-001"), { preset: "sahyadri-reporter", environment });
    const user = userEvent.setup();
    const headline = await screen.findByLabelText("Headline");
    const before = (headline as HTMLInputElement).value;
    await user.click(headline); // in the box, not typing yet
    await theyChange(environment, "story-demo-001", { headline: "त्यांचा नवा मथळा" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(headline).toHaveValue(before);
    expect(headline).toHaveFocus();

    // the box is left: their headline comes in now
    const body = box("Body text");
    await user.click(body);
    await waitFor(() => expect(box("Headline")).toHaveValue("त्यांचा नवा मथळा"));

    // composing in the body (a phonetic keyboard): no box changes at all until it ends
    fireEvent.compositionStart(body);
    await theyChange(environment, "story-demo-001", { byline: "त्यांचे नाव" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(box("Byline")).not.toHaveValue("त्यांचे नाव");
    fireEvent.compositionEnd(body);
    // composing over, and the body untouched by them: their byline comes in, the body box stays as it is
    await waitFor(() => expect(box("Byline")).toHaveValue("त्यांचे नाव"));
    expect(body).toHaveFocus();
  });

  it("never saves half-way through a long composition: the composed word is saved on top of their change, no conflict", async () => {
    const environment = createMockApplicationEnvironment();
    renderAuth(at("story-demo-001"), { preset: "sahyadri-reporter", environment });
    const user = userEvent.setup();
    const body = (await screen.findByLabelText("Body text")) as HTMLTextAreaElement;
    await user.type(body, " Start.");
    const typed = body.value;
    // a phonetic keyboard composes क्षण for more than the autosave's 1.5 s, while another person changes the deck
    fireEvent.compositionStart(body);
    fireEvent.change(body, { target: { value: `${typed}क` } });
    await theyChange(environment, "story-demo-001", { deck: "त्यांचा उपमथळा" });
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(screen.queryByRole("heading", { name: "Someone else changed this story" })).not.toBeInTheDocument();
    expect(body).not.toHaveAttribute("readonly");
    fireEvent.change(body, { target: { value: `${typed}क्षण` } });
    fireEvent.compositionEnd(body);
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument(), SLOW);
    const saved = await storyOf(environment, "story-demo-001");
    expect(saved.body).toBe(`${typed}क्षण`.trim());
    expect(saved.deck).toBe("त्यांचा उपमथळा");
    expect(box("Deck")).toHaveValue("त्यांचा उपमथळा");
    expect(screen.queryByRole("heading", { name: "Someone else changed this story" })).not.toBeInTheDocument();
  });

  it("leaves a field both changed to the conflict screen at the next save", async () => {
    const environment = createMockApplicationEnvironment();
    renderAuth(at("story-demo-001"), { preset: "sahyadri-reporter", environment });
    const user = userEvent.setup();
    const kicker = await screen.findByLabelText("Kicker");
    await user.type(kicker, "माझे");
    await theyChange(environment, "story-demo-001", { kicker: "त्यांचे" });
    await user.tab();
    expect(await screen.findByRole("heading", { name: "Someone else changed this story" }, SLOW)).toBeInTheDocument();
    expect(box("Kicker")).toHaveValue("माझे");
  });

  it("says when another person moves the story, and fetches it afresh on resync", async () => {
    const environment = createMockApplicationEnvironment();
    const get = vi.spyOn(environment.stories, "get");
    renderAuth(at("story-demo-001"), { preset: "sahyadri-reporter", environment });
    await screen.findByLabelText("Headline");
    await act(() =>
      environment.sessionController.actAs("sahyadri-editor", async () => {
        const now = await storyOf(environment, "story-demo-001");
        await environment.stories.transition({ orgId: ORG, pubId: PUB, storyId: now.id, to: "editing", baseRevision: now.revision, idempotencyKey: "pick-up" });
      }),
    );
    expect(await screen.findByText("Sahyadri Demo Editor moved the story. It is now: Editing.")).toBeInTheDocument();

    const calls = get.mock.calls.length;
    act(() => environment.liveController.emit(ORG, { type: "resync" }));
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(calls));
  });

  it("keeps what was typed after the desk moved the story out of the person's hands, and says it is not saved", async () => {
    const environment = createMockApplicationEnvironment();
    const { unmount } = renderAuth(at("story-demo-001"), { preset: "sahyadri-reporter", environment });
    const user = userEvent.setup();
    const body = await screen.findByLabelText("Body text");
    await user.type(body, " आधी.");
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument(), SLOW);
    // the desk holds the story; this browser has not heard it yet while the person types on
    await act(() =>
      environment.sessionController.actAs("sahyadri-editor", async () => {
        const now = await storyOf(environment, "story-demo-001");
        const result = await environment.stories.transition({ orgId: ORG, pubId: PUB, storyId: now.id, to: "held", baseRevision: now.revision, idempotencyKey: "hold" });
        if (!result.ok) throw new Error(`hold failed: ${result.error.kind}`);
      }),
    );
    await user.type(body, " नंतर.");
    // the box typed in keeps taking the typing; nothing is sent, and the person is told why
    expect((body as HTMLTextAreaElement).value).toMatch(/ आधी\. नंतर\.$/);
    expect(await screen.findByText("What you typed is not saved")).toBeInTheDocument();
    expect(screen.getByText(/so you can no longer change it/)).toHaveTextContent("it is now: Held");
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect((await storyOf(environment, "story-demo-001")).body).toMatch(/ आधी\.$/);
    expect(localStorage.length).toBeGreaterThan(0);
    expect(Object.values({ ...localStorage }).some((value) => String(value).includes("आधी. नंतर."))).toBe(true);
    // leaving the box: it is read only now, and what was typed stays shown
    await user.tab();
    expect(box("Body text")).toHaveAttribute("readonly");
    expect(box("Body text").value).toMatch(/ आधी\. नंतर\.$/);
    // leaving tries once more (refused); let it finish before the next test's browser
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it("says so when the story is gone, keeping what was typed", async () => {
    const environment = createMockApplicationEnvironment();
    renderAuth(at("story-demo-001"), { preset: "sahyadri-reporter", environment });
    const user = userEvent.setup();
    const deck = await screen.findByLabelText("Deck");
    await user.type(deck, "उपमथळा");
    environment.sessionController.setProblem({ kind: "answer", status: 404, code: "not_found", message: "" }, ["stories.get"]);
    act(() => environment.liveController.emit(ORG, { type: "story", publicationId: PUB, storyId: "story-demo-001" }));
    expect(await screen.findByText("This story is no longer here for you")).toBeInTheDocument();
    expect(box("Deck")).toHaveValue("उपमथळा");
    expect(box("Deck")).toHaveAttribute("readonly");
  });
});

describe("Live updates elsewhere", () => {
  it("tells the Stories list it has changed, and shows the changes when asked", async () => {
    const environment = createMockApplicationEnvironment();
    renderAuth(STORIES, { preset: "sahyadri-editor", environment });
    const user = userEvent.setup();
    await screen.findByText("Ring road work to resume next week");
    act(() => environment.liveController.emit(ORG, { type: "resync" }));
    await user.click(await screen.findByRole("button", { name: "Show the changes" }));
    await waitFor(() => expect(screen.queryByText("This list has changed since you opened it.")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { level: 1, name: "Stories" })).toHaveFocus();
  });

  it("keeps the notice when another change is heard while the changes are being fetched", async () => {
    const environment = createMockApplicationEnvironment();
    renderAuth(STORIES, { preset: "sahyadri-editor", environment });
    const user = userEvent.setup();
    await screen.findByText("Ring road work to resume next week");
    const list = environment.stories.list.bind(environment.stories);
    let release = () => {};
    vi.spyOn(environment.stories, "list").mockImplementation(async (input) => {
      await new Promise<void>((resolve) => (release = resolve));
      return list(input);
    });
    act(() => environment.liveController.emit(ORG, { type: "resync" }));
    await user.click(await screen.findByRole("button", { name: "Show the changes" }));
    act(() => environment.liveController.emit(ORG, { type: "resync" })); // heard while fetching
    act(() => release());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByText("This list has changed since you opened it.")).toBeInTheDocument();
  });

  it("holds one stream for the organisation however many screens listen, and signing out ends it", async () => {
    const environment = createMockApplicationEnvironment();
    renderAuth(at("story-demo-001"), { preset: "sahyadri-reporter", environment });
    const user = userEvent.setup();
    await screen.findByRole("region", { name: "Comments (3)" });
    expect(environment.liveController.streams()).toBe(1);
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(environment.liveController.streams()).toBe(0));
    expect(environment.liveController.stops()).toBe(1);
  });
});

describe("The photo's state, live", () => {
  it("shows the engine's answer for the photo though the story's version did not change", async () => {
    const environment = createMockApplicationEnvironment();
    renderAuth(at("story-demo-004"), { preset: "sahyadri-editor", environment });
    expect(await screen.findByText("Preparing the photo for print…")).toBeInTheDocument();
    const get = environment.stories.get.bind(environment.stories);
    vi.spyOn(environment.stories, "get").mockImplementation(async (input) => {
      const result = await get(input);
      if (!result.ok || !result.value.photo) return result;
      return { ...result, value: { ...result.value, photo: { ...result.value.photo, status: "rejected", problem: "m.img.damaged" } } };
    });
    act(() => environment.liveController.emit(ORG, { type: "story", publicationId: PUB, storyId: "story-demo-004" }));
    expect(await screen.findByText("The picture file is damaged or incomplete. Try saving it again.")).toBeInTheDocument();
    expect(screen.queryByText("Preparing the photo for print…")).not.toBeInTheDocument();
  });
});
