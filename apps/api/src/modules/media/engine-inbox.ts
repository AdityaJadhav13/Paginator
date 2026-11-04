// The engine's event inbox, the API's side (docs/product/10-l2-newsroom-plan.md §2.2 "The API part", steps 4 and 5).
//   - The consumer: woken by NOTIFY on engine_events (pgn_listen) and every 5 seconds, it finds the waiting events of
//     every organisation (withSystem 'engine-consumer': ids only), and applies each under withTenant of its
//     organisation and the publication it names, so the asset must be theirs to be found. The payload is checked with
//     the contract (EngineEvent); an event the contract refuses, or whose asset the organisation and publication do not
//     have, is refused, audited (engine.event_refuse) and logged as an error for the operator. An event for an asset no
//     longer waiting (settled already, or deleted) is ignored; one for other bytes is ignored and audited
//     (engine.event_ignore: late or forged). Each event is applied once: its row is locked (skip locked: another API
//     instance takes the next) and marked processed in the same transaction. An event that fails to apply (an error:
//     the database, not the event) is never refused for it: it waits in the inbox, tried again with a backoff kept in
//     its row (5 s doubling to 10 minutes; tries and retry_at), and only after MAX_TRIES (about 2.2 hours) is it
//     refused and audited with the reason "error".
//       media.ready → its renditions recorded (each key the asset's own: orgs/<org>/pubs/<pub>/assets/<id>/r/…),
//                     the asset ready;
//       media.rejected → rejected, with the Desk's message code;
//       job.failed → failed, with the engine's code.
//     Each is audited as the system (asset.ready, asset.reject, asset.fail), and the asset's status change tells the
//     stories it is the photo of (migration 2026_11_27_0001's trigger), so an open story editor shows the new state.
//       import.parsed, import.rejected, and a docx.import's job.failed → the import settled (imports.ts
//                     applyImportEvent: its stories made, or its failure); the inbox's asset_id is the import's id.
//       news.collected, news.drafted, news.draft_failed, and a news job's job.failed → the news finder's
//                     (src/modules/news/inbox.ts applyNewsEvent); the inbox's asset_id is the run's or the draft's id.
//       profile.*, measure.status, run.*, ad.*, and a job.failed of engine.setup, engine.measure, engine.layout or
//                     media.ad → hosted layout's (src/modules/layout/inbox.ts applyLayoutEvent); the inbox's asset_id
//                     is the profile's, the edition's, the run's or the ad slot's artwork row's id.
//   - The sweep, at start-up and every 5 minutes, so every asset settles even when the queue cannot: jobs out of
//     attempts that nobody settled (exhaustedJobs: unlocked, or locked longer than STALE_MS) are written to the inbox as
//     job.failed worker.lost (dropped when the job had reported), then removed; and an asset (or a Word import) still
//     waiting after DEADLINE_MS with no job and no waiting event gets the same (a news draft too; and a profile setting
//     up, an ad's artwork preparing, a measure waiting and a queued layout run); a run whose worker stopped reporting
//     for RUN_STALE_MS (10 minutes) too, which the inbox then fails in the Desk's words (m.run.restarted). It reads and removes jobs as the system reader
//     'engine-sweep' (plain pgn_app sees no job), and writes under each job's organisation. Two API instances may
//     sweep at once, and a sweep may stop between a write and a removal: the inbox's unique job id and the
//     conditional delete make a repeat's writes no-ops. It counts and logs only the failures it wrote.
import { EngineEvent, JOB_KINDS, OrgId, Uuid7 } from "@pageinator/contracts";
import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import { recordAudit } from "../../db/audit.ts";
import {
  type Outcome,
  type RenditionRow,
  addRenditions,
  assetForEvent,
  deferEvent,
  jobAssets,
  organisationIds,
  publicationIds,
  removeSpentJob,
  reportLost,
  reportToInbox,
  settleAsset,
  settleEvent,
  spentJobs,
  strandedAssets,
  takeEvent,
  waitingEvents,
} from "../../db/engine-events.ts";
import { listenAppEvents } from "../../db/events.ts";
import { strandedImports } from "../../db/imports.ts";
import type { Database } from "../../db/pools.ts";
import type { SystemTx, Tenant, Tx } from "../../db/tenant.ts";
import type { ObjectStore } from "../../storage/object-store.ts";
import { strandedDrafts } from "../../db/news.ts";
import { applyNewsEvent, isNewsEvent } from "../news/inbox.ts";
import { applyImportEvent } from "./imports.ts";
import { applyLayoutEvent, isLayoutEvent, layoutTarget } from "../layout/inbox.ts";
import { stalledRuns, strandedLayout } from "../../db/layout.ts";

