import { describe, expect, it } from "vitest";
import { BookingInput, BookingPatch, checkArtwork } from "../src/index.ts";

const slot = { wMm: 100, hMm: 50 };
const states = (r: ReturnType<typeof checkArtwork>) => Object.fromEntries(r.checks.map((c) => [c.check, c.state]));

describe("checkArtwork", () => {
  it("passes a picture of the slot's shape at 200 ppi or more, with the colour note", () => {
    const r = checkArtwork({ widthPx: 788, heightPx: 394 }, slot); // 100 × 50 mm at 200.15 ppi
    expect(r.passed).toBe(true);
    expect(states(r)).toEqual({ shape: "passed", resolution: "passed", colour: "note" });
    expect(r.checks[0]).toMatchObject({ printWMm: 100, printHMm: 50, ppi: 200, needWPx: 788, needHPx: 394 });
  });

  it("allows 0.5 mm of empty slot and refuses more", () => {
    // 100 × 49.5 mm: 0.5 mm short down
    expect(checkArtwork({ widthPx: 1000, heightPx: 495 }, slot).passed).toBe(true);
    const short = checkArtwork({ widthPx: 1000, heightPx: 490 }, slot); // 100 × 49 mm
    expect(states(short).shape).toBe("failed");
    expect(short.checks[0]).toMatchObject({ printWMm: 100, printHMm: 49, shortWMm: 0, shortHMm: 1 });
    const narrow = checkArtwork({ widthPx: 980, heightPx: 500 }, slot); // 98 × 50 mm: 2 mm too narrow
    expect(narrow.checks[0]).toMatchObject({ shortWMm: 2, shortHMm: 0, state: "failed" });
  });

  it("refuses a picture under 200 ppi at its printed size", () => {
    const r = checkArtwork({ widthPx: 590, heightPx: 295 }, slot); // about 149.9 ppi
    expect(states(r)).toEqual({ shape: "passed", resolution: "failed", colour: "note" });
    expect(r.checks[1]?.ppi).toBe(149);
    expect(r.passed).toBe(false);
  });
});

describe("booking shapes", () => {
  const ok = {
    advertiserId: "0190f0f0-0000-7000-8000-000000000001",
    wMm: 100,
    hMm: 50,
    colour: "colour",
    slot: null,
    dates: ["2026-12-01"],
  };
  it("takes a booking and refuses a date named twice", () => {
    expect(BookingInput.safeParse(ok).success).toBe(true);
    expect(BookingInput.safeParse({ ...ok, dates: ["2026-12-01", "2026-12-01"] }).success).toBe(false);
  });
  it("changes a size only whole", () => {
    expect(BookingPatch.safeParse({ wMm: 90 }).success).toBe(false);
    expect(BookingPatch.safeParse({ wMm: 90, hMm: 40 }).success).toBe(true);
    expect(BookingPatch.safeParse({}).success).toBe(false);
  });
});
