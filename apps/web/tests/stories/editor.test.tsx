/**
 * The story editor (plan §10 PR 22), phone first: plain text boxes, autosave against the story's version, the conflict
 * screen on 409 story_changed, unsaved text kept on this device (and removed at sign-out), moves from the story's own
 * `can.transitions` with an Idempotency-Key and a comment on send-back, assignment, the role rules, Marathi and axe.
 * On the test double; fictional data only.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "../../src/test/render.tsx";
import { createMockApplicationEnvironment } from "../../src/mocks/index.ts";
import { DRAFTS_PREFIX } from "../../src/features/stories/drafts.ts";
import { currentLocation, renderAuth, resetBrowserState, seriousViolations } from "../auth/helpers.tsx";

// autosave waits 1.5 s, and saves queue: under a full parallel run these need more than the default 5 s
vi.setConfig({ testTimeout: 30_000 });

const ORG = "org-demo-sahyadri";
const PUB = "pub-demo-pune-daily";
const STORIES = `/org/${ORG}/pub/${PUB}/stories`;
const at = (id: string) => `${STORIES}/${id}`;

afterEach(resetBrowserState);

async function storyOf(environment: ReturnType<typeof createMockApplicationEnvironment>, storyId: string) {
  const result = await environment.stories.get({ orgId: ORG, pubId: PUB, storyId });
  if (!result.ok) throw new Error("no story");
  return result.value;
}

describe("A reporter files a story", () => {
  it("writes a new story: it is created once it has a headline, with plain boxes in the person's own keyboard", async () => {
    const { container, environment } = renderAuth(`${STORIES}/new`, { preset: "sahyadri-reporter" });
    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { level: 1, name: "New story" })).toBeInTheDocument();
    const body = screen.getByLabelText("Body text");
    expect(body.tagName).toBe("TEXTAREA");
    await user.type(body, "एक काल्पनिक बातमी.");
    await user.tab();
    expect(await screen.findByText("Every story needs a headline.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Headline"), "काल्पनिक जत्रा सुरू");
    await user.tab();
    await waitFor(() => expect(currentLocation(container).pathname).toBe(at("story-new-001")));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    const made = await storyOf(environment, "story-new-001");
    expect(made).toMatchObject({ headline: "काल्पनिक जत्रा सुरू", body: "एक काल्पनिक बातमी.", status: "draft" });
    expect(screen.getByLabelText("Body text")).toHaveValue("एक काल्पनिक बातमी.");
  });

  it("autosaves after a pause, and sends the story to the desk", async () => {
    const { environment } = renderAuth(at("story-demo-002"), { preset: "sahyadri-reporter" });
    const user = userEvent.setup();
    const body = await screen.findByLabelText("Body text");
    expect(body).toHaveAttribute("lang", "mr");
    await user.type(body, " मतमोजणी सोमवारी होईल.");
    expect(screen.getByText("Not saved yet")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument(), { timeout: 10_000 });
    expect((await storyOf(environment, "story-demo-002")).body).toContain("मतमोजणी सोमवारी होईल.");

    await user.click(screen.getByRole("button", { name: "Send to the desk" }));
    expect(await screen.findByText("The story is now: Filed.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Move the story" })).not.toBeInTheDocument(); // the desk's now
    expect(screen.getByLabelText("Headline")).not.toHaveAttribute("readonly"); // still theirs to edit until Ready
  });
});

describe("The desk works on it", () => {
  it("picks a filed story up, marks it ready, and sends one back with a comment", async () => {
    renderAuth(at("story-demo-001"), { preset: "sahyadri-editor" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Pick up" }));
    expect(await screen.findByText("The story is now: Editing.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mark ready" }));
    expect(await screen.findByText("The story is now: Ready.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Send back to the reporter" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Send the story back" }));
    await user.click(dialog.getByRole("button", { name: "Send back to the reporter" }));
    expect(dialog.getByLabelText("Why it goes back")).toHaveAccessibleDescription(/Say why the story goes back\./);
    await user.type(dialog.getByLabelText("Why it goes back"), "Add the date of the first rain.");
    await user.click(dialog.getByRole("button", { name: "Send back to the reporter" }));
    expect(await screen.findByText("The story is now: Draft.")).toBeInTheDocument();
  });

  it("sets the desk's fields, and gives the story to someone", async () => {
    const { environment } = renderAuth(at("story-demo-001"), { preset: "sahyadri-editor" });
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByRole("combobox", { name: "Priority" }), "1");
    await user.selectOptions(screen.getByRole("combobox", { name: "Page" }), "3");
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument(), { timeout: 10_000 });
    expect(await storyOf(environment, "story-demo-001")).toMatchObject({ priority: 1, pagePin: 3 });

    await user.selectOptions(screen.getByRole("combobox", { name: "Given to" }), "user-demo-sahyadri-subeditor");
    await user.click(screen.getByRole("button", { name: "Give the story" }));
    expect(await screen.findByText("The story is given to Sahyadri Demo Sub-editor.")).toBeInTheDocument();
  });

  it("sends the same Idempotency-Key when a move is retried", async () => {
    const environment = createMockApplicationEnvironment();
    const transition = vi.spyOn(environment.stories, "transition");
    renderAuth(at("story-demo-001"), { preset: "sahyadri-editor", environment });
    const user = userEvent.setup();
    environment.sessionController.setProblem({ kind: "network" }, ["stories.transition"]);
    await user.click(await screen.findByRole("button", { name: "Pick up" }));
    expect(await screen.findByText("Pageinator cannot be reached")).toBeInTheDocument();
    environment.sessionController.setProblem(null, ["stories.transition"]);
    await user.click(screen.getByRole("button", { name: "Pick up" }));
    expect(await screen.findByText("The story is now: Editing.")).toBeInTheDocument();
    const keys = transition.mock.calls.map(([input]) => input.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });
});

describe("Two people at once", () => {
  async function changedMeanwhile(environment: ReturnType<typeof createMockApplicationEnvironment>) {
    const now = await storyOf(environment, "story-demo-003");
    await environment.stories.update({
      orgId: ORG,
      pubId: PUB,
      storyId: "story-demo-003",
      patch: { baseRevision: now.revision, body: "Their newer text about the ring road." },
    });
  }

  it("shows both versions on 409 story_changed, and keeps mine when asked", async () => {
    const environment = createMockApplicationEnvironment();
    renderAuth(at("story-demo-003"), { preset: "sahyadri-editor", environment });
    const user = userEvent.setup();
    const body = await screen.findByLabelText("Body text");
    await changedMeanwhile(environment);
    await user.clear(body);
    await user.type(body, "My text about the ring road.");
    await user.tab();
    const conflict = (await screen.findByRole("heading", { name: "Someone else changed this story" })).closest("section")!;
    expect(within(conflict).getByRole("alert")).toHaveTextContent("Sahyadri Demo Editor saved a newer version");
    expect(within(conflict).getByText("Their newer text about the ring road.")).toBeInTheDocument();
    expect(within(conflict).getByText("My text about the ring road.")).toBeInTheDocument();
    expect(await seriousViolations(document.body)).toEqual([]);
    await user.click(within(conflict).getByRole("button", { name: "Keep my version" }));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument(), { timeout: 10_000 });
    expect((await storyOf(environment, "story-demo-003")).body).toBe("My text about the ring road.");
  });

  it("takes theirs when asked", async () => {
    const environment = createMockApplicationEnvironment();
    renderAuth(at("story-demo-003"), { preset: "sahyadri-editor", environment });
    const user = userEvent.setup();
    const body = await screen.findByLabelText("Body text");
    await changedMeanwhile(environment);
    await user.type(body, " Mine.");
    await user.tab();
    await user.click(await screen.findByRole("button", { name: "Use their version" }));
    expect(screen.getByLabelText("Body text")).toHaveValue("Their newer text about the ring road.");
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });
});

describe("Unsaved text on this device", () => {
  it("keeps what could not be sent, offers it back, and is removed at sign-out", async () => {
    const environment = createMockApplicationEnvironment();
    const first = renderAuth(at("story-demo-002"), { preset: "sahyadri-reporter", environment });
    const user = userEvent.setup();
    environment.sessionController.setProblem({ kind: "offline" }, ["stories.update"]);
    const body = await screen.findByLabelText("Body text");
    await user.type(body, " फोनवर लिहिलेले.");
    await user.tab();
    expect(await screen.findByText("Your latest changes are not saved. They are kept on this device.")).toBeInTheDocument();
    const stored = window.localStorage.getItem(`${DRAFTS_PREFIX}user-demo-sahyadri-reporter`) ?? "";
    expect(stored).toContain("फोनवर लिहिलेले.");
    expect(stored).not.toMatch(/password|token|secret/i);
    first.unmount(); // the screen's last save, as it goes, fails too (still offline)
    await new Promise((resolve) => setTimeout(resolve, 50));

    environment.sessionController.setProblem(null, ["stories.update"]);
    renderAuth(at("story-demo-002"), { environment });
    expect(await screen.findByText("Unsaved text on this device")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restore it" }));
    expect((screen.getByLabelText("Body text") as HTMLTextAreaElement).value).toContain("फोनवर लिहिलेले.");
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument(), { timeout: 10_000 });

    // a draft left on this device goes when its person signs out
    window.localStorage.setItem(`${DRAFTS_PREFIX}user-demo-sahyadri-reporter`, JSON.stringify({ x: {} }));
    window.localStorage.setItem(`${DRAFTS_PREFIX}someone-else`, JSON.stringify({ y: {} }));
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByRole("heading", { level: 1, name: "Sign in" });
    expect(window.localStorage.getItem(`${DRAFTS_PREFIX}user-demo-sahyadri-reporter`)).toBeNull();
    expect(window.localStorage.getItem(`${DRAFTS_PREFIX}someone-else`)).not.toBeNull();
  });
});

describe("The editor's role rules, states, Marathi and axe", () => {
  it("lets a Photo Editor read a story's text and change none of it", async () => {
    renderAuth(at("story-demo-001"), { preset: "sahyadri-photo-editor" });
    expect(await screen.findByLabelText("Body text")).toHaveAttribute("readonly");
    // a Photo Editor may set this story's photo, not its text: said so
    expect(screen.getByText("You can change this story's photo, its caption and credit.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Move the story" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Given to" })).not.toBeInTheDocument();
  });

  it("keeps a Reporter out of the desk's fields and of another reporter's story", async () => {
    const own = renderAuth(at("story-demo-002"), { preset: "sahyadri-reporter" });
    await screen.findByLabelText("Body text");
    expect(screen.queryByRole("combobox", { name: "Priority" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Given to" })).not.toBeInTheDocument();
    own.unmount();
    // the Editor's story: the API answers as if it did not exist
    renderAuth(at("story-demo-003"), { preset: "sahyadri-reporter" });
    expect(await screen.findByText("There is nothing here, or you do not have access to it.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Body text")).not.toBeInTheDocument();
  });

  it("says when a story cannot be opened, with Retry", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setProblem({ kind: "network" }, ["stories.get"]);
    renderAuth(at("story-demo-001"), { preset: "sahyadri-editor", environment });
    expect(await screen.findByText("Pageinator cannot be reached")).toBeInTheDocument();
    environment.sessionController.setProblem(null, ["stories.get"]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("Body text")).toBeInTheDocument();

    renderAuth(at("story-demo-003"), { preset: "sahyadri-reporter" });
    expect(await screen.findByText("There is nothing here, or you do not have access to it.")).toBeInTheDocument();
  });

  it("is in Marathi, and has no serious axe violations", async () => {
    const { container } = renderAuth(at("story-demo-001"), { preset: "sahyadri-editor", language: "mr" });
    expect(await screen.findByLabelText("मुख्य मजकूर")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "संपादनासाठी घ्या" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "सर्व बातम्या" })).toBeInTheDocument();
    expect(await seriousViolations(container)).toEqual([]);
  });
});