/** The system's tenant has no person: the nil UUID (audit events by the system record no actor). */
const NOBODY = "00000000-0000-0000-0000-000000000000";
export const POLL_MS = 5_000;
export const SWEEP_MS = 5 * 60_000;
/** A spent job still locked this long had a worker die on it: longer than the runner's time limit (180 s by default,
 * at most an hour) and the report's retries. */
export const STALE_MS = 2 * 60 * 60_000;
/** An asset waiting this long with no job and no event left will never settle. */
export const DEADLINE_MS = 30 * 60_000;
const BATCH = 50;
/** How often one event may fail to apply (an error, not a refusal) before it is refused and audited ("error"): with
 * deferEvent's backoff (5 s doubling to 10 minutes), about 2.2 hours of tries. */
export const MAX_TRIES = 20;
const LOST = { code: "worker.lost", message: "the job was lost: its worker stopped, or its report never arrived" };

const tenantFor = (orgId: string, pubIds: string[], requestId: string): Tenant => ({
  orgId,
  userId: NOBODY,
  pubIds,
  requestId,
});

type Waiting = { id: string; org_id: string; pub_id: string | null };
type Taken = NonNullable<Awaited<ReturnType<typeof takeEvent>>>;

/** Refuses an event: logged as an error for the operator, and audited under its organisation. */
async function refuseEvent(tx: Tx, tenant: Tenant, row: Taken, reason: string, log: FastifyBaseLogger) {
  log.error({ event: row.id, job: row.job_id, kind: row.kind, reason }, "an engine event was refused");
  await recordAudit(tx, tenant, {
    action: "engine.event_refuse",
    actorKind: "system",
    targetType: "engine_event",
    targetId: row.id,
    data: { job: row.job_id, kind: row.kind, reason },
  });
}

/** The asset's rendition folder: where every key media.ready names must be, by purpose and profile. */
function renditionsOf(
  originalKey: string,
  event: Extract<EngineEvent, { kind: "media.ready" }>,
): RenditionRow[] | null {
  const folder = `${originalKey.slice(0, -"original".length)}r/`;
  const purposes = new Set(event.renditions.map((r) => r.purpose));
  if (purposes.size !== 3) return null;
  for (const r of event.renditions) {
    const ext = r.purpose === "cmyk" ? "cmyk.gz" : "jpg";
    if (r.key !== `${folder}${r.purpose}-${event.params_hash}.${ext}`) return null;
  }
  return event.renditions.map((r) => ({ ...r, params_hash: event.params_hash }));
}

