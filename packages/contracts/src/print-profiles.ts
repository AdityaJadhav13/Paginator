// Print profiles (docs/product/10-l2-newsroom-plan.md §1 "As built (screens)"; doc 07 §12 Print profiles row; migration
// 2026_12_06_0001): a publication's press details, numbered per publication. Each save is a new version (only added);
// the newest is the one in use, and a release records the one in use when it was approved (Release.printProfile).
// Beside them, read-only facts of what the engine and the checks actually do (PressFacts): nothing there is a setting.
//
// Routes, under /api/v1/orgs/:o/pubs/:p:
//   GET  print-profiles (print_profiles.view) → PrintProfiles: every version, newest first, and the facts.
//   POST print-profiles PrintProfileInput (print_profiles.edit; Idempotency-Key) → 201 PrintProfile: the next version.
//   GET  print-profiles/press-test (print_profiles.view) → 200 application/pdf: the G2 press test page (a fictional
//        photo and ad, rules, tints and registration marks, PDF/X-1a, 347 × 540 mm) the engine made through the edit
//        gateway (PressTestPage) and the independent PDF/X-1a check passed. Content-Disposition attachment
//        pageinator-press-test-<first 12 of its SHA-256>.pdf, Cache-Control no-store, X-Pageinator-Sha256 (the press
//        accepts it by this; the Release tab records it), X-Pageinator-Icc-Sha256, X-Pageinator-Check-Warnings.
//        503 press_test_unavailable: no gateway, unreachable, an answer outside PressTestPage or bytes whose SHA-256
//        is not the one given. 409 press_test_refused: the check failed, the recorded trim is not 347 × 540 mm (±1 mm),
//        or the recorded colour profile (PressFacts.iccSha256) is not the gateway's.
//        The trim is compared with page_mm (the pilot's format, the only one the gateway makes).
// Audit: print_profile.create (the press test page is a read-only download of fictional content: not audited).
import { z } from "zod";

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const Id = z.uuid();
const Person = z.strictObject({ id: Id, name: z.string() });

export const PrintProfile = z.strictObject({
  id: Id,
  /** 1, 2, … in the publication */
  version: z.number().int().min(1),
  pressName: z.string(),
  contact: z.string().nullable(),
  note: z.string().nullable(),
  createdBy: Person,
  createdAt: z.iso.datetime({ offset: true }),
});
export type PrintProfile = z.infer<typeof PrintProfile>;

/** An empty contact or note is none. */
export const PrintProfileInput = z.strictObject({
  pressName: z.string().trim().min(1).max(200),
  contact: z.string().trim().max(500).optional(),
  note: z.string().trim().max(2000).optional(),
});
export type PrintProfileInput = z.infer<typeof PrintProfileInput>;

/** What the engine and the checks actually do, read from what is recorded (null: not recorded). */
export const PressFacts = z.strictObject({
  /** the engine profile in use (its version), whose front template gives the trim size */
  engineProfileVersion: z.number().int().min(1).nullable(),
  /** the front template page's size as the engine's setup measured it (null: not recorded for this profile) */
  trim: z.strictObject({ wMm: z.number().positive(), hMm: z.number().positive() }).nullable(),
  /** the standard the independent check tests every page PDF against */
  pdfStandard: z.literal("PDF/X-1a"),
  /** the checker of the newest done layout run (null: no run yet) */
  checkerSha256: Sha256.nullable(),
  /** the output intent: the colour profile the engine was set up with */
  iccSha256: Sha256.nullable(),
  /** an ad's artwork fails its check below this (ads.ts ARTWORK_MIN_PPI) */
  adMinPpi: z.number().int(),
  /** the media library shows the widest a photo prints sharp at this resolution: advice, not a release check */
  photoSharpPpi: z.number().int(),
  /** how the files reach the press: "Download and send yourself" (the only method built; Delivery.method) */
  delivery: z.literal("download"),
});
export type PressFacts = z.infer<typeof PressFacts>;

export const PrintProfiles = z.strictObject({
  /** newest first; the first is the one in use */
  items: z.array(PrintProfile),
  facts: PressFacts,
});
export type PrintProfiles = z.infer<typeof PrintProfiles>;

/** The edit gateway's answer to its signed GET /v1/press-test (500 {"error"} when it cannot be made). */
export const PressTestPage = z.strictObject({
  format: z.literal("pageinator.press-test/1"),
  /** the PDF, base64 */
  pdf: z.base64().min(1),
  /** of the PDF's bytes */
  sha256: Sha256,
  bytes: z.number().int().positive(),
  /** the colour profile the photo and the ad were converted with (the gateway's PAGEINATOR_ICC) */
  icc_sha256: Sha256,
  /** the independent PDF/X-1a check of the page */
  check: z.strictObject({
    passed: z.boolean(),
    fails: z.number().int().min(0),
    warnings: z.number().int().min(0),
  }),
  maker: z.string(),
  /** its size: [347, 540], the pilot's format, the only one it is made in */
  page_mm: z.tuple([z.number().positive(), z.number().positive()]),
});
export type PressTestPage = z.infer<typeof PressTestPage>;
