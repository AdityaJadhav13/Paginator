/**
 * The media library, /org/:orgId/pub/:pubId/media (plan §L2.2): the grid newest first with its states and flags, the
 * filters, a picture's detail (facts, how wide it prints sharp, its caption, credit and photographer saved on its
 * revision, 409 asset_changed with theirs), "Used in", Delete only while unused, uploading several photos straight
 * into the library, a picture becoming ready live, the role rules (a Reporter's own, a Viewer read only), the story
 * editor's "Choose from library", and axe. On the test double; fictional data.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, screen, waitFor, within } from "../../src/test/render.tsx";
import { createMockApplicationEnvironment } from "../../src/mocks/index.ts";
import { renderAuth, resetBrowserState, seriousViolations } from "../auth/helpers.tsx";

vi.setConfig({ testTimeout: 30_000 });

const ORG = "org-demo-sahyadri";
const PUB = "pub-demo-pune-daily";
const MEDIA = `/org/${ORG}/pub/${PUB}/media`;
const UNTITLED = "Picture without a caption, 1600 × 1088 px";
const PNG = (name: string) =>
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

const grid = () => screen.findByRole("list", { name: "Pictures" });
const names = async () => within(await grid()).getAllByRole("button").map((button) => button.textContent);
const card = async (name: string) => (await screen.findByRole("button", { name })).closest("li")!;
const open = async (name: string) => {
  await userEvent.click(await screen.findByRole("button", { name }));
  return within(await screen.findByRole("dialog", { name }));
};

describe("The photo desk", () => {
  it("lists the pictures newest first, with their state, flags and the Desk's reason for a refusal", async () => {
    const view = renderAuth(MEDIA, { preset: "sahyadri-editor" });
    expect(await screen.findByRole("heading", { level: 1, name: "Media" })).toBeInTheDocument();
    expect(await names()).toEqual([UNTITLED, "नदीकाठचा फेरफटका", "Fictional damaged file", "जलवाहिनीच्या दुरुस्तीचे काम"]);
    const untitled = within(await card(UNTITLED));
    expect(untitled.getByText("Ready")).toBeInTheDocument();
    expect(untitled.getByText("No caption")).toBeInTheDocument();
    expect(untitled.getByText("No credit")).toBeInTheDocument();
    const refused = within(await card("Fictional damaged file"));
    expect(refused.getByText("Refused")).toBeInTheDocument();
    expect(refused.getByText("The picture file is damaged or incomplete. Try saving it again.")).toBeInTheDocument();
    expect(within(await card("जलवाहिनीच्या दुरुस्तीचे काम")).getByText("Preparing")).toBeInTheDocument();
    expect(await seriousViolations(view.container)).toEqual([]);
  });

  it("filters by search, missing caption or credit, and size", async () => {
    const environment = createMockApplicationEnvironment();
    const list = vi.spyOn(environment.media, "list");
    renderAuth(MEDIA, { preset: "sahyadri-editor", environment });
    const user = userEvent.setup();
    await grid();
    // one "Missing" choice, as the API takes one
    await user.selectOptions(screen.getByRole("combobox", { name: "Missing" }), "caption");
    await waitFor(async () => expect(await names()).toEqual([UNTITLED]));
    await user.selectOptions(screen.getByRole("combobox", { name: "Missing" }), "credit");
    await waitFor(async () => expect(await names()).toEqual([UNTITLED]));
    expect(list.mock.calls.at(-1)![0].query).toEqual({ missing: "credit" });
    await user.click(screen.getByRole("button", { name: "Clear the filters" }));
    await user.type(screen.getByRole("searchbox", { name: "Search caption, credit, photographer" }), "damaged");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(async () => expect(await names()).toEqual(["Fictional damaged file"]));
    await user.click(screen.getByRole("button", { name: "Clear the filters" }));
    await user.selectOptions(await screen.findByRole("combobox", { name: "Too small for" }), "1");
    await waitFor(async () => expect(await names()).toEqual(["नदीकाठचा फेरफटका"]));
    expect(list.mock.calls.at(-1)![0].query).toEqual({ tooSmallForCols: 1 });
  });

  it("offers no size filter while the publication's grid is unknown", async () => {
    const environment = createMockApplicationEnvironment();
    const real = environment.media.list.bind(environment.media);
    vi.spyOn(environment.media, "list").mockImplementation(async (input) => {
      const answer = await real(input);
      return answer.ok ? { ok: true, value: { ...answer.value, items: answer.value.items.map((item) => ({ ...item, sharpUpToCols: null })) } } : answer;
    });
    renderAuth(MEDIA, { preset: "sahyadri-editor", environment });
    await grid();
    expect(screen.queryByRole("combobox", { name: "Too small for" })).not.toBeInTheDocument();
    const sheet = await open("नदीकाठचा फेरफटका");
    expect(sheet.queryByText(/Prints sharp|Too small for one column/)).not.toBeInTheDocument();
  });

  it("shows a picture's facts, saves its caption, and shows theirs when someone saved first", async () => {
    const { environment } = renderAuth(MEDIA, { preset: "sahyadri-editor" });
    const user = userEvent.setup();
    const sheet = await open("नदीकाठचा फेरफटका");
    expect(sheet.getByText("PNG")).toBeInTheDocument();
    expect(sheet.getByText("1 KB")).toBeInTheDocument(); // under 0.1 MB, in KB
    expect(sheet.getByText("240 × 160 px")).toBeInTheDocument();
    expect(sheet.getByText("fictional-as")).toBeInTheDocument();
    expect(sheet.getByText("Too small for one column")).toBeInTheDocument();
    expect(sheet.getByText("No story uses this picture yet.")).toBeInTheDocument();
    expect(sheet.getByRole("link", { name: "Download the original" })).toHaveAttribute("href", expect.stringContaining("/assets/asset-demo-004/file"));

    await user.type(sheet.getByRole("textbox", { name: "Photographer" }), "Fictional Photographer ");
    await user.click(sheet.getByRole("button", { name: "Save" }));
    expect(await sheet.findByText("Saved.")).toBeInTheDocument();
    expect(sheet.getByRole("textbox", { name: "Photographer" })).toHaveValue("Fictional Photographer"); // cleaned

    // a colleague saves first: theirs is shown, and can be taken
    await environment.media.update({ orgId: ORG, pubId: PUB, assetId: "asset-demo-004", patch: { baseRevision: 2, credit: "Fictional Agency" } });
    await user.clear(sheet.getByRole("textbox", { name: "Photo credit" }));
    await user.type(sheet.getByRole("textbox", { name: "Photo credit" }), "Mine");
    await user.click(sheet.getByRole("button", { name: "Save" }));
    expect(await sheet.findByText("Someone changed this picture.")).toBeInTheDocument();
    expect(sheet.getByText("Fictional Agency")).toBeInTheDocument();
    await user.click(sheet.getByRole("button", { name: "Use their version" }));
    expect(sheet.getByRole("textbox", { name: "Photo credit" })).toHaveValue("Fictional Agency");
  });

  it("deletes a picture only while no story uses it", async () => {
    const { environment } = renderAuth(MEDIA, { preset: "sahyadri-editor" });
    const user = userEvent.setup();
    let sheet = await open("जलवाहिनीच्या दुरुस्तीचे काम");
    expect(sheet.getByRole("link", { name: "गुरुवारी पाणीपुरवठा बंद" })).toHaveAttribute("href", `/org/${ORG}/pub/${PUB}/stories/story-demo-004`);
    expect(sheet.queryByRole("button", { name: "Delete the picture" })).not.toBeInTheDocument();
    expect(sheet.getByText("A story uses this picture, so it cannot be deleted.")).toBeInTheDocument();
    const inUse = await environment.media.remove({ orgId: ORG, pubId: PUB, assetId: "asset-demo-001", baseRevision: 1 });
    expect(inUse.ok || inUse.error).toMatchObject({ kind: "answer", status: 409, code: "asset_in_use" });
    await user.click(sheet.getByRole("button", { name: "Close dialog" }));

    sheet = await open(UNTITLED);
    await user.click(sheet.getByRole("button", { name: "Delete the picture" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Delete the picture?" })).getByRole("button", { name: "Delete" }));
    await waitFor(async () => expect(await names()).not.toContain(UNTITLED));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("uploads several photos straight into the library, and explains a file it cannot take", async () => {
    const { environment } = renderAuth(MEDIA, { preset: "sahyadri-photo-editor" });
    const user = userEvent.setup({ applyAccept: false });
    const presign = vi.spyOn(environment.media, "presign");
    await grid();
    const input = screen.getByLabelText("Upload photos", { selector: "input" });
    expect(input).toHaveAttribute("multiple");
    await user.upload(input, [PNG("fictional-one.png"), PNG("fictional-two.png"), new File(["x"], "IMG_0001.HEIC", { type: "image/heic" })]);
    await waitFor(() => expect(screen.getAllByText("Added to the library.")).toHaveLength(2));
    expect(screen.getByText(/This photo is in HEIC/)).toBeInTheDocument();
    expect(presign.mock.calls.map(([call]) => [call.filename, call.purpose])).toEqual([
      ["fictional-one.png", "library"],
      ["fictional-two.png", "library"],
    ]);
    await waitFor(async () => expect((await names()).filter((name) => name === "Picture without a caption, 800 × 600 px")).toHaveLength(2));
    await user.click(screen.getByRole("button", { name: "Clear the list" }));
    expect(screen.queryByText("Added to the library.")).not.toBeInTheDocument();
  });

  it("shows sizes from 0.1 MB in MB", async () => {
    const environment = createMockApplicationEnvironment();
    const real = environment.media.list.bind(environment.media);
    vi.spyOn(environment.media, "list").mockImplementation(async (input) => {
      const answer = await real(input);
      return answer.ok ? { ok: true, value: { ...answer.value, items: answer.value.items.map((item) => ({ ...item, bytes: 2_500_000 })) } } : answer;
    });
    renderAuth(MEDIA, { preset: "sahyadri-editor", environment });
    expect((await open("नदीकाठचा फेरफटका")).getByText("2.4 MB")).toBeInTheDocument();
  });

  it("offers no Delete for a picture a story uses, even a story the person cannot see", async () => {
    const environment = createMockApplicationEnvironment();
    const real = environment.media.list.bind(environment.media);
    vi.spyOn(environment.media, "list").mockImplementation(async (input) => {
      const answer = await real(input);
      return answer.ok
        ? { ok: true, value: { ...answer.value, items: answer.value.items.map((item) => (item.caption ? item : { ...item, usedBy: [], inUse: true })) } }
        : answer;
    });
    renderAuth(MEDIA, { preset: "sahyadri-editor", environment });
    const sheet = await open(UNTITLED);
    expect(sheet.getByText("No story uses this picture yet.")).toBeInTheDocument(); // none they may see
    expect(sheet.queryByRole("button", { name: "Delete the picture" })).not.toBeInTheDocument();
    expect(sheet.getByText("A story uses this picture, so it cannot be deleted.")).toBeInTheDocument();
  });

  it("keeps paging and a live refresh from cancelling each other", async () => {
    const environment = createMockApplicationEnvironment();
    const real = environment.media.list.bind(environment.media);
    const gate: { open?: () => void } = {};
    let firstPages = 0;
    // two pages: the picture still being prepared first, then the rest; the second first-page ask (the refresh) waits
    vi.spyOn(environment.media, "list").mockImplementation(async (input) => {
      const { cursor, ...query } = input.query;
      const answer = await real({ ...input, query });
      if (!answer.ok) return answer;
      if (cursor) return { ok: true, value: { items: answer.value.items.filter((item) => item.id !== "asset-demo-001"), next: null } };
      firstPages += 1;
      if (firstPages === 2) await new Promise<void>((resolve) => (gate.open = resolve));
      return { ok: true, value: { items: answer.value.items.filter((item) => item.id === "asset-demo-001"), next: "page-2" } };
    });
    renderAuth(MEDIA, { preset: "sahyadri-editor", environment });
    const user = userEvent.setup();
    expect(await names()).toEqual(["जलवाहिनीच्या दुरुस्तीचे काम"]);
    act(() => environment.sessionController.prepareAsset("asset-demo-001", "ready"));
    await waitFor(() => expect(gate.open).toBeDefined()); // the refresh is on its way
    await user.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(async () => expect(await names()).toHaveLength(4));
    act(() => gate.open!());
    await waitFor(async () => expect(within(await card("जलवाहिनीच्या दुरुस्तीचे काम")).getByText("Ready")).toBeInTheDocument());
    expect(await names()).toHaveLength(4);
  });

  it("shows a picture no story uses turn ready within a few seconds, in the grid and its open sheet", async () => {
    const { environment } = renderAuth(MEDIA, { preset: "sahyadri-photo-editor" });
    const user = userEvent.setup({ applyAccept: false });
    await grid();
    await user.upload(screen.getByLabelText("Upload photos", { selector: "input" }), [PNG("fictional-one.png")]);
    const fresh = "Picture without a caption, 800 × 600 px";
    expect(within(await card(fresh)).getByText("Preparing")).toBeInTheDocument();
    const sheet = await open(fresh);
    expect(sheet.getByText("Preparing")).toBeInTheDocument();
    environment.sessionController.prepareAsset("asset-new-001", "ready"); // no story: no live event
    await waitFor(() => expect(sheet.getByText("Ready")).toBeInTheDocument(), { timeout: 5_000 });
    await user.click(sheet.getByRole("button", { name: "Close dialog" }));
    await waitFor(async () => expect(within(await card(fresh)).getByText("Ready")).toBeInTheDocument(), { timeout: 5_000 });
  });

  it("hears a picture become ready", async () => {
    const { environment } = renderAuth(MEDIA, { preset: "sahyadri-editor" });
    expect(within(await card("जलवाहिनीच्या दुरुस्तीचे काम")).getByText("Preparing")).toBeInTheDocument();
    act(() => environment.sessionController.prepareAsset("asset-demo-001", "ready"));
    await waitFor(async () => expect(within(await card("जलवाहिनीच्या दुरुस्तीचे काम")).getByText("Ready")).toBeInTheDocument());
  });
});

describe("Who sees and changes what", () => {
  it("shows a Reporter only their own pictures, which they may change but not delete", async () => {
    renderAuth(MEDIA, { preset: "sahyadri-reporter" });
    expect(await names()).toEqual([UNTITLED]);
    expect(screen.getByRole("button", { name: "Upload photos" })).toBeInTheDocument();
    const sheet = await open(UNTITLED);
    expect(sheet.getByRole("textbox", { name: "Caption" })).not.toHaveAttribute("readonly");
    expect(sheet.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(sheet.queryByRole("button", { name: "Delete the picture" })).not.toBeInTheDocument();
  });

  it.each([
    [true, "someone else's upload they sent again"],
    [false, "their own upload the API says is not theirs to change"],
  ])("lets a Reporter change a picture when the API says so (%s: %s)", async (mayEdit) => {
    const environment = createMockApplicationEnvironment();
    const real = environment.media.list.bind(environment.media);
    const other = { id: "user-demo-someone", name: "Fictional Colleague" };
    vi.spyOn(environment.media, "list").mockImplementation(async (input) => {
      const answer = await real(input);
      return answer.ok
        ? { ok: true, value: { ...answer.value, items: answer.value.items.map((item) => ({ ...item, ...(mayEdit ? { uploadedBy: other } : {}), mayEdit })) } }
        : answer;
    });
    renderAuth(MEDIA, { preset: "sahyadri-reporter", environment });
    const sheet = await open(UNTITLED);
    if (mayEdit) expect(sheet.getByRole("textbox", { name: "Caption" })).not.toHaveAttribute("readonly");
    else expect(sheet.getByRole("textbox", { name: "Caption" })).toHaveAttribute("readonly");
    expect(!!sheet.queryByRole("button", { name: "Save" })).toBe(mayEdit);
  });

  it("lets a Viewer look, read only", async () => {
    renderAuth("/org/org-demo-konkan/pub/pub-demo-ratnagiri-tide/media", { preset: "konkan-reviewer" });
    expect(await names()).toEqual(["Fictional harbour at dawn"]);
    expect(screen.queryByRole("button", { name: "Upload photos" })).not.toBeInTheDocument();
    const sheet = await open("Fictional harbour at dawn");
    expect(sheet.getByText("Prints sharp up to 3 columns at 150 ppi")).toBeInTheDocument();
    expect(sheet.getByRole("textbox", { name: "Caption" })).toHaveAttribute("readonly");
    expect(sheet.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(sheet.queryByRole("button", { name: "Delete the picture" })).not.toBeInTheDocument();
    // and looks it: the kit greys a read-only field (jsdom applies no stylesheet, so the rule itself is checked)
    expect(readFileSync(join(import.meta.dirname, "../../src/ui/kit.css"), "utf8")).toMatch(/\.pg-app \.pg-input\[readonly\],\s*\.pg-app \.pg-textarea\[readonly\] \{\s*background-color: var\(--pg-app-canvas\)/);
  });
});

describe("Choose from library, in the story editor", () => {
  it("attaches a library picture, its caption and credit filling the story's empty ones; a refused one cannot be chosen", async () => {
    const { environment } = renderAuth(`/org/${ORG}/pub/${PUB}/stories/story-demo-003`, { preset: "sahyadri-editor" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Choose from library" }));
    const picker = within(await screen.findByRole("dialog", { name: "Choose from library" }));
    expect(await picker.findByRole("button", { name: "Fictional damaged file" })).toBeDisabled();
    await user.click(picker.getByRole("button", { name: "नदीकाठचा फेरफटका" }));
    expect(await screen.findByText("The photo is attached.")).toBeInTheDocument();
    const story = await environment.stories.get({ orgId: ORG, pubId: PUB, storyId: "story-demo-003" });
    expect(story.ok && story.value.photo).toMatchObject({ assetId: "asset-demo-004", caption: "नदीकाठचा फेरफटका", credit: "Fictional Photo Desk" });
    expect(screen.getByLabelText("Caption")).toHaveValue("नदीकाठचा फेरफटका");
  });
});