async function decide(
  database: Database,
  tx: Tx,
  tenant: Tenant,
  row: Taken,
  log: FastifyBaseLogger,
  store: ObjectStore | undefined,
): Promise<Outcome> {
  const refuse = async (reason: string): Promise<Outcome> => {
    await refuseEvent(tx, tenant, row, reason, log);
    return "refused";
  };
  const parsed = EngineEvent.safeParse(row.payload);
  if (!parsed.success || parsed.data.kind !== row.kind) return refuse("contract");
  const event = parsed.data;
  if (isLayoutEvent(event)) {
    if (event.org_id !== tenant.orgId || event.pub_id !== tenant.pubIds[0] || layoutTarget(event) !== row.asset_id)
      return refuse("mismatch");
    const out = await applyLayoutEvent(tx, tenant, event, row.job_id, log);
    return typeof out === "string" ? out : refuse(out.refuse);
  }
  const targetId =
    event.kind === "job.failed"
      ? event.target_id
      : "asset_id" in event
        ? event.asset_id
        : "import_id" in event
          ? event.import_id
          : "run_id" in event
            ? event.run_id
            : event.draft_id;
  if (event.org_id !== tenant.orgId || event.pub_id !== tenant.pubIds[0] || targetId !== row.asset_id)
    return refuse("mismatch");
  if (isNewsEvent(event)) {
    const out = await applyNewsEvent(database, tx, tenant, event, row.job_id);
    return typeof out === "string" ? out : refuse(out.refuse);
  }
  if (event.kind === "import.parsed" || event.kind === "import.rejected" || event.kind === "job.failed") {
    if (event.kind !== "job.failed" || event.job_kind === "docx.import") {
      const out = await applyImportEvent(database, tx, tenant, event, row.job_id, store, log);
      return typeof out === "string" ? out : refuse(out.refuse);
    }
  }
  const assetId = targetId;
  const asset = await assetForEvent(tx, event.pub_id, assetId);
  if (!asset) return refuse("not_found");
  if (asset.deleted) return "ignored"; // its photo was deleted: nothing to prepare
  if (event.kind !== "job.failed" && event.sha256 !== asset.sha256) {
    // not these bytes: late (a job of other bytes) or forged; never applied, and recorded
    log.warn({ event: row.id, job: row.job_id, kind: row.kind }, "an engine event for other bytes was ignored");
    await recordAudit(tx, tenant, {
      action: "engine.event_ignore",
      actorKind: "system",
      targetType: "engine_event",
      targetId: row.id,
      data: { job: row.job_id, kind: row.kind, reason: "other_bytes" },
    });
    return "ignored";
  }
  // settled already (a second report, or the sweep's after a real one): nothing to change
  if (asset.status !== "received") return "ignored";
  const audit = (action: "asset.ready" | "asset.reject" | "asset.fail", data: Record<string, unknown>) =>
    recordAudit(tx, tenant, {
      action,
      actorKind: "system",
      targetType: "asset",
      targetId: asset.id,
      publicationId: event.pub_id,
      data: { job: row.job_id, ...data },
    });
  if (event.kind === "media.ready") {
    const renditions = renditionsOf(asset.original_key, event);
    if (!renditions) return refuse("rendition_key");
    await addRenditions(tx, tenant.orgId, event.pub_id, asset.id, renditions);
    await settleAsset(tx, event.pub_id, asset.id, "ready", null);
    await audit("asset.ready", { paramsHash: event.params_hash });
  } else if (event.kind === "media.rejected") {
    await settleAsset(tx, event.pub_id, asset.id, "rejected", event.code);
    await audit("asset.reject", { code: event.code, status: event.status });
  } else {
    await settleAsset(tx, event.pub_id, asset.id, "failed", event.code);
    await audit("asset.fail", { code: event.code });
  }
  return "applied";
}

/** Applies one waiting event; null when another consumer had it. */
export async function applyEvent(database: Database, waiting: Waiting, log: FastifyBaseLogger, store?: ObjectStore) {
  const tenant = tenantFor(waiting.org_id, waiting.pub_id ? [waiting.pub_id] : [], `engine-event:${waiting.id}`);
  return database.withTenant(tenant, async (tx) => {
    const row = await takeEvent(tx, waiting.id);
    if (!row) return null;
    const outcome = await decide(database, tx, tenant, row, log, store);
    await settleEvent(tx, row.id, outcome);
    return outcome;
  });
}

/** Applies every waiting event that is due (in batches, oldest first). One that fails to apply waits (deferEvent) and
 * is tried again later; after MAX_TRIES it is refused and audited ("error"). A failure to defer (the database is
 * down) ends the pass. */
