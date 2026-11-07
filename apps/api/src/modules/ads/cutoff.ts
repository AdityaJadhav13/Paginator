// The ads cut-off (packages/contracts/src/ads.ts, "The cut-off"; docs/product/10-l2-newsroom-plan.md §1 L2.6):
//   - GET ads/settings (ads.view) → AdSettings; PUT ads/settings AdSettingsInput (ads.manage or settings.edit; the
//     route declares publication.view and checks either here) → AdSettings, audited ad_settings.set {from, to}.
//   - The missing-artwork alert, every minute in the process that runs the schedules: each organisation is visited
//     under its own walls as the system (as the news schedule does). For each publication's edition date whose cut-off
//     has passed and whose day has not ended, with no alert yet, the booked bookings of that date with no artwork, a
//     picture that cannot be used (deleted, rejected, failed) or one that fails checkArtwork are named; the alert row
//     is inserted ON CONFLICT DO NOTHING, and only the pass that inserted it tells: one notification
//     (ad_artwork_missing) and one email each to the active people with Advertising, Chief Editor or Editor on the
//     publication, and the organisation's Owners and Admins; audited ad_cutoff.alert {date, bookings, told} (told 0:
//     nobody to tell, recorded all the same). A date with every ad good is not recorded: it is looked at again each pass
//     until its day ends, so a booking made after the cut-off without artwork is told once. Emails go after commit.
import { AdSettings, AdSettingsInput, type Permission, checkArtwork, reach } from "@pageinator/contracts";
import type { FastifyBaseLogger } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  type DateBooking,
  activeMembers,
  adSettings,
  bookingsOn,
  claimAlert,
  dueDates,
  setAdSettings,
} from "../../db/ad-cutoff.ts";
import { recordAudit } from "../../db/audit.ts";
import { organisationIds, publicationIds } from "../../db/engine-events.ts";
import type { IdentityStore } from "../../db/identity.ts";
import { activePeople, addNotifications, withRoles } from "../../db/notifications.ts";
import type { Database } from "../../db/pools.ts";
import type { Tenant, Tx } from "../../db/tenant.ts";
import { type Access, accessOf, actorOf, auditRefusals, orgRoleOf, refused } from "../access/access.ts";
import { type ArtworkProblem, adArtworkMissingEmail } from "../notifications/emails.ts";
import type { Mail, Mailer } from "../notifications/mailer.ts";
import { sendAll } from "../notifications/notify.ts";

const Pub = z.strictObject({ o: z.string(), p: z.string() });

const may = (access: Access, pub: string, permission: Permission) =>
  reach(permission, access.orgRole, access.publications.get(pub) ?? { roles: [], grants: [] }) !== null;

export const adSettingsRoutes: FastifyPluginAsyncZod<{ database: Database }> = async (app, { database }) => {
  auditRefusals(app, database);

  app.get(
    "/api/v1/orgs/:o/pubs/:p/ads/settings",
    { config: { permission: "ads.view" }, schema: { params: Pub, response: { 200: AdSettings } } },
    async (request) => database.withTenant(accessOf(request).tenant, (tx) => adSettings(tx, request.params.p)),
  );

  app.put(
    "/api/v1/orgs/:o/pubs/:p/ads/settings",
    {
      config: { permission: "publication.view" },
      schema: { params: Pub, body: AdSettingsInput, response: { 200: AdSettings } },
    },
    async (request) => {
      const access = accessOf(request);
      const pub = request.params.p;
      if (!may(access, pub, "ads.manage") && !may(access, pub, "settings.edit"))
        throw refused("the cut-off is set by ads.manage or settings.edit");
      return database.withTenant(access.tenant, async (tx) => {
        const from = await adSettings(tx, pub);
        await setAdSettings(tx, access.tenant.orgId, pub, actorOf(request).userId, request.body);
        await recordAudit(tx, access.tenant, {
          action: "ad_settings.set",
          targetType: "publication",
          targetId: pub,
          publicationId: pub,
          data: { from, to: request.body },
        });
        return adSettings(tx, pub);
      });
    },
  );
};

// ------------------------------------------------------------------------------------------------ the alert

export const CUTOFF_EVERY_MS = 60_000;
const NOBODY = "00000000-0000-0000-0000-000000000000";
const TOLD_ROLES = ["advertising", "chief_editor", "editor"];

