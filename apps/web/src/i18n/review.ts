/**
 * The Marathi review list (docs/product/10-l2-newsroom-plan.md §1, L2.1 "Language review": a native Marathi editor,
 * named by the owner, reviews the Marathi strings).
 *
 * Every Marathi string waits for review until it is recorded in REVIEWED with the exact text that was approved, who
 * approved it and when. A reviewed string whose text changes afterwards is back on the list by itself, because the
 * recorded text no longer matches. The glossary seeds come from 02 §3.9, whose own heading says a native editor
 * approves them, so they wait too; `source` tells the reviewer which strings were drafted for this catalogue.
 */
import { CATALOGUE_KEYS, CATALOGUES, type CatalogueKey } from "./catalogue.ts";
import { CONTENT_RECORDS } from "../features/public/content.ts";

/** A public website record on the list: `public:<record id>` (src/features/public/content.ts). */
export type PublicReviewKey = `public:${string}`;
export type ReviewKey = CatalogueKey | PublicReviewKey;

export interface MarathiReview {
  /** The Marathi text exactly as it was approved. */
  readonly text: string;
  /** Who approved it. */
  readonly by: string;
  /** When, as YYYY-MM-DD. */
  readonly on: string;
}

/** Approved Marathi strings. None has been reviewed yet. */
export const REVIEWED: Readonly<Partial<Record<ReviewKey, MarathiReview>>> = {};

/**
 * Questions for the reviewer on particular strings: a term the draft could not settle. Each stays with its string
 * while the string waits for review.
 */
export const REVIEW_NOTES: Readonly<Partial<Record<CatalogueKey, string>>> = {
  "team.invite":
    "Reads the same as team.invite.submit (निमंत्रण पाठवा, one verb for inviting, as the owner asked): one opens the invitation dialog, the other sends it from inside it. Check both read well where they stand.",
  "team.invite.submit":
    "Reads the same as team.invite (निमंत्रण पाठवा): the button inside the invitation dialog that sends it.",
  "grant.release_approve":
    "Open question for the owner's reviewer: the Marathi term for \"release\" (an edition sent to press and kept in the archive). The draft avoids प्रकाशन, which is Publication.",
  "nav.audit":
    "The term for \"audit log\" (the record of who did what, when): the draft says कामकाजाची नोंद; the same words are used on the audit screen's headings and messages (auditLog.*).",
  "nav.release":
    "Open question for the owner's reviewer: the Marathi term for \"release\". The draft says प्रकाशित आवृत्ती; keep it consistent with grant.release_approve and invalid.release.",
  "invalid.release":
    "Open question for the owner's reviewer: the Marathi term for \"release\". The draft says प्रकाशित आवृत्ती; keep it consistent with grant.release_approve and nav.release.",
};

export interface ReviewItem {
  readonly key: ReviewKey;
  readonly english: string;
  readonly marathi: string;
  /**
   * "glossary": a seed from 02 §3.9; "draft": written for this catalogue; "public": a public website record, drafted
   * for the website (a "specimen" record is the fictional Marathi example, the same text on both pages).
   */
  readonly source: "glossary" | "draft" | "public";
  /** A question for the reviewer about this string, when there is one. */
  readonly note?: string;
}

/** The Marathi strings still waiting for a native editor: the catalogue's, in its order, then the public website's. */
export const REVIEW: readonly ReviewItem[] = [
  ...CATALOGUE_KEYS.filter((key) => REVIEWED[key]?.text !== CATALOGUES.mr[key]).map(
    (key): ReviewItem => ({
      key,
      english: CATALOGUES.en[key],
      marathi: CATALOGUES.mr[key],
      source: key.startsWith("glossary.") ? "glossary" : "draft",
      ...(REVIEW_NOTES[key] ? { note: REVIEW_NOTES[key] } : {}),
    }),
  ),
  ...CONTENT_RECORDS.filter((record) => REVIEWED[`public:${record.id}`]?.text !== record.mr).map(
    (record): ReviewItem => ({
      key: `public:${record.id}`,
      english: record.en,
      marathi: record.mr,
      source: "public",
      ...(record.kind === "specimen"
        ? { note: "A fictional Marathi example of a news story, shown in Marathi on the English page too. Check that it reads as natural Marathi news copy." }
        : {}),
    }),
  ),
];
