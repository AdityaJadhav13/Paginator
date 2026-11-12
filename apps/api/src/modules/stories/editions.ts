// Editions (docs/product/10-l2-newsroom-plan.md §1 L2.1 "minimal editions", §5.2), under /api/v1/orgs/:o/pubs/:p/editions:
//   - GET lists the publication's editions, newest first, with their stories counted (edition.view); counts are null
//     for a role that sees no stories (storyScope "none", such as Advertising);
//   - POST makes one (edition.create, the whole cell only: Advertising's and Prepress's ◐ are their ad positions and
//     colour map, 07 §12, not a new edition), with an Idempotency-Key; a date that has one already answers 409
//     edition_exists with that edition as `current`. Audited (edition.create) in the change's transaction; the database
//     tells other tabs (live event `edition`, migration 2026_11_28_0001). The bookings of its date are placed in it by
//     their rules in the same transaction (src/modules/ads/place.ts), and an issue number at or past the publication's
//     next_issue moves it on (src/db/brand.ts issueUsed);
//   - PATCH /:e changes its folio, volume, issue and price, and corrects its date, pages and back-page ads
//     (edition.edit, the whole cell only), in one transaction with the edition locked. Unchanged fields change nothing.
//     A folio change moves the edition's folio_changed_at (the release's folio check: page 1 prints it only once saved
//     again after Update text, or laid out again). A correction of the date, pages or back-page ads is refused once
//     the edition is released or archived (409 edition_released), while a layout run is active (409 run_active, that
//     run as `current`), and for a date another edition has (409 edition_exists, that edition as `current`; the same
//     answer when that edition is made at the same moment). Otherwise the edition's Desk key follows the date (its
//     "-n" kept), every done run is set aside (cancelled, EDITION_CHANGED: the board, the editor and the release use
//     the newest done run, so nothing made for the old date or pages is used), the ads follow (a placement whose
//     booking is not booked for the new date, or whose slot the new plan lacks or it no longer fits, is taken out;
//     slot artwork the new plan has no such slot for is cleared; the new date's bookings placed) and the plan's pages
//     past the new count are emptied. Stories pinned past the new page count are left as they are: the layout's
//     readiness refuses them in its own words (src/modules/layout/request.ts). The fields changed are audited
//     (edition.edit), a correction with `was` (their old values), `setAside` (how many runs) and what it emptied
//     (`planCleared`: each plan page's section and note as they were; `artworkCleared`: slots whose artwork was set by
//     hand). Lock order (place.ts): a correction locks the bookings of its date before the edition, since placing one
//     key-share locks it; a deadlock or a date moved meanwhile runs the change once more.
// A story is put in an edition, or taken out, by the story's own PATCH (editionId; the desk's, story.edition_change).
import { Edition, EditionInput, EditionList, EditionPatch, EditionQuery, issueNumber } from "@pageinator/contracts";
import { DeskTextError, cleanText } from "@pageinator/desk-text";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { bookingsOfDate, editionPlacements, editionStatus } from "../../db/ads.ts";
import { recordAudit } from "../../db/audit.ts";
import { issueUsed } from "../../db/brand.ts";
import {
  type EditionRow,
  correctEdition,
  createEdition,
  listEditions,
  lockBookingsOfDate,
  setFolio,
} from "../../db/editions.ts";
import { clearArtwork, editionArtwork, editionRuns, layoutEdition } from "../../db/layout.ts";
import type { Database } from "../../db/pools.ts";
import type { Tenant, Tx } from "../../db/tenant.ts";
import { ApiError } from "../../http/errors.ts";
import { accessOf, auditRefusals, refused } from "../access/access.ts";
import { editionSlots, fits, isReleased, placeBooked, rule, sameSize, takeOut } from "../ads/place.ts";
import { runView } from "../layout/routes.ts";
import { EDITION_CHANGED } from "../layout/views.ts";
import { idempotent } from "../requests/idempotency.ts";
import { storyScope } from "./rules.ts";

const Pub = z.strictObject({ o: z.string(), p: z.string() });
const OneEdition = z.strictObject({ o: z.string(), p: z.string(), e: z.string() });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE = "/api/v1/orgs/:o/pubs/:p/editions";
/** More than a year of daily editions. */
const LIST_LIMIT = 400;

function view(row: EditionRow): Edition {
  return {
    id: row.id,
    date: row.date,
    pages: row.pages,
    backPageAds: row.back_page_ads,
    volume: row.volume,
    issue: row.issue,
    price: row.price,
    status: row.status,
    counts:
      row.stories === null || row.ready === null || row.spiked === null
        ? null
        : { stories: row.stories, ready: row.ready, spiked: row.spiked },
  };
}