export async function drainInbox(database: Database, log: FastifyBaseLogger, store?: ObjectStore) {
  for (;;) {
    const waiting = await database.withSystem("engine-consumer", (tx) => waitingEvents(tx, BATCH));
    let done = 0;
    for (const w of waiting) {
      try {
        if ((await applyEvent(database, w, log, store)) !== null) done += 1;
      } catch (error) {
        // its organisation's wall alone: whatever made it fail is not read again
        const tenant = tenantFor(w.org_id, [], `engine-event:${w.id}`);
        const tries = await database.withTenant(tenant, (tx) => deferEvent(tx, w.id));
        log.error({ event: w.id, err: error, tries }, "an engine event could not be applied; it is tried again later");
        done += 1;
        if (tries < MAX_TRIES) continue;
        await database.withTenant(tenant, async (tx) => {
          const row = await takeEvent(tx, w.id);
          if (!row) return;
          await refuseEvent(tx, tenant, row, "error", log);
          await settleEvent(tx, w.id, "refused");
        });
      }
    }
    // a short batch is the last; a full one that another consumer held throughout is left to it
    if (waiting.length < BATCH || done === 0) return;
  }
}

/** What a spent job's payload must name for its asset (or import) to settle (the ids-only payload, or one that drifted
 * from it). */
const SpentTarget = z.object({ org_id: OrgId, pub_id: Uuid7, target_id: Uuid7 });
const JobKind = z.enum(JOB_KINDS);
/** The payload's field that names each job's target (the inbox's asset_id). */
const TARGET_FIELD: Record<(typeof JOB_KINDS)[number], string> = {
  "media.ingest": "asset_id",
  "docx.import": "import_id",
  "news.collect": "run_id",
  "news.draft": "draft_id",
  "engine.setup": "profile_id",
  "engine.measure": "edition_id",
  "engine.layout": "run_id",
  "media.ad": "artwork_id",
};
/** A layout run whose worker has not reported (run.progress, at least every 30 s) for this long is lost: the
 * reconciler fails it in the Desk's words (m.run.restarted). */
export const RUN_STALE_MS = 10 * 60_000;

export type SweepLimits = { staleMs: number; deadlineMs: number; runStaleMs?: number };

/** One pass of the sweep; returns how many failures it wrote to the inbox. */
export async function sweep(
  database: Database,
  log: FastifyBaseLogger,
  limits: SweepLimits = { staleMs: STALE_MS, deadlineMs: DEADLINE_MS },
): Promise<number> {
  const asSweep = <T>(fn: (tx: SystemTx) => Promise<T>) => database.withSystem("engine-sweep", fn);
  let settled = 0;
  for (const job of await asSweep((tx) => spentJobs(tx, limits.staleMs))) {
    const kind = JobKind.safeParse(job.task_identifier).data;
    const payload = (job.payload ?? {}) as Record<string, unknown>;
    const target = SpentTarget.safeParse({
      ...payload,
      target_id: payload[TARGET_FIELD[kind ?? "media.ingest"]],
    }).data;
    if (!kind || !target) {
      log.error({ job: job.id, task: job.task_identifier }, "a spent job names no asset: it is left for an operator");
      continue;
    }
    // written first, then removed: a sweep stopped between the two finds the job again, and its write is a no-op
    const wrote = await database.withTenant(tenantFor(target.org_id, [], `engine-sweep:${job.id}`), (tx) =>
      reportToInbox(tx, {
        orgId: target.org_id,
        jobId: job.id,
        assetId: target.target_id,
        payload: lostEvent(target.org_id, target.pub_id, target.target_id, kind),
      }),
    );
    await asSweep((tx) => removeSpentJob(tx, job.id, limits.staleMs));
    if (!wrote) continue; // it had reported, or another sweep wrote it
    log.warn({ job: job.id }, "a spent job was settled as lost");
    settled += 1;
  }
  const withJobs = await asSweep(jobAssets);
  for (const orgId of await organisationIds(database.auth)) {
    const pubs = await database.withTenant(tenantFor(orgId, [], "engine-sweep"), publicationIds);
    if (pubs.length === 0) continue;
    await database.withTenant(tenantFor(orgId, pubs, "engine-sweep"), async (tx) => {
      for (const asset of await strandedAssets(tx, limits.deadlineMs, withJobs)) {
        const wrote = await reportLost(tx, {
          orgId,
          assetId: asset.id,
          payload: lostEvent(orgId, asset.publication_id, asset.id),
        });
        if (!wrote) continue;
        log.warn({ asset: asset.id }, "an asset with no job left was settled as lost");
        settled += 1;
      }
      for (const left of await strandedImports(tx, limits.deadlineMs, withJobs)) {
        const wrote = await reportLost(tx, {
          orgId,
          assetId: left.id,
          payload: lostEvent(orgId, left.publication_id, left.id, "docx.import"),
        });
        if (!wrote) continue;
        log.warn({ import: left.id }, "a Word import with no job left was settled as lost");
        settled += 1;
      }
      // hosted layout: what waits with no job left, and runs whose worker stopped reporting
      const layoutLeft = [
        ...(await strandedLayout(tx, limits.deadlineMs, withJobs)),
        ...(await stalledRuns(tx, limits.runStaleMs ?? RUN_STALE_MS)).map((r) => ({
          kind: "engine.layout" as const,
          ...r,
        })),
      ];
      for (const left of layoutLeft) {
        const wrote = await reportLost(tx, {
          orgId,
          assetId: left.id,
          payload: lostEvent(orgId, left.publication_id, left.id, left.kind),
        });
        if (!wrote) continue;
        log.warn({ target: left.id, kind: left.kind }, "a layout job with no worker left was settled as lost");
        settled += 1;
      }
      for (const left of await strandedDrafts(tx, limits.deadlineMs, withJobs)) {
        const wrote = await reportLost(tx, {
          orgId,
          assetId: left.id,
          payload: lostEvent(orgId, left.publication_id, left.id, "news.draft"),
        });
        if (!wrote) continue;
        log.warn({ draft: left.id }, "a news draft with no job left was settled as lost");
        settled += 1;
      }
    });
  }
  return settled;
}

