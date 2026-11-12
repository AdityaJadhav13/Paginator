// An edition as the engine sees it (docs/product/10-l2-newsroom-plan.md §2.2 "The frozen request"): the readiness the
// edition screen shows against the profile in use's plan, and the frozen request a run (request.json) or a measure
// (measure.json) is laid out from, in the Desk's own shape (Store.snapshot: {edition, articles, ads}; tools/desk/
// CONTRACT.md §1), each photo's and ad's CMYK raster named (apps/engine-worker/pgn_worker/home.py reads it). Pure: the
// caller reads the rows (src/db/layout.ts).
//   - The stories laid out are the edition's Ready and Placed ones. A story is a brief when its body has 1 to 60 words
//     and it has no photo (the Desk's decorate()).
//   - Blockers stop a run: a laid-out story whose photo is still being prepared (no CMYK raster yet) or was refused,
//     failed or deleted; a page pin beyond the edition's pages; a subheading that desk-text/1 cannot write (it starts
//     with #, as the story bundle refuses it).
//   - An ad goes in when its slot is in the plan and its artwork is ready: {width_px, height_px, ppi: 200, raster}.
import type { AdSlot, Readiness, RasterRef } from "@pageinator/contracts";
import type { ArtworkRow, LayoutEdition, LayoutStory, Plan } from "../../db/layout.ts";
import { deskText } from "../stories/desk-bundle.ts";

export const LAID_OUT = new Set(["ready", "placed"]);
export const BRIEF_WORDS = 60;
export const AD_PPI = 200;

export type Blocker = Readiness["blockers"][number];

const ref = (story: LayoutStory) => ({ storyId: story.id, deskKey: story.desk_key, headline: story.headline });

/** The plan of the profile in use for the edition's pages and back-page ads, or undefined. */
export function planFor(plans: readonly Plan[] | null, edition: Pick<LayoutEdition, "pages" | "back_page_ads">) {
  return plans?.find((plan) => plan.pages === edition.pages && plan.back_page_ads === edition.back_page_ads);
}

/** Why a laid-out story cannot go into a run as it is, or null. */
export function blockerOf(story: LayoutStory, pages: number): Blocker | null {
  const at = (code: string, message: string): Blocker => ({ ...ref(story), code, message });
  if (story.page_pin !== null && story.page_pin > pages)
    return at("page_pin", `It is pinned to page ${story.page_pin}, and this edition has ${pages} pages.`);
  if (deskText(story.body).hashed.length > 0)
    return at("subheading", "A subheading starts with #, which the engine cannot print as a subheading.");
  if (!story.photo_attached) return null;
  if (story.photo_deleted || story.photo_status === "rejected" || story.photo_status === "failed")
    return at("photo_unusable", "Its photo was refused or deleted: take it off the story, or give it another.");
  if (story.photo_status !== "ready" || !story.cmyk || !story.photo_desk_key)
    return at("photo_preparing", "Its photo is still being prepared for print.");
  return null;
}

const isBrief = (story: LayoutStory) => story.words > 0 && story.words <= BRIEF_WORDS && !story.photo_attached;

export function readiness(
  plan: Plan | undefined,
  edition: LayoutEdition,
  stories: readonly LayoutStory[],
  measure: Readiness["measure"],
): Readiness {
  const laid = stories.filter((story) => LAID_OUT.has(story.status));
  const needs = plan?.needs ?? { stories: 0, briefs: 0, photos: 0, words: 0 };
  return {
    needs: { stories: needs.stories, briefs: needs.briefs, photos: needs.photos, words: needs.words },
    have: {
      stories: laid.length,
      briefs: laid.filter(isBrief).length,
      photos: laid.filter((story) => story.photo_attached).length,
      words: laid.reduce((sum, story) => sum + story.words, 0),
    },
    notReady: stories
      .filter((story) => !LAID_OUT.has(story.status))
      .slice(0, 400)
      .map((story) => ({ ...ref(story), status: story.status })),
    blockers: laid.flatMap((story) => blockerOf(story, edition.pages) ?? []).slice(0, 400),
    measure,
  };
}

/** The plan's ad slots (each on its page), with the edition's artwork for each. */
export function slotsOf(plan: Plan | undefined, artwork: readonly ArtworkRow[]): AdSlot[] {
  if (!plan) return [];
  return plan.page_plan.flatMap((page) =>
    page.ad_slots.map((slot): AdSlot => {
      const art = artwork.find((row) => row.slot === slot.slot);
      return {
        slot: slot.slot,
        page: page.page,
        wMm: slot.w_mm,
        hMm: slot.h_mm,
        state: art ? art.state : "empty",
        assetId: art?.asset_id ?? null,
        problem: art?.problem ?? null,
      };
    }),
  );
}

const iso = (moment: Date) => moment.toISOString().replace("Z", "+00:00");

/** The Desk's article source for a story's origin (CONTRACT.md §1: typed, pasted, word; a hosted story otherwise). */
const sourceOf = (origin: string) => (["typed", "pasted", "word"].includes(origin) ? origin : "bundle");

export type FrozenRequest = {
  edition: Record<string, unknown>;
  articles: Record<string, unknown>[];
  ads: Record<string, { width_px: number; height_px: number; ppi: number; raster: RasterRef }>;
};

/** The frozen request of the edition's laid-out stories that have no blocker, and its ready ads of the plan. */
export function frozenRequest(
  edition: LayoutEdition,
  stories: readonly LayoutStory[],
  plan: Plan | undefined,
  artwork: readonly ArtworkRow[],
): FrozenRequest {
  const articles = stories
    .filter((story) => LAID_OUT.has(story.status) && blockerOf(story, edition.pages) === null)
    .map((story) => ({
      id: story.desk_key,
      headline: story.headline,
      kicker: story.kicker,
      deck: story.deck,
      byline: story.byline,
      body: deskText(story.body).text,
      priority: story.priority,
      page: story.page_pin,
      photo:
        story.photo_attached && story.cmyk && story.photo_desk_key
          ? {
              id: story.photo_desk_key,
              caption: story.photo_caption ?? "",
              credit: story.photo_credit ?? "",
              width_px: story.cmyk.width_px,
              height_px: story.cmyk.height_px,
              raster: story.cmyk,
            }
          : null,
      source: sourceOf(story.origin),
      created: iso(story.created_at),
      updated: iso(story.updated_at),
    }));
  const inPlan = new Set(slotsOf(plan, artwork).map((slot) => slot.slot));
  const ads: FrozenRequest["ads"] = {};
  for (const art of artwork) {
    if (art.state !== "ready" || !art.raster || !inPlan.has(art.slot)) continue;
    const { key, version_id, sha256, width_px, height_px } = art.raster;
    ads[art.slot] = { width_px, height_px, ppi: AD_PPI, raster: { key, version_id, sha256, width_px, height_px } };
  }
  return {
    edition: {
      schema: "pageinator.desk.edition/1",
      id: edition.desk_key,
      date: edition.date,
      pages: edition.pages,
      back_page_ads: edition.back_page_ads,
      volume: edition.volume,
      issue: edition.issue,
      price: edition.price,
      created: iso(edition.created_at),
      updated: iso(edition.updated_at),
    },
    articles,
    ads,
  };
}