async function one(tx: Tx, pub: string, id: string): Promise<Edition | null> {
  const [row] = await listEditions(tx, pub, { id }, 1);
  return row ? view(row) : null;
}

/** The edition's ads made to follow its corrected date and plan (the caller holds the edition's lock, taken after the
 * bookings of its new date: lockBookingsOfDate, place.ts's order). Returns the slots whose artwork set by hand was
 * cleared (a booking's is audited by takeOut). */
async function followCorrection(tx: Tx, who: Tenant, pub: string, editionId: string): Promise<string[]> {
  const found = await editionSlots(tx, pub, editionId);
  if (!found) throw new Error("the edition just corrected is not found");
  const booked = new Map((await bookingsOfDate(tx, pub, found.edition.date)).map((b) => [b.id, b]));
  for (const placed of await editionPlacements(tx, pub, editionId)) {
    const booking = booked.get(placed.booking_id);
    const slot = found.slots.find((s) => s.slot === placed.slot);
    if (!booking || !slot || !fits(rule(booking), slot)) await takeOut(tx, who, pub, editionId, placed.slot);
  }
  const cleared: string[] = [];
  for (const art of await editionArtwork(tx, pub, editionId)) {
    const slot = found.slots.find((s) => s.slot === art.slot);
    if (!slot || !sameSize(slot, { wMm: Number(art.w_mm), hMm: Number(art.h_mm) })) {
      await clearArtwork(tx, pub, editionId, art.slot);
      cleared.push(art.slot);
    }
  }
  await placeBooked(tx, who, pub, editionId);
  return cleared;
}

/** A short line as the Desk keeps it (NFC, no control characters, trimmed), or 400. */
function line(value: string | undefined, field: string): string {
  try {
    return cleanText(value ?? "", field, 200);
  } catch (error) {
    if (!(error instanceof DeskTextError)) throw error;
    throw new ApiError("invalid_request", [{ field: `body.${field}`, message: error.message }]);
  }
}

