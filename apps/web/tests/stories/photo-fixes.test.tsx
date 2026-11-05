/**
 * The L2-J review's fixes, each proved here on the test double (which follows the API's rules):
 * B1 Cancel during presign; B2 the conflict screen and a replaced, removed or newly attached photo, the typed caption
 * kept in the screen and the draft; B3 a Photo Editor's save state; P1 keepalive on the photo's PATCH; P2 a restored
 * draft whose own change took two versions; P3 a caption that may not be saved is kept, not marked saved; P4 a failed
 * complete is retried alone; P5 and P6 a policy that ran out or was refused; P8 and P9 nothing attached after leaving;
 * P10 no original for whoever may not see pictures; P11 the wording; P12 a lost answer to the attach; P13 an old draft,
 * and input-method composition in the caption. Fictional data only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, fireEvent, render, screen, waitFor, within } from "../../src/test/render.tsx";
import { createMockApplicationEnvironment, type MockApplicationEnvironment } from "../../src/mocks/index.ts";
import type { ApiProblem, StoryDto } from "../../src/services/index.ts";
import { DRAFTS_PREFIX, readDraft, writeDraft, type StoryFields } from "../../src/features/stories/drafts.ts";
import { PhotoPanel, fileName } from "../../src/features/stories/PhotoPanel.tsx";
import { MediaProvider } from "../../src/features/stories/media-context.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { renderAuth, resetBrowserState } from "../auth/helpers.tsx";

vi.setConfig({ testTimeout: 30_000 });

const ORG = "org-demo-sahyadri";
const PUB = "pub-demo-pune-daily";
const at = (id: string) => `/org/${ORG}/pub/${PUB}/stories/${id}`;
const SLOW = { timeout: 10_000 };
const EDITOR = "user-demo-sahyadri-editor";
const PNG = (name = "fictional-fair.png") =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 3, 32, 0, 0, 2, 88])], name, {
    type: "image/png",
  });

beforeEach(() => {
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
/** Another picture of the publication, uploaded by the signed-in person. */
async function anotherAsset(environment: MockApplicationEnvironment, name = "other.png"): Promise<string> {
  const file = PNG(name);
  const where = { orgId: ORG, pubId: PUB };
  const presigned = await environment.media.presign({ ...where, filename: name, contentType: "image/png", bytes: file.size, idempotencyKey: name });
  if (!presigned.ok) throw new Error("presign");
  await environment.media.send({ upload: presigned.value, file });
  const done = await environment.media.complete({ ...where, uploadId: presigned.value.uploadId });
  if (!done.ok) throw new Error("complete");
  return done.value.id;
}
const gallery = (label = "Choose a photo") => screen.getByLabelText(label, { selector: "input" });
const draftText = (userId = EDITOR) => window.localStorage.getItem(`${DRAFTS_PREFIX}${userId}`) ?? "";
const conflictPanel = async () => (await screen.findByRole("heading", { name: "Someone else changed this story" })).closest("section")!;