export type CutoffDeps = { identity: IdentityStore; mailer: Mailer; origin: string };

/** Why the booking's artwork will not print, or null when it is good. */
export function problemOf(booking: DateBooking): ArtworkProblem | null {
  if (!booking.picture) return "none";
  if (booking.picture.status === "rejected" || booking.picture.status === "failed") return "unusable";
  return checkArtwork(booking.picture, booking).passed ? null : "checks";
}

/** The active people told on the publication: its Advertising, Chief Editors and Editors, and the Owners and Admins. */
async function toldOn(tx: Tx, identity: IdentityStore, orgId: string, publicationId: string) {
  const desk = new Set(await withRoles(tx, publicationId, TOLD_ROLES));
  const members = await activeMembers(tx);
  const roles = await identity.memberRoles(orgId, members);
  const ids = members.filter((id) => {
    const stored = roles.get(id);
    const orgRole = stored ? orgRoleOf(stored) : null;
    return orgRole !== null && (orgRole === "owner" || orgRole === "admin" || desk.has(id));
  });
  return activePeople(tx, ids);
}

/** One pass at `now`: returns how many alerts it fired (dates recorded). */
export async function alertDue(
  database: Database,
  log: FastifyBaseLogger,
  deps: CutoffDeps,
  now: Date = new Date(),
): Promise<number> {
  let fired = 0;
  for (const orgId of await organisationIds(database.auth)) {
    const tenant = (pubIds: string[]): Tenant => ({ orgId, userId: NOBODY, pubIds, requestId: "ad-cutoff" });
    const pubs = await database.withTenant(tenant([]), publicationIds);
    if (pubs.length === 0) continue;
    const outbox: Mail[] = [];
    const system = tenant(pubs);
    await database.withTenant(system, async (tx) => {
      for (const due of await dueDates(tx, now)) {
        const pub = due.publicationId;
        const missing = (await bookingsOn(tx, pub, due.date)).flatMap((booking) => {
          const problem = problemOf(booking);
          return problem ? [{ ...booking, problem }] : [];
        });
        // nothing missing: nothing recorded, so a booking made later without artwork is still told
        if (missing.length === 0) continue;
        const told = await toldOn(tx, deps.identity, orgId, pub);
        const ids = missing.map((booking) => booking.id);
        if (!(await claimAlert(tx, orgId, pub, due.date, ids, told.length))) continue;
        fired += 1;
        await recordAudit(tx, system, {
          action: "ad_cutoff.alert",
          actorKind: "system",
          targetType: "publication",
          targetId: pub,
          publicationId: pub,
          data: { date: due.date, bookings: ids, told: told.length },
        });
        await addNotifications(
          tx,
          orgId,
          told.map((person) => ({
            userId: person.userId,
            kind: "ad_artwork_missing",
            targetType: "publication",
            targetId: pub,
            data: { publicationId: pub, date: due.date, missing: missing.length },
            emailed: person.email !== null,
          })),
        );
        const languages = await deps.identity.languages(told.map((person) => person.userId));
        for (const person of told) {
          if (!person.email) continue;
          const email = adArtworkMissingEmail({
            language: languages.get(person.userId) ?? "en",
            name: person.name,
            publication: due.name,
            date: due.date,
            ads: missing,
            origin: deps.origin,
            orgId,
            publicationId: pub,
          });
          outbox.push({ ...email, to: person.email });
        }
      }
    });
    sendAll(deps.mailer, outbox, (kind) => log.warn({ kind }, "an email was not sent: its address is refused"));
  }
  return fired;
}

export type AdCutoffSchedule = { close(): Promise<void> };

/** Runs alertDue now, then every everyMs; close() stops it and waits for a pass in progress. */
export function startAdCutoffSchedule(
  database: Database,
  log: FastifyBaseLogger,
  deps: CutoffDeps,
  everyMs: number = CUTOFF_EVERY_MS,
): AdCutoffSchedule {
  let closed = false;
  let running: Promise<unknown> = Promise.resolve();
  const pass = () => {
    if (closed) return;
    running = alertDue(database, log, deps).catch((error: unknown) =>
      log.warn({ err: error }, "the ad cut-off alert failed; it runs again in a minute"),
    );
  };
  const timer = setInterval(pass, everyMs);
  timer.unref();
  pass();
  return {
    async close() {
      closed = true;
      clearInterval(timer);
      await running;
    },
  };
}
