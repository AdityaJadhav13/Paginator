// The news finder's schedule (docs/product/13-news-finder.md), in the API beside the engine inbox: every 10 minutes,
// each publication with a source on whose last collection is older than its interval (collect_every_h, 3 hours by
// default), or that never ran, is collected (news.collect: src/db/news.ts enqueueCollect). It visits each organisation
// under its own walls, as the engine sweep does (the system's tenant: no person). The run is marked asked for in the
// same statement that decides it is due, so two API instances ask for one collection, never two.
import type { FastifyBaseLogger } from "fastify";
import { organisationIds, publicationIds } from "../../db/engine-events.ts";
import { duePublications, enqueueCollect } from "../../db/news.ts";
import type { Database } from "../../db/pools.ts";
import type { Tenant } from "../../db/tenant.ts";

export const SCHEDULE_MS = 10 * 60_000;
const NOBODY = "00000000-0000-0000-0000-000000000000";

/** One pass: returns how many collections it asked for. */
export async function collectDue(database: Database, capInr: number): Promise<number> {
  let asked = 0;
  for (const orgId of await organisationIds(database.auth)) {
    const tenant = (pubIds: string[]): Tenant => ({ orgId, userId: NOBODY, pubIds, requestId: "news-schedule" });
    const pubs = await database.withTenant(tenant([]), publicationIds);
    if (pubs.length === 0) continue;
    await database.withTenant(tenant(pubs), async (tx) => {
      for (const pub of await duePublications(tx)) {
        if (await enqueueCollect(tx, orgId, pub, capInr, false)) asked += 1;
      }
    });
  }
  return asked;
}

export type NewsSchedule = { close(): Promise<void> };

/** Runs collectDue now, then every everyMs; close() stops it and waits for a pass in progress. */
export function startNewsSchedule(
  database: Database,
  log: FastifyBaseLogger,
  capInr: number,
  everyMs: number = SCHEDULE_MS,
): NewsSchedule {
  let closed = false;
  let running: Promise<unknown> = Promise.resolve();
  const pass = () => {
    if (closed) return;
    running = collectDue(database, capInr).catch((error: unknown) =>
      log.warn({ err: error }, "the news schedule failed; it runs again in 10 minutes"),
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
