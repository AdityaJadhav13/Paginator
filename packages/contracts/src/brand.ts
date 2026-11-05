// Brand & masthead (doc 07 §12 row "Brand"; docs/product/10-l2-newsroom-plan.md §1 "As built (screens)"). Only what
// is real in this engine:
//   - The masthead and the folio are the front template page's own furniture: the engine keeps them and rewrites only
//     the folio's date, page, volume, issue and price (tools/desk/engine/deskgen.py folio_plan, deskfolio.py). So the
//     masthead is shown, never edited: page 1 of the publication's newest done layout run (its preview through the
//     run's file link, GET runs/:r/files/page-01.png, pages.view).
//   - The publication's display name (shown in the app), and the edition defaults "Create edition" fills in: volume,
//     price and the next issue number. An edition carries its own volume, issue and price into the frozen layout
//     request, and page 1's folio prints them after "वर्ष", "अंक" and "किंमत" in the template's own digits, when the
//     template page has those words. Making an edition whose issue is a plain number at or past next_issue (Latin or
//     Devanagari digits) moves next_issue to that number + 1, in the same transaction; any other issue leaves it.
// Routes, under /api/v1/orgs/:o/pubs/:p:
//   GET  brand (publication.view: "Create edition" needs the defaults) → Brand.
//   PUT  brand BrandInput (brand.edit, the whole cell) → Brand; audited (brand.set {fields}) when something changed.
import { z } from "zod";

export const EditionDefaults = z.strictObject({
  volume: z.string().max(40),
  price: z.string().max(40),
  /** null: no counting (the person types each issue number). */
  nextIssue: z.number().int().min(1).max(999_999).nullable(),
});
export type EditionDefaults = z.infer<typeof EditionDefaults>;

/** The newest laid-out front page: page 1 of the publication's newest done run, with its preview. */
export const MastheadSource = z.strictObject({
  runId: z.uuid(),
  editionId: z.uuid(),
  editionDate: z.iso.date(),
  finishedAt: z.iso.datetime({ offset: true }),
});
export type MastheadSource = z.infer<typeof MastheadSource>;

export const Brand = z.strictObject({
  name: z.string(),
  defaults: EditionDefaults,
  /** null: no layout run of this publication has made page 1 yet. */
  masthead: MastheadSource.nullable(),
});
export type Brand = z.infer<typeof Brand>;

/** A field left out stays. The name is trimmed and must keep 1 to 200 characters. */
export const BrandInput = z.strictObject({
  name: z.string().max(200).optional(),
  defaults: EditionDefaults.partial().optional(),
});
export type BrandInput = z.infer<typeof BrandInput>;

const ISSUE = /^[0-9०-९]{1,6}$/u;

/** An issue line as a number (Latin or Devanagari digits, as the engine's folio reads them), or null. */
export function issueNumber(issue: string): number | null {
  const text = issue.trim();
  if (!ISSUE.test(text)) return null;
  return Number([...text].map((ch) => (ch >= "०" && ch <= "९" ? String(ch.charCodeAt(0) - 0x0966) : ch)).join(""));
}
