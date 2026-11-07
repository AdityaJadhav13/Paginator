/**
 * The story's photo in the editor (plan §10 PR 22, photos): camera or gallery, the upload with progress, Cancel and a
 * retry with the same Idempotency-Key and body, the refusals in plain words (HEIC, a wrong type, too large, not a
 * picture, the quotas), attaching on the story's version (409 handled as for text), caption and credit with autosave,
 * replace and remove, the original shown only when asked, the privacy note, the role rules, Marathi and axe. On the
 * test double, which follows the API's rules. Fictional data only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "../../src/test/render.tsx";
import { createMockApplicationEnvironment, type MockApplicationEnvironment } from "../../src/mocks/index.ts";
import type { StoryDto } from "../../src/services/index.ts";
import { renderAuth, resetBrowserState, seriousViolations } from "../auth/helpers.tsx";

// autosave waits 1.5 s, and saves queue: under a full parallel run these need more than the default 5 s
vi.setConfig({ testTimeout: 30_000 });

const ORG = "org-demo-sahyadri";
const PUB = "pub-demo-pune-daily";
const at = (id: string) => `/org/${ORG}/pub/${PUB}/stories/${id}`;
const SLOW = { timeout: 10_000 };
const PNG = () =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 3, 32, 0, 0, 2, 88])], "fictional-fair.png", {
    type: "image/png",
  });

beforeEach(() => {
  // jsdom has no object URLs: the picture is shown from one
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:fictional-photo"), revokeObjectURL: vi.fn() });
});
afterEach(() => {
  resetBrowserState();
  vi.restoreAllMocks();
});

async function storyOf(environment: MockApplicationEnvironment, storyId: string): Promise<StoryDto> {
  const result = await environment.stories.get({ orgId: ORG, pubId: PUB, storyId });
  if (!result.ok) throw new Error("no story");
  return result.value;
}

const gallery = () => screen.getByLabelText("Choose a photo", { selector: "input" });

describe("Adding a photo", () => {
  it("offers the camera and the gallery, says what is kept, and attaches the uploaded photo", async () => {
    const { environment } = renderAuth(at("story-demo-002"), { preset: "sahyadri-reporter" });
    const user = userEvent.setup();
    expect(await screen.findByRole("button", { name: "Take a photo" })).toBeInTheDocument();
    const camera = screen.getByLabelText("Take a photo", { selector: "input" });
    expect(camera).toHaveAttribute("capture", "environment");
    expect(camera).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    expect(gallery()).not.toHaveAttribute("capture");
    expect(screen.getByText("The photo is kept as you took it, including where it was taken.")).toBeInTheDocument();
    expect(screen.getByText("JPEG, PNG or WebP, at most 40 MB.")).toBeInTheDocument();

    const presign = vi.spyOn(environment.media, "presign");
    await user.upload(gallery(), PNG());
    expect(await screen.findByText("The photo is attached.")).toBeInTheDocument();
    expect(presign.mock.calls[0]![0]).toMatchObject({ filename: "fictional-fair.png", contentType: "image/png", bytes: 24 });
    const story = await storyOf(environment, "story-demo-002");
    expect(story.photo).toMatchObject({ assetId: "asset-new-001", widthPx: 800, heightPx: 600 });
    expect(story.isBrief).toBe(false);
    expect(screen.getByText("800 × 600 pixels", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose another photo" })).toBeInTheDocument();

    // caption and credit, with autosave
    await user.type(screen.getByLabelText("Caption"), "काल्पनिक जत्रेतील गर्दी ");
    await user.type(screen.getByLabelText("Photo credit"), "Fictional Photo Desk");
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument(), SLOW);
    expect((await storyOf(environment, "story-demo-002")).photo).toMatchObject({
      caption: "काल्पनिक जत्रेतील गर्दी", // cleaned by the "API"…
      credit: "Fictional Photo Desk",
    });
    expect(screen.getByLabelText("Caption")).toHaveValue("काल्पनिक जत्रेतील गर्दी "); // …never in the box
  });

  it("explains HEIC and other files before sending anything", async () => {
    const { environment } = renderAuth(at("story-demo-002"), { preset: "sahyadri-reporter" });
    const user = userEvent.setup({ applyAccept: false });
    const presign = vi.spyOn(environment.media, "presign");
    await screen.findByRole("button", { name: "Choose a photo" });
    await user.upload(gallery(), new File(["x"], "IMG_0001.HEIC", { type: "image/heic" }));
    expect(await screen.findByText(/This photo is in HEIC, the iPhone's own format/)).toBeInTheDocument();
    await user.upload(gallery(), new File(["x"], "fictional.gif", { type: "image/gif" }));
    expect(await screen.findByText("This file is not a JPEG, PNG or WebP photo.")).toBeInTheDocument();
    const huge = new File(["x"], "huge.jpg", { type: "image/jpeg" });
    Object.defineProperty(huge, "size", { value: 41_943_041 });
    await user.upload(gallery(), huge);
    expect(await screen.findByText("This picture is larger than 40 MB. Save it smaller and try again.")).toBeInTheDocument();
    expect(presign).not.toHaveBeenCalled();
  });

  it("says when the file is not a picture, and offers no retry of it", async () => {
    renderAuth(at("story-demo-002"), { preset: "sahyadri-reporter" });
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Choose a photo" });
    await user.upload(gallery(), new File(["not a picture at all"], "notes.png", { type: "image/png" }));
    expect(await screen.findByText("This file is not a picture Pageinator can read. Use a JPEG, PNG or WebP file.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("says when the upload quotas are reached, and retries with the same key and body", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setProblem(
      { kind: "answer", status: 429, code: "slow_down", message: "", requestId: "r" },
      ["media.presign"],
    );
    const presign = vi.spyOn(environment.media, "presign");
    renderAuth(at("story-demo-002"), { preset: "sahyadri-reporter", environment });
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Choose a photo" });
    await user.upload(gallery(), PNG());
    expect(await screen.findByText(/each person may send 60 photos an hour, and the organization 2 GB a day/)).toBeInTheDocument();
    environment.sessionController.setProblem(null, ["media.presign"]);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("The photo is attached.")).toBeInTheDocument();
    const [first, second] = presign.mock.calls.map(([input]) => input);
    expect(second).toEqual(first);
  });

  it("shows progress, cancels, and goes on with Try again", async () => {
    const environment = createMockApplicationEnvironment();
    const original = environment.media.send.bind(environment.media);
    let hold = true;
    vi.spyOn(environment.media, "send").mockImplementation((input) => {
      if (!hold) return original(input);
      return new Promise((resolve) => {
        input.onProgress?.(0.3);
        input.signal?.addEventListener("abort", () =>
          resolve({ ok: false, error: { kind: "answer", status: 0, code: "upload_cancelled", message: "" } }),
        );
      });
    });
    renderAuth(at("story-demo-002"), { preset: "sahyadri-reporter", environment });
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Choose a photo" });
    await user.upload(gallery(), PNG());
    expect(await screen.findByText("Uploading the photo: 30%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "30");
    await user.click(screen.getByRole("button", { name: "Cancel the upload" }));
    expect(await screen.findByText("The upload was cancelled.")).toBeInTheDocument();
    hold = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("The photo is attached.")).toBeInTheDocument();
  });
});

describe("Attaching on the story's version", () => {
  it("attaches again by itself when only a move or an assignment came between", async () => {
    const environment = createMockApplicationEnvironment();
    environment.liveController.drop(true); // no live update reaches this screen: its next save meets their version
    const complete = environment.media.complete.bind(environment.media);
    vi.spyOn(environment.media, "complete").mockImplementation(async (input) => {
      const now = await storyOf(environment, "story-demo-001");
      await environment.stories.assign({ orgId: ORG, pubId: PUB, storyId: now.id, baseRevision: now.revision, userId: "user-demo-sahyadri-subeditor" });
      return complete(input);
    });
    const attach = vi.spyOn(environment.stories, "attachPhoto");
    renderAuth(at("story-demo-001"), { preset: "sahyadri-editor", environment });
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Choose a photo" });
    await user.upload(gallery(), PNG());
    expect(await screen.findByText("The photo is attached.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Someone else changed this story" })).not.toBeInTheDocument();
    // the first PUT met 409 story_changed (the assignment came between); the second, on the new version, attached
    expect(attach).toHaveBeenCalledTimes(2);
    const [first] = await Promise.all(attach.mock.results.slice(0, 1).map((result) => result.value));
    expect(first).toMatchObject({ ok: false, error: { status: 409, code: "story_changed" } });
  });

  it("opens the conflict screen when the text changed, and attaches again once chosen", async () => {
    const environment = createMockApplicationEnvironment();
    environment.liveController.drop(true); // no live update reaches this screen: its next save meets their version
    const complete = environment.media.complete.bind(environment.media);
    vi.spyOn(environment.media, "complete").mockImplementationOnce(async (input) => {
      const now = await storyOf(environment, "story-demo-001");
      await environment.stories.update({ orgId: ORG, pubId: PUB, storyId: now.id, patch: { baseRevision: now.revision, body: "Their newer text." } });
      return complete(input);
    });
    renderAuth(at("story-demo-001"), { preset: "sahyadri-editor", environment });
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Choose a photo" });
    await user.upload(gallery(), PNG());
    expect(await screen.findByText(/The story changed meanwhile/)).toBeInTheDocument();
    const panel = screen.getByRole("heading", { name: "Someone else changed this story" }).closest("section")!;
    await user.click(within(panel).getByRole("button", { name: "Use their version" }));
    await user.click(screen.getByRole("button", { name: "Attach the photo again" }));
    expect(await screen.findByText("The photo is attached.")).toBeInTheDocument();
    expect(await storyOf(environment, "story-demo-001")).toMatchObject({ body: "Their newer text.", photo: { assetId: "asset-new-001" } });
  });
});

describe("A story's photo", () => {
  it("shows the original only when asked, offers the download, and removes the photo", async () => {
    const environment = createMockApplicationEnvironment();
    const load = vi.spyOn(environment.media, "loadOriginal");
    renderAuth(at("story-demo-004"), { preset: "sahyadri-editor", environment });
    const user = userEvent.setup();
    expect(await screen.findByText(/Showing the photo downloads the whole picture/)).toBeInTheDocument();
    expect(load).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Download the original" })).toHaveAttribute(
      "href",
      `/api/v1/orgs/${ORG}/pubs/${PUB}/assets/asset-demo-001/file`,
    );
    await user.click(screen.getByRole("button", { name: "Show the photo" }));
    expect(await screen.findByRole("img", { name: "जलवाहिनीच्या दुरुस्तीचे काम" })).toHaveAttribute("src", "blob:fictional-photo");
    expect(load).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Remove the photo" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Remove the photo?" })).getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("The photo is removed.")).toBeInTheDocument();
    expect((await storyOf(environment, "story-demo-004")).photo).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fictional-photo");
    expect(screen.queryByLabelText("Caption")).not.toBeInTheDocument();
  });

  it("says when the original cannot be shown, with a retry", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setProblem({ kind: "network" }, ["media.load"]);
    renderAuth(at("story-demo-004"), { preset: "sahyadri-editor", environment });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Show the photo" }));
    expect(await screen.findByText("The photo could not be shown.")).toBeInTheDocument();
    environment.sessionController.setProblem(null, ["media.load"]);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("img")).toBeInTheDocument();
  });
});

describe("Who may set a story's photo", () => {
  it("lets a Photo Editor upload and attach a photo to a story whose text they cannot change", async () => {
    const { environment } = renderAuth(at("story-demo-001"), { preset: "sahyadri-photo-editor" });
    const user = userEvent.setup();
    expect(await screen.findByLabelText("Body text")).toHaveAttribute("readonly");
    expect((await storyOf(environment, "story-demo-001")).photo).toBeNull();
    await user.upload(gallery(), PNG());
    expect(await screen.findByText("The photo is attached.")).toBeInTheDocument();
    expect((await storyOf(environment, "story-demo-001")).photo?.assetId).toBe("asset-new-001");
    expect(screen.getByText("You can change this story's photo, its caption and credit.")).toBeInTheDocument();
  });

  it("lets a Photo Editor change the caption of a story whose text they cannot change", async () => {
    const { environment } = renderAuth(at("story-demo-004"), { preset: "sahyadri-photo-editor" });
    const user = userEvent.setup();
    expect(await screen.findByLabelText("Body text")).toHaveAttribute("readonly");
    const caption = screen.getByLabelText("Caption");
    expect(caption).not.toHaveAttribute("readonly");
    await user.clear(caption);
    await user.type(caption, "Fictional caption by the photo desk");
    await user.tab();
    await waitFor(async () => expect((await storyOf(environment, "story-demo-004")).photo?.caption).toBe("Fictional caption by the photo desk"), SLOW);
    expect(screen.getByRole("button", { name: "Choose another photo" })).toBeInTheDocument();
  });

  it("gives a Reporter the photo of their own story only before it is ready", async () => {
    const environment = createMockApplicationEnvironment();
    // the desk marks the Reporter's filed story ready
    const filed = await storyOf(environment, "story-demo-001");
    await environment.stories.transition({ orgId: ORG, pubId: PUB, storyId: filed.id, to: "ready", baseRevision: filed.revision, idempotencyKey: "k" });
    renderAuth(at("story-demo-001"), { preset: "sahyadri-reporter", environment });
    await screen.findByLabelText("Body text");
    expect(screen.queryByRole("button", { name: "Take a photo" })).not.toBeInTheDocument();
    expect(screen.queryByText("The photo is kept as you took it, including where it was taken.")).not.toBeInTheDocument();
    // and the API says the same
    const now = await storyOf(environment, "story-demo-001");
    environment.sessionController.setPreset("sahyadri-reporter");
    expect(
      await environment.stories.attachPhoto({ orgId: ORG, pubId: PUB, storyId: now.id, baseRevision: now.revision, assetId: "asset-demo-001", caption: "", credit: "" }),
    ).toMatchObject({ ok: false, error: { status: 403, code: "not_allowed" } });
  });

  it("refuses a picture the person may not see, as the API does", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setPreset("sahyadri-reporter");
    const own = await storyOf(environment, "story-demo-002");
    // asset-demo-001 was uploaded by the Sub-editor, for a story that is not the Reporter's
    expect(
      await environment.stories.attachPhoto({ orgId: ORG, pubId: PUB, storyId: own.id, baseRevision: own.revision, assetId: "asset-demo-001", caption: "", credit: "" }),
    ).toMatchObject({ ok: false, error: { status: 404 } });
    expect(await environment.media.loadOriginal({ orgId: ORG, pubId: PUB, assetId: "asset-demo-001" })).toMatchObject({ ok: false, error: { status: 404 } });
  });
});

describe("Photos: Marathi and axe", () => {
  it("is in Marathi", async () => {
    renderAuth(at("story-demo-004"), { preset: "sahyadri-editor", language: "mr" });
    expect(await screen.findByRole("button", { name: "छायाचित्र दाखवा" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "दुसरे छायाचित्र निवडा" })).toBeInTheDocument();
    expect(screen.getByText("छायाचित्र तुम्ही काढले तसेच ठेवले जाते, ते कुठे काढले याच्या माहितीसह.")).toBeInTheDocument();
  });

  it("has no serious axe violations: no photo, a photo shown, and a refusal", async () => {
    const view = renderAuth(at("story-demo-004"), { preset: "sahyadri-editor" });
    const user = userEvent.setup({ applyAccept: false });
    await user.click(await screen.findByRole("button", { name: "Show the photo" }));
    await screen.findByRole("img");
    expect(await seriousViolations(view.container)).toEqual([]);
    view.unmount();
    const other = renderAuth(at("story-demo-002"), { preset: "sahyadri-reporter" });
    await screen.findByRole("button", { name: "Choose a photo" });
    await user.upload(gallery(), new File(["x"], "IMG_0001.HEIC", { type: "image/heic" }));
    await screen.findByText(/HEIC/);
    expect(await seriousViolations(other.container)).toEqual([]);
  });
});
