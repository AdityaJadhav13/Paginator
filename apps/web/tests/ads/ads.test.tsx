/**
 * The ads desk and the edition plan (plan §1 L2.6), on the test double with fictional data: the desk on a date
 * (tomorrow by default), advertisers (added, 409 advertiser_exists), a booking made with a new advertiser inline, its
 * placement shown, its artwork (a PDF refused before any upload; a wrong-size picture worded from the API's numbers;
 * a good one Ready), the date's unplaced bookings with the reason and "Place booked ads", cancelling; the Plan tab
 * (tiles, slots, take out and choose, a page's note, "Copy plan from…"), the Ads tab's booking holder and 409
 * slot_booked; the cut-off notification; what each role sees; axe in English and Marathi.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "../../src/test/render.tsx";
import { checkArtwork } from "@pageinator/contracts";
import { createMockApplicationEnvironment } from "../../src/mocks/index.ts";
import { checkSentence } from "../../src/features/ads/ads-words.tsx";
import { everyDay, nextDay } from "../../src/features/ads/BookingDrawer.tsx";
import { todayInIndia } from "../../src/features/layout/TodayCard.tsx";
import { notificationLink, notificationText } from "../../src/features/live/Notifications.tsx";
import { translator } from "../../src/i18n/index.ts";
import { renderAuth, resetBrowserState, seriousViolations } from "../auth/helpers.tsx";

vi.setConfig({ testTimeout: 30_000 });

const ORG = "org-demo-sahyadri";
const PUB = "pub-demo-pune-daily";
const A = "edition-demo-2026-10-23";
const B = "edition-demo-2026-10-24";
const DESK = (date?: string) => `/org/${ORG}/pub/${PUB}/ads${date ? `?date=${date}` : ""}`;
const LAYOUT = (edition: string, tab: string) => `/org/${ORG}/pub/${PUB}/editions/${edition}/layout?tab=${tab}`;
const W = { orgId: ORG, pubId: PUB };

/** A PNG header the media double reads the pixel size from. */
const PNG = (width: number, height: number, name = "fictional-ad.png") =>
  new File(
    [
      new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
        (width >> 24) & 255, (width >> 16) & 255, (width >> 8) & 255, width & 255,
        (height >> 24) & 255, (height >> 16) & 255, (height >> 8) & 255, height & 255,
      ]),
    ],
    name,
    { type: "image/png" },
  );

afterEach(() => {
  resetBrowserState();
  vi.restoreAllMocks();
});

/** An advertiser and a booking made on the double, as the ads desk would. */
async function booked(
  environment: ReturnType<typeof createMockApplicationEnvironment>,
  name: string,
  fields: { slot?: string | null; wMm?: number; hMm?: number; dates?: string[] } = {},
) {
  const advertiser = await environment.ads.addAdvertiser({ ...W, input: { name } });
  if (!advertiser.ok) throw new Error("advertiser");
  const booking = await environment.ads.book({
    ...W,
    idempotencyKey: name,
    input: {
      advertiserId: advertiser.value.id,
      wMm: fields.wMm ?? 162,
      hMm: fields.hMm ?? 100,
      colour: "colour",
      slot: fields.slot === undefined ? "back-2" : fields.slot,
      dates: fields.dates ?? ["2026-10-24"],
    },
  });
  if (!booking.ok) throw new Error("booking");
  return booking.value;
}

describe("the artwork check's words", () => {
  const en = translator("en");
  it("words a shape and a resolution failure from the API's numbers", () => {
    const space = { wMm: 100, hMm: 50 };
    const narrow = checkArtwork({ widthPx: 980, heightPx: 500 }, space).checks[0]!;
    expect(narrow.state).toBe("failed");
    expect(checkSentence(narrow, space, en)).toBe("2 mm too narrow: it would print 98 × 50 mm in a 100 × 50 mm space.");
    const short = checkArtwork({ widthPx: 1000, heightPx: 400 }, space).checks[0]!;
    expect(checkSentence(short, space, en)).toBe("10 mm too short: it would print 100 × 40 mm in a 100 × 50 mm space.");
    const low = checkArtwork({ widthPx: 591, heightPx: 296 }, space).checks;
    expect(low[0]!.state).toBe("passed");
    expect(checkSentence(low[1]!, space, en)).toBe(
      "150 ppi at this size; print needs 200 ppi: at least 788 × 394 pixels.",
    );
    expect(checkSentence(low[2]!, space, translator("mr"))).toContain("CMYK");
  });

  it("fills every day of a range, at most a year", () => {
    expect(everyDay("2026-12-30", "2027-01-02")).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
    expect(everyDay("2026-01-01", "2027-01-02")).toBeNull();
    expect(nextDay("2028-02-28")).toBe("2028-02-29");
  });
});

