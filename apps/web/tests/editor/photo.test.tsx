/**
 * The page editor's photo crop, rulers and zoom to the selected story (A6, ported from the Desk's editor.js), on the
 * test double: the lead story has a fictional 2400 × 1600 px photo in a frame of 196 × 60 mm, the layout showing its
 * middle 734 rows. Each crop change (a drag, a focal click, the slider, a reset) is one `set` change and one undo step;
 * a crop the engine drops is said; "Update text" says the crops it reset and the advertisements it set; the rulers'
 * choice is kept in this browser; a read-only page shows the modes and sends nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup, configure, fireEvent, getConfig, screen, waitFor, within } from "../../src/test/render.tsx";
import { createMockApplicationEnvironment } from "../../src/mocks/index.ts";
import type { EditChangeDto } from "../../src/services/index.ts";
import { RULERS_KEY } from "../../src/features/editor/PageEditorScreen.tsx";
import { focusAt, photoExtent } from "../../src/features/editor/view.ts";
import { renderAuth, resetBrowserState } from "../auth/helpers.tsx";

vi.setConfig({ testTimeout: 30_000 });

const EDIT =
  "/org/org-demo-sahyadri/pub/pub-demo-pune-daily/editions/edition-demo-2026-10-24/runs/run-demo-001/pages/1/edit";
const LEAD = "d0000000001";
const PHOTO = "p-00000000a1";
const LAYOUT_FOCUS = [0.5002, 0.5003]; // the centre of the layout's window [0, 433, 2400, 734]

// the stage is 800 × 600 px: the whole page (330 × 520 mm) at 552 / 520 px a mm, its corner at (224.85, 24)
const S = 552 / 520;
const OX = (800 - 330 * S) / 2;
const at = (x: number, y: number) => ({ clientX: Math.round(OX + x * S), clientY: Math.round(24 + y * S) });

// a busy machine opens a page in more than the default second
const WAIT = getConfig().asyncUtilTimeout;
beforeEach(() => {
  configure({ asyncUtilTimeout: 10_000 });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.stubGlobal(
    "Path2D",
    class {
      constructor(readonly d?: string) {}
    },
  );
  const stage = (el: Element, px: number) => (el.classList.contains("pg-editor__stage") ? px : 0);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return stage(this, 800);
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
    return stage(this, 600);
  });
});
afterEach(() => {
  cleanup(); // the screen leaves before the canvas's stubs go (a history still loading draws nothing)
  configure({ asyncUtilTimeout: WAIT });
  resetBrowserState();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function open(preset: "sahyadri-editor" | "sahyadri-reporter" = "sahyadri-editor") {
  const environment = createMockApplicationEnvironment();
  const original = environment.editor.change.bind(environment.editor);
  const change = vi.spyOn(environment.editor, "change");
  const rendered = renderAuth(EDIT, { preset, environment });
  return { ...rendered, environment, change, original };
}

const ready = () => screen.findByRole("heading", { name: "Selected story" });
const select = async (name: RegExp) =>
  userEvent.click(within(screen.getByRole("region", { name: "On this page" })).getByRole("button", { name }));
const canvas = () => screen.getByRole("application");
const photo = () => within(screen.getByRole("group", { name: "Photo" }));
const sent = (change: ReturnType<typeof open>["change"], i = -1) => change.mock.calls.at(i)![0].change as EditChangeDto;
const modulesOf = (c: EditChangeDto) => (c.kind === "set" ? c.modules : []);
const leadOf = (c: EditChangeDto) => modulesOf(c).find((m) => m.story === LEAD);
const settled = () => screen.findByText("Changed, not saved");

describe("the Photo group", () => {
  it("shows for a story with a photo: Crop photo and Set focal point switch the canvas's mode, Enter and Esc go back", async () => {
    open();
    await ready();
    await select(/Fictional market/);
    expect(screen.queryByRole("group", { name: "Photo" })).not.toBeInTheDocument(); // it has no photo
    await select(/गुरुवारी/);
    expect(photo().getByText("311 ppi: prints sharp")).toBeInTheDocument();
    expect(photo().getByRole("slider", { name: "Enlarge" })).toHaveAttribute("max", "207");
    expect(photo().getByRole("button", { name: "Reset crop" })).toBeDisabled();
    const crop = photo().getByRole("button", { name: "Crop photo" });
    const focal = photo().getByRole("button", { name: "Set focal point" });
    expect(crop).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(crop);
    expect(crop).toHaveAttribute("aria-pressed", "true");
    expect(canvas()).toHaveAccessibleName(/^The page, photo mode:/);
    expect(screen.getByText(/^Photo mode: drag the photo of/)).toBeInTheDocument(); // said in the live status
    await userEvent.click(focal);
    expect(focal).toHaveAttribute("aria-pressed", "true");
    expect(canvas()).toHaveAccessibleName(/^The page, focal point:/);
    expect(screen.getByText(/^Click the subject of the photo/)).toBeInTheDocument();
    canvas().focus();
    await userEvent.keyboard("{Escape}");
    expect(crop).toHaveAttribute("aria-pressed", "true");
    await userEvent.keyboard("{Enter}");
    expect(crop).toHaveAttribute("aria-pressed", "false");
    expect(canvas()).toHaveAccessibleName(/^The page\. Click a story/);
    expect(screen.getByText("Selecting stories.")).toBeInTheDocument();
  });
});

describe("a crop change is one change and one undo step", () => {
  it("a drag of the photo sends one set change whose module carries the crop", async () => {
    const { change } = open();
    await ready();
    await select(/गुरुवारी/);
    await userEvent.click(photo().getByRole("button", { name: "Crop photo" }));
    const from = at(108, 100); // inside the frame (15..211 × 72..132 mm)
    fireEvent.pointerDown(canvas(), { button: 0, pointerId: 1, ...from });
    fireEvent.pointerMove(canvas(), { pointerId: 1, ...from, clientY: from.clientY + 40 });
    fireEvent.pointerMove(canvas(), { pointerId: 1, ...from, clientY: from.clientY + 70 });
    fireEvent.pointerUp(canvas(), { pointerId: 1, ...from, clientY: from.clientY + 70 });
    await waitFor(() => expect(change).toHaveBeenCalledTimes(1));
    // 66 mm down: the window reaches the photo's top (row 0)
    expect(sent(change)).toMatchObject({ kind: "set", rev: 0 });
    expect(leadOf(sent(change))).toMatchObject({ x: 15, y: 60, w: 4, h: 120 });
    expect(leadOf(sent(change))!.crop).toEqual({ photo: PHOTO, focus: [0.5002, 0.2297], zoom: 1 });
    expect(modulesOf(sent(change)).find((m) => m.story !== LEAD)!.crop).toBeUndefined();
    await settled();
    expect(photo().getByRole("button", { name: "Reset crop" })).toBeEnabled();
  });

  it("a click in focal mode sets the focal point under it", async () => {
    const { change } = open();
    await ready();
    await select(/गुरुवारी/);
    await userEvent.click(photo().getByRole("button", { name: "Set focal point" }));
    const click = at(108, 100);
    fireEvent.pointerDown(canvas(), { button: 0, pointerId: 1, ...click });
    await waitFor(() => expect(change).toHaveBeenCalledTimes(1));
    const ext = photoExtent([15, 72, 211, 132], [0, 433, 2400, 734], [2400, 1600]);
    const focus = focusAt((click.clientX - OX) / S, (click.clientY - 24) / S, ext);
    expect(leadOf(sent(change))!.crop).toEqual({ photo: PHOTO, focus, zoom: 1 });
    expect(focus[0]).toBeCloseTo(0.4769, 2); // about the middle of the frame, a little left of the photo's
  });

  it("the slider is sent when let go, its resolution shown as it moves, and undo restores the earlier crop", async () => {
    const { change } = open();
    await ready();
    await select(/गुरुवारी/);
    const slider = photo().getByRole("slider", { name: "Enlarge" });
    fireEvent.change(slider, { target: { value: "150" } });
    expect(photo().getByText("207 ppi: prints sharp")).toBeInTheDocument();
    expect(change).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider);
    await waitFor(() => expect(change).toHaveBeenCalledTimes(1));
    expect(leadOf(sent(change))!.crop).toEqual({ photo: PHOTO, focus: LAYOUT_FOCUS, zoom: 1.5 });
    await settled();
    fireEvent.change(slider, { target: { value: "207" } });
    expect(photo().getByText("Enlarged as far as it prints sharp (150 ppi).")).toBeInTheDocument();
    fireEvent.keyUp(slider);
    await waitFor(() => expect(change).toHaveBeenCalledTimes(2));
    expect(leadOf(sent(change))!.crop).toEqual({ photo: PHOTO, focus: LAYOUT_FOCUS, zoom: 2.07 });
    await waitFor(() => expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(change).toHaveBeenCalledTimes(3));
    expect(leadOf(sent(change))!.crop).toEqual({ photo: PHOTO, focus: LAYOUT_FOCUS, zoom: 1.5 });
  });

  it("Reset crop sends the photo without a crop", async () => {
    const { change } = open();
    await ready();
    await select(/गुरुवारी/);
    const slider = photo().getByRole("slider", { name: "Enlarge" });
    fireEvent.change(slider, { target: { value: "120" } });
    fireEvent.pointerUp(slider);
    await waitFor(() => expect(change).toHaveBeenCalledTimes(1));
    await settled();
    await waitFor(() => expect(photo().getByRole("button", { name: "Reset crop" })).toBeEnabled());
    await userEvent.click(photo().getByRole("button", { name: "Reset crop" }));
    await waitFor(() => expect(change).toHaveBeenCalledTimes(2));
    expect(leadOf(sent(change))!.crop).toBeNull();
    expect(leadOf(sent(change))).toMatchObject({ x: 15, y: 60, w: 4, h: 120 });
  });
});

describe("crops the engine drops", () => {
  it("a crop sent for a photo the story no longer has comes back none, and the editor says so", async () => {
    const { change, original } = open();
    await ready();
    change.mockImplementationOnce(async (input) => {
      const c = input.change;
      // the engine's answer: the story's photo was replaced meanwhile, so its crop is gone
      return original(
        c.kind === "set"
          ? { ...input, change: { ...c, modules: c.modules.map((m) => ({ ...m, crop: null })) } }
          : input,
      );
    });
    await select(/गुरुवारी/);
    const slider = photo().getByRole("slider", { name: "Enlarge" });
    fireEvent.change(slider, { target: { value: "130" } });
    fireEvent.pointerUp(slider);
    expect(
      await screen.findByText("The photo of “गुरुवारी पाणीपुरवठा बंद” changed: its crop is reset."),
    ).toBeInTheDocument();
  });

  it("Update text says the crops it reset and that the page's advertisements are set as the edition has them", async () => {
    const { change, original } = open();
    await ready();
    change.mockImplementationOnce(async (input) => {
      const r = await original(input);
      return r.ok
        ? { ok: true, value: { ...r.value, view: { ...r.value.view, crops_reset: [LEAD], ads_changed: ["ad1"] } } }
        : r;
    });
    await userEvent.click(screen.getByRole("button", { name: "Update text" }));
    expect(
      await screen.findByText(
        "The stories' current text is set on the page. Save page to make the print file. " +
          "The advertisements on this page are set as the edition has them now. " +
          "The photo of “गुरुवारी पाणीपुरवठा बंद” changed: its crop is reset.",
      ),
    ).toBeInTheDocument();
  });
});

describe("the view: rulers and zoom to the selected story", () => {
  it("Rulers is pressed at first; hiding them is kept in this browser", async () => {
    const { unmount } = open();
    await ready();
    const rulers = screen.getByRole("button", { name: "Rulers" });
    expect(rulers).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(rulers);
    expect(rulers).toHaveAttribute("aria-pressed", "false");
    expect(window.localStorage.getItem(RULERS_KEY)).toBe("0");
    unmount();
    open();
    await ready();
    expect(screen.getByRole("button", { name: "Rulers" })).toHaveAttribute("aria-pressed", "false");
  });

  it("Zoom to the selected story needs a selection, then fills the view with it", async () => {
    const { container } = open();
    await ready();
    const zoom = screen.getByRole("button", { name: "Zoom to the selected story" });
    expect(zoom).toBeDisabled();
    const spacer = container.querySelector<HTMLElement>(".pg-editor__spacer")!;
    expect(spacer.style.inlineSize).toBe("800px"); // the whole page
    await select(/गुरुवारी/);
    await userEvent.click(zoom);
    // inside the rulers (780 × 580 px) with 32 px around: 716 px for the story's 196 mm
    expect(parseFloat(spacer.style.inlineSize)).toBeCloseTo(330 * (716 / 196) + 48, 3);
  });
});

describe("a read-only page", () => {
  it("shows the photo modes and sends nothing", async () => {
    const { change } = open("sahyadri-reporter");
    await ready();
    await select(/गुरुवारी/);
    expect(photo().getByRole("slider", { name: "Enlarge" })).toBeDisabled();
    expect(photo().getByRole("button", { name: "Reset crop" })).toBeDisabled();
    await userEvent.click(photo().getByRole("button", { name: "Crop photo" }));
    expect(canvas()).toHaveAccessibleName(/^The page, photo mode:/);
    canvas().focus();
    await userEvent.keyboard("{ArrowDown}");
    const from = at(108, 100);
    fireEvent.pointerDown(canvas(), { button: 0, pointerId: 1, ...from });
    fireEvent.pointerMove(canvas(), { pointerId: 1, ...from, clientY: from.clientY + 40 });
    fireEvent.pointerUp(canvas(), { pointerId: 1, ...from, clientY: from.clientY + 40 });
    expect(change).not.toHaveBeenCalled(); // a change would have been sent at once
  });
});
