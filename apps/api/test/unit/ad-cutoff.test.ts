// The ads cut-off's pure parts (src/modules/ads/cutoff.ts problemOf; src/modules/notifications/emails.ts
// adArtworkMissingEmail): why an ad's artwork will not print, and the email in both languages. All names are fictional.
import { describe, expect, it } from "vitest";
import { problemOf } from "../../src/modules/ads/cutoff.ts";
import { adArtworkMissingEmail } from "../../src/modules/notifications/emails.ts";

const booking = { id: "b", advertiser: "Example Jewellers", campaign: "", wMm: 100, hMm: 80 };

describe("problemOf", () => {
  it("names no artwork, an unusable picture, and one that fails a check; a good one is none", () => {
    expect(problemOf({ ...booking, picture: null })).toBe("none");
    for (const status of ["rejected", "failed"]) {
      expect(problemOf({ ...booking, picture: { status, widthPx: 1000, heightPx: 800 } })).toBe("unusable");
    }
    // the wrong shape, and too few pixels (127 ppi)
    expect(problemOf({ ...booking, picture: { status: "ready", widthPx: 1000, heightPx: 1000 } })).toBe("checks");
    expect(problemOf({ ...booking, picture: { status: "ready", widthPx: 500, heightPx: 400 } })).toBe("checks");
    expect(problemOf({ ...booking, picture: { status: "received", widthPx: 1000, heightPx: 800 } })).toBeNull();
  });
});

describe("adArtworkMissingEmail", () => {
  const input = {
    name: "Ads <b>(fictional)</b>",
    publication: "Example Times",
    date: "2027-03-10",
    ads: [
      { advertiser: "Example Jewellers", campaign: "Gudi Padwa", wMm: 100, hMm: 80, problem: "none" as const },
      { advertiser: "Example Sweets", campaign: "", wMm: 50, hMm: 40, problem: "checks" as const },
    ],
    origin: "https://app.example.test",
    orgId: "01900000-0000-7000-8000-000000000001",
    publicationId: "01900000-0000-7000-8000-000000000002",
  };

  it("lists each ad and what is wrong, in the reader's language first, linking to the Ads desk", () => {
    const mr = adArtworkMissingEmail({ ...input, language: "mr" });
    const en = adArtworkMissingEmail({ ...input, language: "en" });
    expect(mr.kind).toBe("ad-artwork-missing");
    expect(mr.text.indexOf("अंतिम वेळ")).toBeLessThan(mr.text.indexOf("cut-off"));
    expect(en.text.indexOf("cut-off")).toBeLessThan(en.text.indexOf("अंतिम वेळ"));
    expect(en.text).toContain("• Example Jewellers (Gudi Padwa), 100 × 80 mm: no artwork yet");
    expect(en.text).toContain("• Example Sweets, 50 × 40 mm: its picture does not fit the size or is not sharp enough");
    expect(en.text).toContain(`${input.origin}/org/${input.orgId}/pub/${input.publicationId}/ads?date=2027-03-10`);
    expect(en.html).toContain("Ads &lt;b&gt;(fictional)&lt;/b&gt;");
    expect(en.subject).not.toMatch(/[\r\n]/);
  });
});