function lostEvent(
  orgId: string,
  pubId: string,
  targetId: string,
  kind: (typeof JOB_KINDS)[number] = "media.ingest",
): EngineEvent {
  return {
    kind: "job.failed",
    org_id: orgId,
    pub_id: pubId,
    job_kind: kind,
    target_id: targetId,
    ...LOST,
  };
}

export type EngineInbox = { close(): Promise<void> };

/** Starts the consumer (LISTEN, and a poll) and the sweep (now, then every sweepMs); close() stops both and waits for
 * a pass in progress. */
export function startEngineInbox(
  database: Database,
  log: FastifyBaseLogger,
  store: ObjectStore | undefined,
  limits: SweepLimits = { staleMs: STALE_MS, deadlineMs: DEADLINE_MS },
  timing: { pollMs: number; sweepMs: number } = { pollMs: POLL_MS, sweepMs: SWEEP_MS },
): EngineInbox {
  let running: Promise<void> = Promise.resolve();
  let again = false;
  let busy = false;
  let closed = false;
  let unreachable = false;
  const drain = () => {
    if (closed) return;
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    running = (async () => {
      do {
        again = false;
        try {
          await drainInbox(database, log, store);
          unreachable = false;
        } catch (error) {
          // the database is down (or restarting): /readyz says so; said here once per outage
          if (!unreachable) log.warn({ err: error }, "the engine inbox could not be read; it is tried every poll");
          unreachable = true;
        }
      } while (again && !closed);
      busy = false;
    })();
  };
  let sweeping: Promise<unknown> = Promise.resolve();
  const sweepNow = () => {
    if (closed) return;
    sweeping = sweep(database, log, limits)
      .then((n) => (n > 0 ? drain() : undefined))
      .catch((error: unknown) => log.warn({ err: error }, "the engine sweep failed; it runs again in 5 minutes"));
  };
  const listening = listenAppEvents(
    database,
    {
      onMessage: drain,
      onGap: drain,
      onError: (error) => log.warn({ err: error }, "the engine inbox's LISTEN connection failed; it reconnects"),
    },
    "engine_events",
  );
  const poll = setInterval(drain, timing.pollMs);
  const sweeper = setInterval(sweepNow, timing.sweepMs);
  poll.unref();
  sweeper.unref();
  drain();
  sweepNow();
  return {
    async close() {
      closed = true;
      clearInterval(poll);
      clearInterval(sweeper);
      await listening.close();
      await Promise.all([running, sweeping]);
    },
  };
}