describe("B1. Cancel during presign", () => {
  it("stops before anything is sent, and nothing is attached", async () => {
    const environment = createMockApplicationEnvironment();
    const presign = environment.media.presign.bind(environment.media);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(environment.media, "presign").mockImplementation(async (input) => {
      await held;
      return presign(input);
    });
    const send = vi.spyOn(environment.media, "send");
    const attach = vi.spyOn(environment.stories, "attachPhoto");
    renderAuth(at("story-demo-002"), { preset: "sahyadri-reporter", environment });
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Choose a photo" });
    await user.upload(gallery(), PNG());
    expect(await screen.findByText("Preparing the upload…")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel the upload" }));
    act(() => release());
    expect(await screen.findByText("The upload was cancelled.")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(send).not.toHaveBeenCalled();
    expect(attach).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("B2. A conflict over the photo keeps the typed caption", () => {
  it("replaced: says so, shows both captions, and puts mine on their photo only when asked", async () => {
    const environment = createMockApplicationEnvironment();
    renderAuth(at("story-demo-004"), { preset: "sahyadri-editor", environment });
    const user = userEvent.setup();
    const caption = await screen.findByLabelText("Caption");
    // someone attaches another photo meanwhile
    const other = await anotherAsset(environment);
    const now = await storyOf(environment, "story-demo-004");
    await environment.stories.attachPhoto({ orgId: ORG, pubId: PUB, storyId: now.id, baseRevision: now.revision, assetId: other, caption: "Their caption", credit: "" });
    await user.clear(caption);
    await user.type(caption, "My caption");
    await user.tab();
    const panel = within(await conflictPanel());
    expect(panel.getByText("The photo was replaced by Sahyadri Demo Editor.")).toBeInTheDocument();
    expect(panel.getByText("Their caption")).toBeInTheDocument();
    expect(panel.getByText("My caption")).toBeInTheDocument(); // in the screen…
    expect(draftText()).toContain("My caption"); // …and in the draft
    await user.click(panel.getByRole("checkbox", { name: "Put my caption and credit on their photo" }));
    await user.click(panel.getByRole("button", { name: "Keep my version" }));
    await waitFor(async () => expect((await storyOf(environment, "story-demo-004")).photo).toMatchObject({ assetId: other, caption: "My caption" }), SLOW);
  });

  it("removed: never blanks the typed caption; keeps it, read only, until a photo returns", async () => {
    const environment = createMockApplicationEnvironment();
    renderAuth(at("story-demo-004"), { preset: "sahyadri-editor", environment });
    const user = userEvent.setup();
    const caption = await screen.findByLabelText("Caption");
    const now = await storyOf(environment, "story-demo-004");
    await environment.stories.removePhoto({ orgId: ORG, pubId: PUB, storyId: now.id, baseRevision: now.revision });
    await user.clear(caption);
    await user.type(caption, "My caption");
    await user.tab();
    const panel = within(await conflictPanel());
    expect(panel.getByText("The photo was removed by Sahyadri Demo Editor.")).toBeInTheDocument();
    expect(panel.getByText("My caption")).toBeInTheDocument();
    await user.click(panel.getByRole("button", { name: "Keep my version" }));
    // kept, read only, with the reason, in the screen and the draft
    expect(await screen.findByText("The photo was removed by Sahyadri Demo Editor. Your caption and credit are not saved.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("My caption")).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "Copy the caption and credit" })).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 1800));
    expect(draftText()).toContain("My caption");
    expect((await storyOf(environment, "story-demo-004")).photo).toBeNull();
    // a photo again: the kept caption goes with it
    await user.upload(gallery(), PNG("again.png"));
    expect(await screen.findByText("The photo is attached.")).toBeInTheDocument();
    expect((await storyOf(environment, "story-demo-004")).photo?.caption).toBe("My caption");
  });

  it("attach meets another photo: the panel says a different photo is attached, and the typed caption survives", async () => {
    const environment = createMockApplicationEnvironment();
    environment.liveController.drop(true); // no live update reaches this screen: its next save meets their version
    renderAuth(at("story-demo-001"), { preset: "sahyadri-editor", environment });
    const user = userEvent.setup();
    const complete = environment.media.complete.bind(environment.media);
    vi.spyOn(environment.media, "complete").mockImplementationOnce(async (input) => {
      const done = await complete(input);
      // meanwhile someone attaches another picture, with a caption
      const other = await anotherAsset(environment, "someone.png");
      const now = await storyOf(environment, "story-demo-001");
      await environment.stories.attachPhoto({ orgId: ORG, pubId: PUB, storyId: now.id, baseRevision: now.revision, assetId: other, caption: "Their caption", credit: "" });
      return done;
    });
    await screen.findByRole("button", { name: "Choose a photo" });
    await user.upload(gallery(), PNG());
    expect(await screen.findByText(/A different photo was attached to this story meanwhile/)).toBeInTheDocument();
    const panel = within(await conflictPanel());
    expect(panel.getByText("A photo was added by Sahyadri Demo Editor.")).toBeInTheDocument();
    await user.click(panel.getByRole("button", { name: "Use their version" }));
    // their photo is shown now, and mine can be attached again
    expect(screen.getByLabelText("Caption")).toHaveValue("Their caption");
    expect(screen.getByRole("button", { name: "Attach the photo again" })).toBeInTheDocument();
  });

  it("typed caption survives a replace conflict even when the person does not put it on their photo: shown, and in the draft until the choice", async () => {
    const environment = createMockApplicationEnvironment();
    renderAuth(at("story-demo-004"), { preset: "sahyadri-editor", environment });
    const user = userEvent.setup();
    const caption = await screen.findByLabelText("Caption");
    const other = await anotherAsset(environment);
    const now = await storyOf(environment, "story-demo-004");
    await environment.stories.attachPhoto({ orgId: ORG, pubId: PUB, storyId: now.id, baseRevision: now.revision, assetId: other, caption: "Their caption", credit: "" });
    await user.clear(caption);
    await user.type(caption, "Typed for the old photo");
    await user.tab();
    const panel = within(await conflictPanel());
    expect(panel.getByText("Typed for the old photo")).toBeInTheDocument();
    expect(draftText()).toContain("Typed for the old photo");
    expect(screen.getByLabelText("Caption")).toHaveAttribute("readonly"); // no typing while the question is open
  });
});

describe("B3. A Photo Editor's save state", () => {
  it("shows a failed caption save, with Save now", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setProblem({ kind: "network" }, ["stories.photo"]);
    renderAuth(at("story-demo-004"), { preset: "sahyadri-photo-editor", environment });
    const user = userEvent.setup();
    const caption = await screen.findByLabelText("Caption");
    await user.type(caption, " more");
    await user.tab();
    expect(await screen.findByText("Your latest changes are not saved. They are kept on this device.")).toBeInTheDocument();
    environment.sessionController.setProblem(null, ["stories.photo"]);
    await user.click(screen.getByRole("button", { name: "Save now" }));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument(), SLOW);
  });
});

describe("P1. Leaving sends the caption with keepalive", () => {
  it("sends the photo's PATCH with keepalive on pagehide", async () => {
    const environment = createMockApplicationEnvironment();
    const updatePhoto = vi.spyOn(environment.stories, "updatePhoto");
    renderAuth(at("story-demo-004"), { preset: "sahyadri-editor", environment });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Caption"), " left");
    window.dispatchEvent(new Event("pagehide"));
    await waitFor(() => expect(updatePhoto).toHaveBeenCalledWith(expect.objectContaining({ keepalive: true })));
  });
});

describe("P2 and P13. Drafts", () => {
  const base: StoryFields = { headline: "गुरुवारी पाणीपुरवठा बंद", kicker: "", deck: "", byline: "Sahyadri Demo Sub-editor", body: "", priority: 3, pagePin: null, editionId: "edition-demo-2026-10-24", sectionId: null, deskNote: "", caption: "", credit: "" };

  it("knows its own change that took two versions (caption, then text), and restores the rest without a conflict", async () => {
    const environment = createMockApplicationEnvironment();
    const now = await storyOf(environment, "story-demo-004");
    const fixed = { ...base, body: now.body, caption: now.photo!.caption, credit: now.photo!.credit };
    const sending = { ...fixed, caption: "Sent caption", body: "Sent body" };
    // both requests arrived (two versions), and the tab closed before their answers, with more typed after them
    await environment.stories.updatePhoto({ orgId: ORG, pubId: PUB, storyId: now.id, baseRevision: now.revision, caption: "Sent caption" });
    await environment.stories.update({ orgId: ORG, pubId: PUB, storyId: now.id, patch: { baseRevision: now.revision + 1, body: "Sent body" } });
    writeDraft(EDITOR, now.id, {
      fields: { ...sending, body: "Sent body and more" },
      base: fixed,
      baseRevision: now.revision,
      sending,
      sendingSteps: 2,
      photoAssetId: "asset-demo-001",
      savedAt: "2026-10-22T05:00:00.000Z",
    });
    renderAuth(at(now.id), { preset: "sahyadri-editor", environment });
    const user = userEvent.setup();
    expect(await screen.findByText("Unsaved text on this device")).toBeInTheDocument();
    expect(screen.queryByText(/has been changed since then/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restore it" }));
    expect(screen.queryByRole("heading", { name: "Someone else changed this story" })).not.toBeInTheDocument();
    await waitFor(async () => expect((await storyOf(environment, now.id)).body).toBe("Sent body and more"), SLOW);
  });

  it("reads an old draft without caption and credit as empty ones", () => {
    const { caption: _caption, credit: _credit, ...old } = base;
    window.localStorage.setItem(
      `${DRAFTS_PREFIX}${EDITOR}`,
      JSON.stringify({ "story-x": { fields: old, base: old, baseRevision: 1, savedAt: "2026-10-22T05:00:00.000Z" } }),
    );
    expect(readDraft(EDITOR, "story-x")?.fields).toMatchObject({ caption: "", credit: "" });
    expect(readDraft(EDITOR, "story-x")?.base).toMatchObject({ caption: "", credit: "" });
  });

  it("does not rewrite the caption box during an input method's composition", async () => {
    const { environment } = renderAuth(at("story-demo-004"), { preset: "sahyadri-editor" });
    const caption = (await screen.findByLabelText("Caption")) as HTMLTextAreaElement;
    fireEvent.compositionStart(caption);
    fireEvent.change(caption, { target: { value: "क़ा " } }); // still composing, with a space the API will strip
    const before = (await storyOf(environment, "story-demo-004")).photo?.caption;
    await new Promise((resolve) => setTimeout(resolve, 2_000)); // past the autosave's pause: nothing half-composed is sent
    expect((await storyOf(environment, "story-demo-004")).photo?.caption).toBe(before);
    fireEvent.compositionEnd(caption);
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument(), SLOW);
    expect(caption.value).toBe("क़ा "); // the box keeps the text as it is, the API's cleaning is not put back in it
    expect((await storyOf(environment, "story-demo-004")).photo?.caption).toBe("क़ा".normalize("NFC"));
  });
});

describe("P3. A caption that may not be saved now", () => {
  it("is kept, not counted as saved, when the person may no longer change the photo", async () => {
    const environment = createMockApplicationEnvironment();
    // the Reporter's own story with a photo, then marked ready by the desk
    const asset = await (async () => {
      environment.sessionController.setPreset("sahyadri-reporter");
      const id = await anotherAsset(environment, "reporter.png");
      const own = await storyOf(environment, "story-demo-001");
      await environment.stories.attachPhoto({ orgId: ORG, pubId: PUB, storyId: own.id, baseRevision: own.revision, assetId: id, caption: "", credit: "" });
      environment.sessionController.setPreset("sahyadri-editor");
      const filed = await storyOf(environment, "story-demo-001");
      await environment.stories.transition({ orgId: ORG, pubId: PUB, storyId: filed.id, to: "ready", baseRevision: filed.revision, idempotencyKey: "r" });
      return id;
    })();
    const ready = await storyOf(environment, "story-demo-001");
    const fields: StoryFields = {
      headline: ready.headline, kicker: "", deck: "", byline: ready.byline, body: ready.body, priority: 3, pagePin: null, editionId: "edition-demo-2026-10-23", sectionId: null, deskNote: "", caption: "", credit: "",
    };
    writeDraft("user-demo-sahyadri-reporter", ready.id, {
      fields: { ...fields, caption: "Reporter's caption" },
      base: fields,
      baseRevision: ready.revision,
      photoAssetId: asset,
      savedAt: "2026-10-22T05:00:00.000Z",
    });
    const updatePhoto = vi.spyOn(environment.stories, "updatePhoto");
    renderAuth(at(ready.id), { preset: "sahyadri-reporter", environment });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Restore it" }));
    expect(await screen.findByText("You can no longer change this story's photo. Your caption and credit are not saved.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Reporter's caption")).toHaveAttribute("readonly");
    await new Promise((resolve) => setTimeout(resolve, 1800));
    expect(updatePhoto).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(`${DRAFTS_PREFIX}user-demo-sahyadri-reporter`)).toContain("Reporter's caption");
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });
});

describe("P4, P5, P6. Retrying an upload", () => {
  it("retries a failed complete alone: no new presign, no second send", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setProblem({ kind: "network" }, ["media.complete"]);
    const presign = vi.spyOn(environment.media, "presign");
    const send = vi.spyOn(environment.media, "send");
    const complete = vi.spyOn(environment.media, "complete");
    renderAuth(at("story-demo-002"), { preset: "sahyadri-reporter", environment });
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Choose a photo" });
    await user.upload(gallery(), PNG());
    expect(await screen.findByText("Pageinator cannot be reached")).toBeInTheDocument();
    environment.sessionController.setProblem(null, ["media.complete"]);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("The photo is attached.")).toBeInTheDocument();
    expect(presign).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls.map(([input]) => input.uploadId)).toEqual(["upload-001", "upload-001"]);
  });

  it("asks for a fresh policy, with a new key, when the kept one has run out", async () => {
    const environment = createMockApplicationEnvironment();
    const presign = environment.media.presign.bind(environment.media);
    const calls = vi.spyOn(environment.media, "presign").mockImplementation(async (input) => {
      const answer = await presign(input);
      // the first policy has run out (its time is over by the device's clock)
      return answer.ok && calls.mock.calls.length === 1 ? { ok: true, value: { ...answer.value, expiresAt: "2020-01-01T00:00:00.000Z" } } : answer;
    });
    environment.sessionController.setProblem({ kind: "network" }, ["media.send"]);
    renderAuth(at("story-demo-002"), { preset: "sahyadri-reporter", environment });
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Choose a photo" });
    await user.upload(gallery(), PNG());
    expect(await screen.findByText("Pageinator cannot be reached")).toBeInTheDocument();
    environment.sessionController.setProblem(null, ["media.send"]);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("The photo is attached.")).toBeInTheDocument();
    const keys = calls.mock.calls.map(([input]) => input.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it("does not retry a policy the store refused while it was still valid; renews one that ran out, once", async () => {
    const environment = createMockApplicationEnvironment();
    const denied: ApiProblem = { kind: "answer", status: 403, code: "upload_denied", message: "AccessDenied" };
    vi.spyOn(environment.media, "send").mockResolvedValue({ ok: false, error: denied });
    renderAuth(at("story-demo-002"), { preset: "sahyadri-reporter", environment });
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Choose a photo" });
    await user.upload(gallery(), PNG());
    expect(await screen.findByText(/The photo store refused this upload/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("renews a run-out policy once, then stops", async () => {
    const environment = createMockApplicationEnvironment();
    const presign = environment.media.presign.bind(environment.media);
    const calls = vi.spyOn(environment.media, "presign").mockImplementation(async (input) => {
      const answer = await presign(input);
      return answer.ok ? { ok: true, value: { ...answer.value, expiresAt: new Date(Date.now() + 200).toISOString() } } : answer;
    });
    vi.spyOn(environment.media, "send").mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300)); // the policy runs out on the way
      return { ok: false, error: { kind: "answer", status: 403, code: "upload_denied", message: "AccessDenied" } };
    });
    renderAuth(at("story-demo-002"), { preset: "sahyadri-reporter", environment });
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Choose a photo" });
    await user.upload(gallery(), PNG());
    expect(await screen.findByText("The upload took too long, and its permission ran out. Try again.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/The photo store refused this upload/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    const keys = calls.mock.calls.map(([input]) => input.idempotencyKey);
    expect(new Set(keys).size).toBe(2);
  });
});

describe("P8, P9. Leaving stops every step", () => {
  it("attaches nothing after the screen is gone", async () => {
    const environment = createMockApplicationEnvironment();
    const complete = environment.media.complete.bind(environment.media);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(environment.media, "complete").mockImplementation(async (input) => {
      await held;
      return complete(input);
    });
    const attach = vi.spyOn(environment.stories, "attachPhoto");
    const view = renderAuth(at("story-demo-002"), { preset: "sahyadri-reporter", environment });
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Choose a photo" });
    await user.upload(gallery(), PNG());
    expect(await screen.findByText("Checking the photo…")).toBeInTheDocument();
    view.unmount();
    act(() => release());
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(attach).not.toHaveBeenCalled();
    expect((await storyOf(environment, "story-demo-002")).photo).toBeNull();
  });
});

describe("P10. No original for whoever may not see pictures", () => {
  it("hides Show the photo and Download the original", () => {
    const environment = createMockApplicationEnvironment();
    const story = { photo: { assetId: "asset-demo-001", caption: "c", credit: "", status: "received", widthPx: 10, heightPx: 10, previewUrl: null } } as unknown as StoryDto;
    const props = {
      orgId: ORG, pubId: PUB, story, may: false, locked: true, caption: "c", credit: "", keptBecause: null, lang: undefined,
      onCaption: () => undefined, onCredit: () => undefined, onLeave: () => undefined, onDiscardKept: () => undefined,
      onAttach: async () => ({ ok: true as const }), onRemove: async () => ({ ok: true as const }),
    };
    const { rerender } = render(<I18nProvider><MediaProvider media={environment.media}><PhotoPanel {...props} mayView={false} /></MediaProvider></I18nProvider>);
    expect(screen.queryByRole("button", { name: "Show the photo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Download the original" })).not.toBeInTheDocument();
    rerender(<I18nProvider><MediaProvider media={environment.media}><PhotoPanel {...props} mayView /></MediaProvider></I18nProvider>);
    expect(screen.getByRole("button", { name: "Show the photo" })).toBeInTheDocument();
  });
});

describe("P11. The wording", () => {
  it("does not word a 429 outside presign as the quotas, nor a size change as too large", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setProblem({ kind: "answer", status: 429, code: "slow_down", message: "" }, ["media.complete"]);
    renderAuth(at("story-demo-002"), { preset: "sahyadri-reporter", environment });
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Choose a photo" });
    await user.upload(gallery(), PNG());
    expect(await screen.findByText("Too many tries")).toBeInTheDocument();
    expect(screen.queryByText(/60 photos an hour/)).not.toBeInTheDocument();
    environment.sessionController.setProblem(null, ["media.complete"]);
    vi.spyOn(environment.media, "send").mockResolvedValue({ ok: false, error: { kind: "answer", status: 400, code: "upload_size_mismatch", message: "" } });
    await user.upload(gallery(), PNG("again.png"));
    expect(await screen.findByText("The file changed while it was being sent. Choose the photo again.")).toBeInTheDocument();
    expect(screen.queryByText(/larger than 40 MB/)).not.toBeInTheDocument();
  });

  it("cuts a long file name at a whole character, within the API's 255 units", () => {
    const name = `${"a".repeat(254)}😀.png`; // the emoji would straddle unit 255
    const cut = fileName(name);
    expect(cut.length).toBeLessThanOrEqual(255);
    expect(cut).toBe("a".repeat(254));
    expect(fileName("")).toBe("photo");
  });
});

describe("P12. A lost answer to the attach", () => {
  it("is not a conflict when the photo being attached is already there", async () => {
    const environment = createMockApplicationEnvironment();
    const attach = environment.stories.attachPhoto.bind(environment.stories);
    vi.spyOn(environment.stories, "attachPhoto").mockImplementation(async (input) => {
      const made = await attach(input); // it arrived…
      if (!made.ok) return made;
      // …its answer was lost, and the retry met the story already changed by it
      const now = await storyOf(environment, input.storyId);
      return { ok: false, error: { kind: "answer", status: 409, code: "story_changed", message: "", current: now } };
    });
    renderAuth(at("story-demo-002"), { preset: "sahyadri-reporter", environment });
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Choose a photo" });
    await user.upload(gallery(), PNG());
    expect(await screen.findByText("The photo is attached.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Someone else changed this story" })).not.toBeInTheDocument();
  });
});

describe("L2.2. The photo's state from the engine", () => {
  const panel = (photo: Record<string, unknown>, mayView = true) => {
    const environment = createMockApplicationEnvironment();
    const story = {
      photo: { assetId: "asset-demo-001", caption: "c", credit: "", widthPx: 10, heightPx: 10, previewUrl: null, problem: null, ...photo },
    } as unknown as StoryDto;
    const props = {
      orgId: ORG, pubId: PUB, story, may: false, locked: true, caption: "c", credit: "", keptBecause: null, lang: undefined,
      onCaption: () => undefined, onCredit: () => undefined, onLeave: () => undefined, onDiscardKept: () => undefined,
      onAttach: async () => ({ ok: true as const }), onRemove: async () => ({ ok: true as const }),
    };
    return render(<I18nProvider><MediaProvider media={environment.media}><PhotoPanel {...props} mayView={mayView} /></MediaProvider></I18nProvider>);
  };

  it("says it is being prepared, to whoever sees the story, pictures or not", () => {
    panel({ status: "received" }, false);
    expect(screen.getByText("Preparing the photo for print…")).toBeInTheDocument();
  });

  it("gives a refusal in the Desk's own words, by its code, and only the heading for a code it does not carry", () => {
    const view = panel({ status: "rejected", problem: "m.img.damaged" });
    expect(screen.getByText("This photo was refused.")).toBeInTheDocument();
    expect(screen.getByText("The picture file is damaged or incomplete. Try saving it again.")).toBeInTheDocument();
    view.unmount();
    panel({ status: "rejected", problem: "m.img.badProfile" });
    expect(screen.getByText("This photo was refused.")).toBeInTheDocument();
    expect(screen.queryByText(/Try saving it again/)).not.toBeInTheDocument();
  });

  it("words a refusal for the file's type (m.img.format) without the type the Desk named", () => {
    panel({ status: "rejected", problem: "m.img.format" });
    expect(screen.getByText(/file type is not one the Desk takes/)).toBeInTheDocument();
  });

  it("offers neither Show the photo nor Download the original for a refused or failed photo (it holds no bytes)", () => {
    for (const status of ["rejected", "failed"]) {
      const view = panel({ status, problem: status === "failed" ? "worker.lost" : "m.img.damaged" });
      expect(screen.queryByRole("button", { name: "Show the photo" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Download the original" })).not.toBeInTheDocument();
      view.unmount();
    }
    panel({ status: "ready" });
    expect(screen.getByRole("button", { name: "Show the photo" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download the original" })).toBeInTheDocument();
  });

  it("says a failed preparation is not the photo's fault", () => {
    panel({ status: "failed", problem: "worker.lost" });
    expect(screen.getByText("The photo could not be prepared for print.")).toBeInTheDocument();
    expect(screen.getByText(/This is not the photo's fault/)).toBeInTheDocument();
    expect(screen.queryByText("Preparing the photo for print…")).not.toBeInTheDocument();
  });

  it("says it in Marathi, the Desk's Marathi for a refusal", () => {
    window.localStorage.setItem("pageinator.language", "mr");
    panel({ status: "rejected", problem: "m.img.tooManyPixels" });
    expect(screen.getByText("हे छायाचित्र नाकारले गेले.")).toBeInTheDocument();
    expect(
      screen.getByText("या चित्रात डेस्कसाठी खूप जास्त पिक्सेल आहेत. ते लहान करून जतन करा आणि पुन्हा प्रयत्न करा."),
    ).toBeInTheDocument();
  });
});
