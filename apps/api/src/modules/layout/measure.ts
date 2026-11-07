// Background measuring (docs/product/10-l2-newsroom-plan.md §1 L2.3, §2.2): every few seconds, each organisation's
// editions whose stories changed at least 8 s ago and after their last measuring snapshot, with a profile ready, a
// Ready story and no active run, get a new snapshot: the frozen request's shape (request.ts) written to
// editions/<id>/measure.json, and engine.measure enqueued (job key measure:<edition>, replacing one still waiting), in
// one transaction under the organisation's walls. A snapshot of the same bytes as the last enqueues nothing. Runs in
// the process that runs the engine inbox; each organisation is read under its own walls (no system reader).
import { createHash } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import { organisationIds, publicationIds } from "../../db/engine-events.ts";
import {
  editionArtwork,
  editionsToMeasure,
  enqueueEngineMeasure,
  layoutEdition,
  layoutStories,
  measureOf,
  profileInUse,
  saveMeasureSnapshot,
  touchMeasureSnapshot,
} from "../../db/layout.ts";
import type { Database } from "../../db/pools.ts";
import type { Tenant } from "../../db/tenant.ts";
import type { ObjectStore } from "../../storage/object-store.ts";
import { frozenRequest, planFor } from "./request.ts";

const NOBODY = "00000000-0000-0000-0000-000000000000";
export const MEASURE_EVERY_MS = 5_000;
/** How long an edition stays unchanged before it is measured (the Desk's 8 s). */
export const QUIET_MS = 8_000;
const BATCH = 20;

/** One pass; returns how many measures it enqueued. */
export async function measurePass(database: Database, store: ObjectStore, quietMs = QUIET_MS): Promise<number> {
  let enqueued = 0;
  for (const orgId of await organisationIds(database.auth)) {
    const base: Tenant = { orgId, userId: NOBODY, pubIds: [], requestId: "layout-measure" };
    const pubs = await database.withTenant(base, publicationIds);
    if (pubs.length === 0) continue;
    const tenant = { ...base, pubIds: pubs };
    const due = await database.withTenant(tenant, (tx) => editionsToMeasure(tx, quietMs, BATCH));
    for (const { id, publication_id: pub } of due) {
      const made = await database.withTenant(tenant, async (tx) => {
        const edition = await layoutEdition(tx, pub, id, true);
        const profile = await profileInUse(tx, pub);
        if (!edition || !profile?.dataset_version_id || !profile.config_version_id || !profile.config_sha256)
          return false;
        const doc = frozenRequest(
          edition,
          await layoutStories(tx, pub, id),
          planFor(profile.plans, edition),
          await editionArtwork(tx, pub, id),
        );
        const body = Buffer.from(JSON.stringify(doc), "utf8");
        const sha256 = createHash("sha256").update(body).digest("hex");
        const last = await measureOf(tx, pub, id, true);
        if (doc.articles.length === 0 || (last?.sha256 === sha256 && last.state !== "failed")) {
          await touchMeasureSnapshot(tx, pub, id); // the same bytes: nothing new to measure
          return false;
        }
        const key = `orgs/${orgId}/pubs/${pub}/editions/${id}/measure.json`;
        const { versionId } = await store.put({ key, body, contentType: "application/json", metadata: { sha256 } });
        await saveMeasureSnapshot(tx, tenant, pub, id, { sha256, versionId, total: doc.articles.length });
        await enqueueEngineMeasure(tx, {
          org_id: orgId,
          pub_id: pub,
          edition_id: id,
          edition_key: edition.desk_key,
          version_id: versionId,
          sha256,
          profile_id: profile.id,
          dataset_version_id: profile.dataset_version_id,
          dataset_sha256: profile.dataset_sha256,
          config_version_id: profile.config_version_id,
          config_sha256: profile.config_sha256,
        });
        return true;
      });
      if (made) enqueued += 1;
    }
  }
  return enqueued;
}

export type MeasureSchedule = { close(): Promise<void> };

/** Starts the scheduler (now, then every everyMs); close() stops it and waits for a pass in progress. */
export function startMeasureSchedule(
  database: Database,
  store: ObjectStore,
  log: FastifyBaseLogger,
  everyMs = MEASURE_EVERY_MS,
): MeasureSchedule {
  let running: Promise<void> = Promise.resolve();
  let busy = false;
  let closed = false;
  let failing = false;
  const tick = () => {
    if (busy || closed) return;
    busy = true;
    running = measurePass(database, store)
      .then(() => {
        failing = false;
      })
      .catch((error: unknown) => {
        if (!failing) log.warn({ err: error }, "the measure scheduler failed; it tries again every few seconds");
        failing = true;
      })
      .finally(() => {
        busy = false;
      });
  };
  const timer = setInterval(tick, everyMs);
  timer.unref();
  tick();
  return {
    async close() {
      closed = true;
      clearInterval(timer);
      await running;
    },
  };
}
