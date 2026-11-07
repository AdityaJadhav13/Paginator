// The stories API's checks of what a request names (docs/product/10-l2-newsroom-plan.md §5.2), and its text cleaning,
// on top of the database's story functions (src/db/stories.ts). Each refusal is a 400 with the field it is about.
import { BODY_LIMIT, DeskTextError, LINE_LIMIT, cleanText } from "@pageinator/desk-text";
import { type TextKey, editionOf, publicationOf, sectionOf } from "../../db/stories.ts";
import type { Tx } from "../../db/tenant.ts";
import { ApiError } from "../../http/errors.ts";

const LABELS: Record<
  TextKey | "deskNote" | "comment" | "caption" | "credit" | "photographer",
  { label: string; limit: number }
> = {
  headline: { label: "headline", limit: LINE_LIMIT },
  kicker: { label: "kicker", limit: LINE_LIMIT },
  deck: { label: "deck", limit: LINE_LIMIT },
  byline: { label: "byline", limit: LINE_LIMIT },
  body: { label: "article text", limit: BODY_LIMIT },
  deskNote: { label: "desk note", limit: LINE_LIMIT },
  comment: { label: "comment", limit: 10_000 },
  caption: { label: "caption", limit: LINE_LIMIT },
  credit: { label: "credit", limit: LINE_LIMIT },
  photographer: { label: "photographer", limit: LINE_LIMIT },
};

/** Text as the Desk stores it (desk-text cleanText), or 400 with the Desk's own words. */
export function cleaned(value: string | undefined, key: keyof typeof LABELS): string {
  try {
    return cleanText(value ?? "", LABELS[key].label, LABELS[key].limit);
  } catch (error) {
    if (!(error instanceof DeskTextError)) throw error;
    throw new ApiError("invalid_request", [{ field: `body.${key}`, message: error.message }]);
  }
}

const invalid = (field: string, message: string) =>
  new ApiError("invalid_request", [{ field: `body.${field}`, message }]);

/** A language of the publication; returns it, or the publication's own when none is named. */
export async function languageFor(tx: Tx, publicationId: string, language: string | undefined): Promise<string> {
  const publication = await publicationOf(tx, publicationId);
  const chosen = language ?? publication.primary_language;
  if (!publication.languages.includes(chosen)) throw invalid("language", "is not a language of this publication");
  return chosen;
}

/** A section and an edition of this publication, and a page pin within the edition (400 otherwise). */
export async function checkPlacement(
  tx: Tx,
  publicationId: string,
  placement: { sectionId?: string | null | undefined; editionId: string | null; pagePin: number | null },
): Promise<void> {
  if (placement.sectionId) {
    const section = await sectionOf(tx, publicationId, placement.sectionId);
    if (!section || section.archived_at) throw invalid("sectionId", "is not a section of this publication");
  }
  if (placement.editionId) {
    const edition = await editionOf(tx, publicationId, placement.editionId);
    if (!edition) throw invalid("editionId", "is not an edition of this publication");
    if (placement.pagePin !== null && placement.pagePin > edition.pages) {
      throw invalid("pagePin", `is past the edition's last page (${edition.pages})`);
    }
  }
}