export const editionRoutes: FastifyPluginAsyncZod<{ database: Database }> = async (app, { database }) => {
  auditRefusals(app, database);

  app.get(
    BASE,
    {
      config: { permission: "edition.view" },
      schema: { params: Pub, querystring: EditionQuery, response: { 200: EditionList } },
    },
    async (request) => {
      const access = accessOf(request);
      const { from, to } = request.query;
      // a role that sees none of the stories (Advertising) is not told how many there are
      const counted = storyScope(access, request.params.p) !== "none";
      const rows = await database.withTenant(access.tenant, (tx) =>
        listEditions(tx, request.params.p, { from, to }, LIST_LIMIT, counted),
      );
      return { items: rows.map(view) };
    },
  );

  app.post(
    BASE,
    {
      config: { permission: "edition.create" },
      schema: { params: Pub, body: EditionInput, response: { 201: Edition } },
    },
    async (request, reply) => {
      const access = accessOf(request);
      if (access.reach !== "full") throw refused("their role sets ad positions or the colour map, not new editions");
      const pub = request.params.p;
      const input = request.body;
      const answer = await idempotent(
        database,
        request,
        access.tenant,
        async (tx) => {
          const edition = {
            date: input.date,
            pages: input.pages,
            backPageAds: input.backPageAds ?? true,
            volume: line(input.volume, "volume"),
            issue: line(input.issue, "issue"),
            price: line(input.price, "price"),
          };
          const id = await createEdition(tx, access.tenant, pub, edition);
          if (id === null) {
            const [existing] = await listEditions(tx, pub, { from: input.date, to: input.date }, 1);
            throw new ApiError("edition_exists", undefined, existing ? view(existing) : undefined);
          }
          await recordAudit(tx, access.tenant, {
            action: "edition.create",
            targetType: "edition",
            targetId: id,
            publicationId: pub,
            data: { date: edition.date, pages: edition.pages },
          });
          // the publication's next issue number moves past this one (packages/contracts/src/brand.ts)
          const issue = issueNumber(edition.issue);
          if (issue !== null) await issueUsed(tx, pub, issue);
          // the ads booked for its date go into their slots at once (src/modules/ads/place.ts)
          await placeBooked(tx, access.tenant, pub, id);
          return { status: 201, body: await one(tx, pub, id), stored: { id } };
        },
        // a replay shows the edition as it is now
        async (stored, tx) => one(tx, pub, (stored as { id: string }).id),
      );
      return reply.status(201).send(answer.body as Edition);
    },
  );

  app.patch(
    `${BASE}/:e`,
    {
      config: { permission: "edition.edit" },
      schema: { params: OneEdition, body: EditionPatch, response: { 200: Edition } },
    },
    async (request) => {
      const access = accessOf(request);
      if (access.reach !== "full") throw refused("their role sets ad positions or the colour map, not the folio");
      const { p: pub, e } = request.params;
      const input = request.body;
      const change = () =>
        database.withTenant(access.tenant, async (tx) => {
          // a correction may place the bookings of its date: they are locked before the edition (place.ts's order)
          const correcting = input.date !== undefined || input.pages !== undefined || input.backPageAds !== undefined;
          const before = correcting && UUID.test(e) ? await layoutEdition(tx, pub, e) : undefined;
          const bookingsOf = input.date ?? before?.date;
          if (bookingsOf !== undefined) await lockBookingsOfDate(tx, pub, bookingsOf);
          const edition = UUID.test(e) ? await layoutEdition(tx, pub, e, true) : undefined;
          if (!edition) throw new ApiError("not_found");
          const folio = {
            volume: input.volume === undefined ? edition.volume : line(input.volume, "volume"),
            issue: input.issue === undefined ? edition.issue : line(input.issue, "issue"),
            price: input.price === undefined ? edition.price : line(input.price, "price"),
          };
          const changed = (["volume", "issue", "price"] as const).filter((k) => folio[k] !== edition[k]);
          const was = { date: edition.date, pages: edition.pages, backPageAds: edition.back_page_ads };
          const plan = {
            date: input.date ?? was.date,
            pages: input.pages ?? was.pages,
            backPageAds: input.backPageAds ?? was.backPageAds,
          };
          const corrected = (["date", "pages", "backPageAds"] as const).filter((k) => plan[k] !== was[k]);
          let setAside = 0;
          let planCleared: { page: number; section_id: string | null; note: string }[] = [];
          let artworkCleared: string[] = [];
          // another correction moved the date between the read and the lock: its bookings were not the ones locked
          if (corrected.length > 0 && plan.date !== bookingsOf)
            throw Object.assign(new Error("moved"), { code: "40001" });
          if (corrected.length > 0) {
            if (isReleased(await editionStatus(tx, pub, e))) throw new ApiError("edition_released");
            const { active } = await editionRuns(tx, pub, e);
            if (active) throw new ApiError("run_active", undefined, await runView(tx, pub, active));
            if (plan.date !== was.date) {
              const [other] = await listEditions(tx, pub, { from: plan.date, to: plan.date }, 1);
              if (other) throw new ApiError("edition_exists", undefined, view(other));
            }
          }
          if (changed.length > 0) await setFolio(tx, pub, e, folio);
          if (corrected.length > 0) {
            // the Desk key keeps what followed the date ("-2": the Desk's second edition of a day)
            const deskKey = plan.date + edition.desk_key.slice(10);
            ({ setAside, planCleared } = await correctEdition(
              tx,
              access.tenant,
              pub,
              e,
              { ...plan, deskKey },
              EDITION_CHANGED,
            ));
            artworkCleared = await followCorrection(tx, access.tenant, pub, e);
          }
          if (changed.length + corrected.length > 0) {
            await recordAudit(tx, access.tenant, {
              action: "edition.edit",
              targetType: "edition",
              targetId: e,
              publicationId: pub,
              data: {
                ...Object.fromEntries(changed.map((k) => [k, folio[k]])),
                ...Object.fromEntries(corrected.map((k) => [k, plan[k]])),
                ...(corrected.length > 0
                  ? {
                      was: Object.fromEntries(corrected.map((k) => [k, was[k]])),
                      setAside,
                      // what the correction emptied, as it was (a plan page's section and note; artwork set by hand)
                      ...(planCleared.length > 0
                        ? {
                            planCleared: planCleared.map((c) => ({
                              page: c.page,
                              section: c.section_id,
                              note: c.note,
                            })),
                          }
                        : {}),
                      ...(artworkCleared.length > 0 ? { artworkCleared } : {}),
                    }
                  : {}),
              },
            });
          }
          const now = await one(tx, pub, e);
          if (!now) throw new Error("the edition just changed is not found");
          return now;
        });
      try {
        return await change();
      } catch (error) {
        // run once more: another edition was given the new date at the same moment (the unique date: it is found
        // then), a deadlock with a booking's change, or the date moved before the lock
        if (!["23505", "40P01", "40001"].includes(String((error as { code?: unknown }).code))) throw error;
        return change();
      }
    },
  );
};