describe("the Ads desk", () => {
  it("opens on tomorrow, and is in the Advertising role's sidebar", async () => {
    const { container } = renderAuth(DESK(), { preset: "sahyadri-advertising" });
    expect(await screen.findByRole("heading", { level: 1, name: "Ads desk" })).toBeInTheDocument();
    expect(await screen.findByLabelText("Date to work on")).toHaveValue(nextDay(todayInIndia()));
    expect(screen.getByRole("link", { name: "Ads" })).toBeInTheDocument();
    expect(await screen.findByText("No ads are booked for this date.")).toBeInTheDocument();
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("books an ad with a new advertiser, shows where it is placed, and cancels it", async () => {
    const { environment, container } = renderAuth(DESK("2026-10-24"), { preset: "sahyadri-advertising" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "New booking" }));
    const drawer = within(await screen.findByRole("dialog", { name: "New booking" }));
    // only the profile's real back-page spaces are offered
    const size = drawer.getByLabelText(/^Size/);
    expect(within(size).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Choose a size",
      "back-1 · 330 × 170 mm",
      "back-2 · 162 × 100 mm",
    ]);
    // nothing is sent while a field is missing
    const book = vi.spyOn(environment.ads, "book");
    await user.click(drawer.getByRole("button", { name: "Book" }));
    expect(await drawer.findByText("Choose an advertiser, or add a new one.")).toBeInTheDocument();
    expect(book).not.toHaveBeenCalled();

    await user.selectOptions(drawer.getByLabelText(/^Advertiser/), "Add a new advertiser…");
    await user.type(drawer.getByLabelText(/^Advertiser's name/), "Example Jewellers");
    await user.type(drawer.getByLabelText("Campaign"), "Festival sale");
    await user.selectOptions(size, "back-2 · 162 × 100 mm");
    await user.click(drawer.getByRole("radio", { name: "Any back-page space of this size" }));
    await user.click(drawer.getByRole("radio", { name: "Black and white" }));
    // the range fill adds 25 and 26 October to the desk's own date
    await user.clear(drawer.getByLabelText("to"));
    await user.type(drawer.getByLabelText("to"), "2026-10-26");
    await user.click(drawer.getByRole("button", { name: "Add these days" }));
    expect(within(drawer.getByRole("list", { name: "Run dates: 3" })).getAllByRole("listitem")).toHaveLength(3);
    await user.click(drawer.getByRole("button", { name: "Remove 26 October 2026" }));
    expect(axeOk(await seriousViolations(container))).toBe(true);
    await user.click(drawer.getByRole("button", { name: "Book" }));

    expect(await drawer.findByText("Saved.")).toBeInTheDocument();
    expect(book).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ campaign: "Festival sale", wMm: 162, hMm: 100, colour: "mono", slot: null, dates: ["2026-10-24", "2026-10-25"] }),
      }),
    );
    // the drawer stays open on the booking, for its artwork
    expect(await screen.findByRole("dialog", { name: "Booking of Example Jewellers" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));

    const running = within(await screen.findByRole("table", { name: "Running on 24 October 2026" }));
    const row = within(running.getByRole("row", { name: /Example Jewellers/ }));
    expect(row.getByText("24 October 2026 · back-2")).toBeInTheDocument();
    expect(row.getByText("No artwork yet")).toBeInTheDocument();
    expect(row.getByText(/Any back-page space of this size · Black and white/)).toBeInTheDocument();

    await user.click(row.getByRole("button", { name: "Cancel the booking of Example Jewellers" }));
    const confirm = within(await screen.findByRole("dialog", { name: "Cancel this booking?" }));
    await user.click(confirm.getByRole("button", { name: "Cancel booking" }));
    await waitFor(() =>
      expect(within(screen.getByRole("table", { name: "All bookings" })).getByText("Cancelled")).toBeInTheDocument(),
    );
  });

  it("refuses a PDF before any upload, words a wrong-size picture, and takes a good one", async () => {
    const environment = createMockApplicationEnvironment();
    await booked(environment, "Example Jewellers");
    // Advertising uploads library pictures as artwork with ads.manage alone (no media.upload)
    renderAuth(DESK("2026-10-24"), { environment, preset: "sahyadri-advertising" });
    const user = userEvent.setup();
    const presign = vi.spyOn(environment.media, "presign");
    const running = within(await screen.findByRole("table", { name: "Running on 24 October 2026" }));
    const row = within(await running.findByRole("row", { name: /Example Jewellers/ }));
    await user.click(row.getByRole("button", { name: "Edit the booking of Example Jewellers" }));
    const drawer = within(await screen.findByRole("dialog", { name: "Booking of Example Jewellers" }));
    const input = drawer.getByLabelText("Upload artwork");

    await user.upload(input, new File(["%PDF-1.7"], "fictional-ad.pdf", { type: "application/pdf" }));
    expect(
      await drawer.findByText(
        "PDF artwork is not taken yet. Please send a JPEG, PNG or WebP picture of at least 200 ppi.",
      ),
    ).toBeInTheDocument();
    expect(presign).not.toHaveBeenCalled();

    // 162 × 100 mm: 1000 × 500 px prints 162 × 81 mm, at 156 ppi
    await user.upload(input, PNG(1000, 500));
    expect(await drawer.findByText("Problem")).toBeInTheDocument();
    expect(drawer.getByText("19 mm too short: it would print 162 × 81 mm in a 162 × 100 mm space.")).toBeInTheDocument();
    expect(
      drawer.getByText("156 ppi at this size; print needs 200 ppi: at least 1276 × 788 pixels."),
    ).toBeInTheDocument();
    expect(presign).toHaveBeenCalledWith(expect.objectContaining({ purpose: "library" }));

    await user.upload(drawer.getByLabelText("Upload artwork"), PNG(1276, 788));
    expect(await drawer.findByText("Ready")).toBeInTheDocument();
    // why it is ready: it fits, at enough ppi
    expect(drawer.getByText("Fits the space: it prints 161.9 × 100 mm in a 162 × 100 mm space.")).toBeInTheDocument();
    expect(drawer.getByText("200 ppi at this size; print needs 200 ppi.")).toBeInTheDocument();
    expect(drawer.getByText(/changed to the paper's print colours \(CMYK\)/)).toBeInTheDocument();
    expect(drawer.queryByText(/press-ready|PDF\/X/i)).not.toBeInTheDocument();
  });

  it("lets Advertising choose artwork already in the media library", async () => {
    const environment = createMockApplicationEnvironment();
    await booked(environment, "Example Jewellers");
    renderAuth(DESK("2026-10-24"), { environment, preset: "sahyadri-advertising" });
    const user = userEvent.setup();
    const running = within(await screen.findByRole("table", { name: "Running on 24 October 2026" }));
    await user.click(within(await running.findByRole("row", { name: /Example Jewellers/ })).getByRole("button", { name: /^Edit/ }));
    const drawer = within(await screen.findByRole("dialog", { name: "Booking of Example Jewellers" }));
    await user.click(drawer.getByRole("button", { name: "Choose from the media library" }));
    await user.click(await drawer.findByRole("button", { name: /नदीकाठचा फेरफटका/ }));
    // the fictional library picture (1600 × 1200 px) has the wrong shape for 162 × 100 mm
    expect(await drawer.findByText("Problem")).toBeInTheDocument();
  });

  it("says why the date's bookings are not placed, and places them", async () => {
    const environment = createMockApplicationEnvironment();
    await booked(environment, "Example Jewellers");
    await booked(environment, "Example Sweets");
    renderAuth(DESK("2026-10-24"), { environment, preset: "sahyadri-advertising" });
    const user = userEvent.setup();
    const day = within(await screen.findByRole("region", { name: "Booked but not placed: 1" }));
    expect(day.getByText(/every space of this size holds another booking/)).toBeInTheDocument();
    // the first taken out by hand: "Place booked ads" puts it back, the second still has no space
    await environment.ads.unplace({ ...W, editionId: B, slot: "back-2" });
    await user.click(await screen.findByRole("button", { name: "Place booked ads" }));
    await waitFor(() => {
      const running = within(screen.getByRole("table", { name: "Running on 24 October 2026" }));
      expect(within(running.getByRole("row", { name: /Example Jewellers/ })).getByText("24 October 2026 · back-2")).toBeInTheDocument();
    });
    expect(screen.getByRole("region", { name: "Booked but not placed: 1" })).toHaveTextContent("Example Sweets");
  });

  it("refuses a second advertiser of the same name plainly", async () => {
    const environment = createMockApplicationEnvironment();
    await environment.ads.addAdvertiser({ ...W, input: { name: "Example Jewellers" } });
    renderAuth(DESK("2026-10-24"), { environment, preset: "sahyadri-advertising" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add advertiser" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Add advertiser" }));
    await user.type(dialog.getByLabelText(/^Advertiser's name/), "example jewellers");
    await user.click(dialog.getByRole("button", { name: "Save" }));
    expect(await dialog.findByText(/An advertiser with this name already exists/)).toBeInTheDocument();
  });

  it("shows the cut-off settings to settings.edit and offers no booking to it, in Marathi too; axe clean", async () => {
    const { container } = renderAuth(DESK("2026-10-24"), { preset: "sahyadri-chief-editor", language: "mr" });
    expect(await screen.findByRole("heading", { level: 1, name: "जाहिरात विभाग" })).toBeInTheDocument();
    expect(await screen.findByLabelText("वेळ")).toHaveValue("18:00");
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("is not offered to a role without ads.view", async () => {
    renderAuth(DESK("2026-10-24"), { preset: "sahyadri-reporter" });
    expect(await screen.findByRole("heading", { level: 1, name: "Ads desk" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Date to work on")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Ads" })).not.toBeInTheDocument();
  });
});

describe("the edition's Plan tab", () => {
  it("draws the pages and the back page's slots, takes a booking out and puts it back", async () => {
    const environment = createMockApplicationEnvironment();
    await booked(environment, "Example Jewellers");
    const { container } = renderAuth(LAYOUT(B, "plan"), { environment, preset: "sahyadri-editor" });
    const user = userEvent.setup();
    expect(await screen.findByRole("tab", { name: "Plan" })).toHaveAttribute("aria-selected", "true");
    const pages = within(await screen.findByRole("list", { name: "Pages of this edition" }));
    expect(pages.getAllByRole("article")).toHaveLength(8);
    expect(pages.getByRole("heading", { name: "Page 1 · Front page" })).toBeInTheDocument();
    const slots = within(pages.getByRole("list", { name: "Ad spaces on page 8" }));
    expect(slots.getByText("Example Jewellers")).toBeInTheDocument();
    // booked, no artwork, the cut-off (23 October) long gone
    expect(slots.getByText("No usable artwork after the cut-off")).toBeInTheDocument();
    expect(await seriousViolations(container)).toEqual([]);

    await user.click(slots.getByRole("button", { name: "Take Example Jewellers out of space back-2" }));
    expect(await screen.findByText(/a space it fits is free/)).toBeInTheDocument();
    await user.click(slots.getByRole("button", { name: "Choose a booking for space back-2" }));
    const dialog = within(await screen.findByRole("dialog", { name: "A booking for space back-2" }));
    await user.click(dialog.getByRole("button", { name: "Place it here" }));
    expect(await slots.findByText("Example Jewellers")).toBeInTheDocument();
  });

  it("plans a page's section note and copies the plan from another edition", async () => {
    const environment = createMockApplicationEnvironment();
    await environment.ads.planPage({ ...W, editionId: A, page: 2, sectionId: null, note: "City news" });
    renderAuth(LAYOUT(B, "plan"), { environment, preset: "sahyadri-editor" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Plan page 3" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Plan page 3" }));
    await user.type(dialog.getByLabelText("Note to the designer"), "Fictional fair photos");
    await user.click(dialog.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Fictional fair photos")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Copy plan from…" }));
    const copy = within(await screen.findByRole("dialog", { name: "Copy plan from…" }));
    await user.selectOptions(await copy.findByLabelText("Edition to copy from"), "23 October 2026");
    await user.click(copy.getByRole("button", { name: "Copy plan" }));
    expect(await screen.findByText("Copied: 1 page's plan and 0 ad placements.")).toBeInTheDocument();
    expect(screen.getByText("City news")).toBeInTheDocument();
  });

  it("offers no changes to a role that may only look, and no Plan tab without edition.view", async () => {
    const environment = createMockApplicationEnvironment();
    await booked(environment, "Example Jewellers");
    renderAuth(LAYOUT(B, "plan"), { environment, preset: "sahyadri-advertising" });
    // Advertising places ads (ads.manage), but plans no page (edition.edit ◐)
    expect(await screen.findByRole("button", { name: "Take Example Jewellers out of space back-2" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Plan page/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy plan from…" })).not.toBeInTheDocument();
  });
});

describe("the edition's Ads tab", () => {
  it("names the booking that holds a slot and offers no picture for it; says so plainly when the route refuses", async () => {
    const environment = createMockApplicationEnvironment();
    await booked(environment, "Example Jewellers");
    // a booking placed in back-1 meanwhile (another person): the picture route refuses it
    vi.spyOn(environment.layout, "setAd").mockResolvedValue({
      ok: false,
      error: { kind: "answer", status: 409, code: "slot_booked", message: "slot_booked" },
    });
    renderAuth(LAYOUT(B, "ads"), { environment, preset: "sahyadri-editor" });
    const user = userEvent.setup();
    const slot = within(await screen.findByRole("region", { name: "Ad space back-2" }));
    expect(await slot.findByText("Example Jewellers")).toBeInTheDocument();
    expect(slot.getByText(/take the booking out on the Plan tab/)).toBeInTheDocument();
    expect(slot.queryByRole("button", { name: "Choose an image" })).not.toBeInTheDocument();
    expect(slot.queryByRole("button", { name: "Remove image" })).not.toBeInTheDocument();

    const free = within(screen.getByRole("region", { name: "Ad space back-1" }));
    await user.click(free.getByRole("button", { name: "Choose an image" }));
    const sheet = within(await screen.findByRole("dialog", { name: "Choose an image for ad space back-1" }));
    // an ad clerk is not shown the news photo filters
    expect(sheet.queryByLabelText("Missing")).not.toBeInTheDocument();
    await user.click(await sheet.findByRole("button", { name: /नदीकाठचा फेरफटका/ }));
    expect(await screen.findByText(/A booked ad holds this space/)).toBeInTheDocument();
  });
});

describe("the cut-off notification", () => {
  const base = {
    id: "n",
    publicationId: PUB,
    storyId: null,
    commentId: null,
    invitationId: null,
    actor: null,
    story: null,
    invitee: null,
    createdAt: "2026-10-23T12:30:00.000Z",
    readAt: null,
    kind: "ad_artwork_missing" as const,
  };
  it("says how many ads lack artwork for the date, in both languages, and leads to the desk on that date", () => {
    const item = { ...base, ads: { date: "2026-10-24", missing: 3 } };
    expect(notificationText(item, translator("en"))).toBe("3 booked ads have no usable artwork for 24 October 2026.");
    expect(notificationText({ ...item, ads: { date: "2026-10-24", missing: 1 } }, translator("en"))).toBe(
      "1 booked ad has no usable artwork for 24 October 2026.",
    );
    expect(notificationText(item, translator("mr"), "mr")).toContain("3 जाहिरातींना");
    expect(notificationLink(item, ORG, false)).toBe(`/org/${ORG}/pub/${PUB}/ads?date=2026-10-24`);
  });
});

describe("the Ads desk's refusals and edges", () => {
  /** Opens the drawer on the booking of `name`, made on the double. */
  async function openBooking(environment: ReturnType<typeof createMockApplicationEnvironment>, name: string) {
    renderAuth(DESK("2026-10-24"), { environment, preset: "sahyadri-advertising" });
    const user = userEvent.setup({ applyAccept: false }) // a file the picker would hide, as a drop could bring;
    const running = within(await screen.findByRole("table", { name: "Running on 24 October 2026" }));
    await user.click(within(await running.findByRole("row", { name: new RegExp(name) })).getByRole("button", { name: /^Edit/ }));
    return { user, drawer: within(await screen.findByRole("dialog", { name: `Booking of ${name}` })) };
  }

  it("words a picture that is not a PDF in the upload's own terms, and a failed upload plainly", async () => {
    const environment = createMockApplicationEnvironment();
    await booked(environment, "Example Jewellers");
    const { user, drawer } = await openBooking(environment, "Example Jewellers");
    await user.upload(drawer.getByLabelText("Upload artwork"), new File(["GIF89a"], "fictional-ad.gif", { type: "image/gif" }));
    expect(await drawer.findByText("This file is not a JPEG, PNG or WebP photo.")).toBeInTheDocument();
    expect(drawer.queryByText(/PDF artwork is not taken yet/)).not.toBeInTheDocument();

    vi.spyOn(environment.media, "complete").mockResolvedValue({
      ok: false,
      error: { kind: "answer", status: 422, code: "upload_refused", message: "upload_refused" },
    });
    await user.upload(drawer.getByLabelText("Upload artwork"), PNG(1276, 788));
    expect(await drawer.findByText("The photo store refused the upload. Try again.")).toBeInTheDocument();
    expect(drawer.queryByText("Ready")).not.toBeInTheDocument();
  });

  it("keeps the Idempotency-Key for a retry after a lost answer, and takes a new one after a refusal", async () => {
    const environment = createMockApplicationEnvironment();
    await environment.ads.addAdvertiser({ ...W, input: { name: "Example Sweets" } });
    renderAuth(DESK("2026-10-24"), { environment, preset: "sahyadri-advertising" });
    const user = userEvent.setup();
    const book = vi
      .spyOn(environment.ads, "book")
      .mockResolvedValueOnce({ ok: false, error: { kind: "network" } })
      .mockResolvedValueOnce({ ok: false, error: { kind: "answer", status: 400, code: "invalid_request", message: "x" } });
    await user.click(await screen.findByRole("button", { name: "New booking" }));
    const drawer = within(await screen.findByRole("dialog", { name: "New booking" }));
    await user.selectOptions(drawer.getByLabelText(/^Advertiser/), "Example Sweets");
    await user.selectOptions(drawer.getByLabelText(/^Size/), "back-2 · 162 × 100 mm");
    await user.click(drawer.getByRole("button", { name: "Book" }));
    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    await user.click(drawer.getByRole("button", { name: "Book" }));
    await waitFor(() => expect(book).toHaveBeenCalledTimes(2));
    await user.click(drawer.getByRole("button", { name: "Book" }));
    expect(await screen.findByRole("dialog", { name: "Booking of Example Sweets" })).toBeInTheDocument();
    const keys = book.mock.calls.map(([call]) => call.idempotencyKey);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
  });

  it("keeps an advertiser added while booking in the list when the booking fails", async () => {
    const environment = createMockApplicationEnvironment();
    renderAuth(DESK("2026-10-24"), { environment, preset: "sahyadri-advertising" });
    const user = userEvent.setup();
    vi.spyOn(environment.ads, "book").mockResolvedValue({
      ok: false,
      error: { kind: "answer", status: 400, code: "invalid_request", message: "x" },
    });
    await user.click(await screen.findByRole("button", { name: "New booking" }));
    const drawer = within(await screen.findByRole("dialog", { name: "New booking" }));
    await user.selectOptions(drawer.getByLabelText(/^Advertiser/), "Add a new advertiser…");
    await user.type(drawer.getByLabelText(/^Advertiser's name/), "Example Jewellers");
    await user.selectOptions(drawer.getByLabelText(/^Size/), "back-2 · 162 × 100 mm");
    await user.click(drawer.getByRole("button", { name: "Book" }));
    await waitFor(() =>
      expect(drawer.getByLabelText(/^Advertiser/)).toHaveDisplayValue("Example Jewellers"),
    );
  });

  it("offers no booking while there are no ad spaces, and says why", async () => {
    const environment = createMockApplicationEnvironment();
    vi.spyOn(environment.ads, "sizes").mockResolvedValue({ ok: true, value: { profile: null, slots: [] } });
    renderAuth(DESK("2026-10-24"), { environment, preset: "sahyadri-advertising" });
    expect(await screen.findByText(/There are no ad spaces to book yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New booking" })).toBeDisabled();
  });

  it("saves the cut-off, and refuses a days value that is empty or more than 7", async () => {
    const environment = createMockApplicationEnvironment();
    renderAuth(DESK("2026-10-24"), { environment, preset: "sahyadri-chief-editor" });
    const user = userEvent.setup();
    const save = vi.spyOn(environment.ads, "saveSettings");
    const days = await screen.findByLabelText("Days before the edition");
    await user.clear(days);
    expect(await screen.findByText("Enter a whole number of days from 0 to 7.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save cut-off" })).toBeDisabled();
    await user.type(days, "8");
    expect(screen.getByRole("button", { name: "Save cut-off" })).toBeDisabled();
    await user.clear(days);
    await user.type(days, "0");
    await user.click(screen.getByRole("button", { name: "Save cut-off" }));
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ settings: { cutoffTime: "18:00", daysBefore: 0 } }));
  });

  it("asks before archiving an advertiser, and brings one back at once", async () => {
    const environment = createMockApplicationEnvironment();
    await environment.ads.addAdvertiser({ ...W, input: { name: "Example Jewellers" } });
    renderAuth(DESK("2026-10-24"), { environment, preset: "sahyadri-advertising" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Archive Example Jewellers" }));
    const confirm = within(await screen.findByRole("dialog", { name: "Archive Example Jewellers?" }));
    await user.click(confirm.getByRole("button", { name: "Archive" }));
    expect(await screen.findByText("Archived")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Bring back Example Jewellers" }));
    await waitFor(() => expect(screen.queryByText("Archived")).not.toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("the Plan tab's states", () => {
  it("lists the publication's sections and keeps a page's section when only its note changes", async () => {
    const environment = createMockApplicationEnvironment();
    const planPage = vi.spyOn(environment.ads, "planPage");
    renderAuth(LAYOUT(B, "plan"), { environment, preset: "sahyadri-editor" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Plan page 3" }));
    let dialog = within(await screen.findByRole("dialog", { name: "Plan page 3" }));
    const section = dialog.getByLabelText("Section");
    expect(within(section).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "No section planned",
      "City",
      "Sport",
      "Business",
    ]);
    await user.selectOptions(section, "Sport");
    await user.click(dialog.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Planned: Sport")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Plan page 3" }));
    dialog = within(await screen.findByRole("dialog", { name: "Plan page 3" }));
    await user.type(dialog.getByLabelText("Note to the designer"), "Fictional derby photos");
    await user.click(dialog.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Fictional derby photos")).toBeInTheDocument();
    expect(screen.getByText("Planned: Sport")).toBeInTheDocument();
    expect(planPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 3, sectionId: "01900000-0000-7000-8000-00000000c002", note: "Fictional derby photos" }),
    );
  });

  it("keeps the page dialog open with the reason when the edition was released meanwhile", async () => {
    const environment = createMockApplicationEnvironment();
    vi.spyOn(environment.ads, "planPage").mockResolvedValue({
      ok: false,
      error: { kind: "answer", status: 409, code: "not_editable", message: "not_editable" },
    });
    renderAuth(LAYOUT(B, "plan"), { environment, preset: "sahyadri-editor" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Plan page 2" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Plan page 2" }));
    await user.click(dialog.getByRole("button", { name: "Save" }));
    expect(await dialog.findByText("This edition is released: its plan is shown, not changed.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Plan page 2" })).toBeInTheDocument();
  });

  it("shows a released plan with no changes, and a slot's own picture instead of Empty", async () => {
    const environment = createMockApplicationEnvironment();
    const real = await environment.ads.plan({ ...W, editionId: B });
    if (!real.ok) throw new Error("plan");
    const tiles = real.value.tiles.map((tile) => ({
      ...tile,
      slots: tile.slots.map((slot) => (slot.slot === "back-1" ? { ...slot, artwork: "ready" as const } : slot)),
    }));
    vi.spyOn(environment.ads, "plan").mockResolvedValue({ ok: true, value: { ...real.value, tiles, released: true } });
    renderAuth(LAYOUT(B, "plan"), { environment, preset: "sahyadri-editor" });
    expect(await screen.findByText("This edition is released: its plan is shown, not changed.")).toBeInTheDocument();
    const slots = within(screen.getByRole("list", { name: "Ad spaces on page 8" }));
    expect(slots.getByText("Image added")).toBeInTheDocument();
    expect(slots.getByText("Empty")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Plan page|Copy plan|Choose a booking|Take .* out/ })).not.toBeInTheDocument();
  });

  it("marks a booked slot without usable artwork amber before the cut-off and red after it", async () => {
    const environment = createMockApplicationEnvironment();
    await booked(environment, "Example Jewellers");
    // the cut-off of 24 October is 18:00 IST on 23 October
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-23T10:00:00.000Z"));
    renderAuth(LAYOUT(B, "plan"), { environment, preset: "sahyadri-editor", language: "mr" });
    const slots = within(await screen.findByRole("list", { name: /8/ }));
    expect(slots.getByText("अजून वापरण्याजोगे चित्र नाही")).toBeInTheDocument();
    expect(slots.queryByText("अंतिम वेळ उलटली, वापरण्याजोगे चित्र नाही")).not.toBeInTheDocument();
  });
});

const axeOk = (violations: string[]) => violations.length === 0;
