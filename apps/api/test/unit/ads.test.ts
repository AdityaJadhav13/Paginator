// The placement rules of the ads desk (src/modules/ads/place.ts): the sizes a profile offers, fit, the order of placing,
// why a booking is not placed, and a booking's artwork state.
import { describe, expect, it } from "vitest";
import type { BookingRow } from "../../src/db/ads.ts";
import type { Plan } from "../../src/db/layout.ts";
import { adSizes, artworkState, choose, fits, reasonOf } from "../../src/modules/ads/place.ts";

const page = (n: number, slots: { slot: string; w_mm: number; h_mm: number }[]) => ({
  page: n,
  role: "back" as const,
  template_role: "back",
  news_mm2: 0,
  ad_slots: slots,
});
const plan = (ads: boolean, slots: { slot: string; w_mm: number; h_mm: number }[]) =>
  ({ pages: 4, back_page_ads: ads, page_plan: [page(4, slots)] }) as unknown as Plan;

const A = { slot: "back-1", wMm: 120, hMm: 80.5 };
const B = { slot: "back-2", wMm: 120, hMm: 80.5 };
const S = { slot: "back-3", wMm: 60, hMm: 40 };

describe("the placement rules", () => {
  it("offer each back-page slot once, from the plans with back-page ads only", () => {
    expect(
      adSizes([
        plan(false, [{ slot: "x", w_mm: 1, h_mm: 1 }]),
        plan(true, [{ slot: "back-1", w_mm: 120, h_mm: 80.5 }]),
        plan(true, [
          { slot: "back-1", w_mm: 99, h_mm: 99 },
          { slot: "back-3", w_mm: 60, h_mm: 40 },
        ]),
      ]),
    ).toEqual([A, S]);
    expect(adSizes(null)).toEqual([]);
  });

  it("fit by size within 0.01 mm and by the named slot", () => {
    expect(fits({ wMm: 120.01, hMm: 80.49, slot: null }, A)).toBe(true);
    expect(fits({ wMm: 120.02, hMm: 80.5, slot: null }, A)).toBe(false);
    expect(fits({ wMm: 120, hMm: 80.5, slot: "back-2" }, A)).toBe(false);
    expect(fits({ wMm: 120, hMm: 80.5, slot: "back-2" }, B)).toBe(true);
  });

  it("place in the order booked, each in the first free slot it fits", () => {
    const any = (id: string) => ({ id, wMm: 120, hMm: 80.5, slot: null });
    const picks = choose(
      [any("one"), { id: "named", wMm: 120, hMm: 80.5, slot: "back-1" }, any("two"), any("three")],
      [A, B, S],
      new Map([["back-2", "held"]]),
    );
    expect(picks.map((p) => [p.bookingId, p.slot.slot])).toEqual([["one", "back-1"]]);
    expect(choose([any("held")], [A], new Map([["back-2", "held"]]))).toEqual([]);
  });

  it("say why a booking is not placed", () => {
    const on = { profile: true, backPageAds: true };
    const any = { wMm: 120, hMm: 80.5, slot: null };
    expect(reasonOf(any, [A], new Map(), { profile: false, backPageAds: true })).toBe("no_profile");
    expect(reasonOf(any, [A], new Map(), { profile: true, backPageAds: false })).toBe("no_ad_pages");
    expect(reasonOf({ ...any, wMm: 100 }, [A, B], new Map(), on)).toBe("no_slot");
    expect(reasonOf({ ...any, slot: "back-9" }, [A, B], new Map(), on)).toBe("no_slot");
    expect(
      reasonOf(
        any,
        [A, B],
        new Map([
          ["back-1", "x"],
          ["back-2", "y"],
        ]),
        on,
      ),
    ).toBe("slots_taken");
    expect(reasonOf(any, [A, B], new Map([["back-1", "x"]]), on)).toBe("taken_out");
  });

  it("pass a booking's artwork only when its picture passes every check and can be used", () => {
    const row = (asset: Partial<NonNullable<BookingRow["asset"]>> | null, id: string | null = "p") =>
      ({
        w_mm: "120.00",
        h_mm: "80.50",
        slot: null,
        artwork_asset_id: id,
        asset:
          asset === null
            ? null
            : {
                status: "ready",
                width_px: 1000,
                height_px: 671,
                version_id: "v",
                sha256: "s",
                deleted: false,
                ...asset,
              },
      }) as BookingRow;
    expect(artworkState(row(null, null))).toBe("none");
    expect(artworkState(row({}))).toBe("passed");
    expect(artworkState(row({ status: "received" }))).toBe("passed");
    expect(artworkState(row({ width_px: 2000, height_px: 1500 }))).toBe("failed");
    expect(artworkState(row({ width_px: 500, height_px: 335 }))).toBe("failed");
    expect(artworkState(row({ status: "rejected" }))).toBe("failed");
    expect(artworkState(row({ deleted: true }))).toBe("failed");
    expect(artworkState(row({ version_id: null }))).toBe("failed");
  });
});
