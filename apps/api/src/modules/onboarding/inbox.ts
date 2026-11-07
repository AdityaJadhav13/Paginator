// Onboarding's engine events, applied in the engine inbox's one transaction (src/modules/media/engine-inbox.ts). The
// inbox's asset_id is the onboarding; it is found under the event's organisation and publication, so another's is not
// found (refused: not_found). Every event is applied only while the onboarding is active (queued, working) and, but a
// failed job, only for its own inputs file (SHA-256): a cancelled or ended onboarding ignores what comes later.
//   - onboard.progress → working: a heartbeat and the step;
//   - onboard.ready → ready: each file's check, the report and the bundle (which must be at the onboarding's own key
//     onboarding/<id>/dataset.zip, else refused: dataset_key);
//   - onboard.rejected → rejected, with the code, its params, the English words and each file's check;
//   - a failed engine.onboard (the worker's, or the sweep's lost or stalled) → failed, with the code.
// Audited as the system: onboarding.ready, onboarding.fail.
import type { EngineEvent } from "@pageinator/contracts";
import type { FastifyBaseLogger } from "fastify";
import { recordAudit } from "../../db/audit.ts";
import { ONBOARDING_ACTIVE, findOnboarding, updateOnboarding } from "../../db/onboarding.ts";
import type { Tenant, Tx } from "../../db/tenant.ts";
import type { Applied } from "../media/imports.ts";

export type OnboardEvent =
  | Extract<EngineEvent, { kind: "onboard.progress" | "onboard.ready" | "onboard.rejected" }>
  | (Extract<EngineEvent, { kind: "job.failed" }> & { job_kind: "engine.onboard" });

export function isOnboardEvent(event: EngineEvent): event is OnboardEvent {
  return event.kind === "job.failed" ? event.job_kind === "engine.onboard" : event.kind.startsWith("onboard.");
}

export const onboardTarget = (event: OnboardEvent): string =>
  event.kind === "job.failed" ? event.target_id : event.onboarding_id;

export async function applyOnboardEvent(
  tx: Tx,
  tenant: Tenant,
  event: OnboardEvent,
  job: string,
  log: FastifyBaseLogger,
): Promise<Applied> {
  const pub = event.pub_id;
  const id = onboardTarget(event);
  const row = await findOnboarding(tx, pub, id, true);
  if (!row) return { refuse: "not_found" };
  if (!ONBOARDING_ACTIVE.includes(row.state)) return "ignored";
  const audit = (action: "onboarding.ready" | "onboarding.fail", data: Record<string, unknown>) =>
    recordAudit(tx, tenant, {
      action,
      actorKind: "system",
      targetType: "paper_onboarding",
      targetId: id,
      publicationId: pub,
      data: { job, ...data },
    });
  if (event.kind === "job.failed") {
    await updateOnboarding(tx, pub, id, {
      state: "failed",
      problem: event.code,
      params: null,
      message: event.message || event.code,
    });
    await audit("onboarding.fail", { code: event.code });
    return "applied";
  }
  if (event.sha256 !== row.inputs_sha256) {
    log.warn({ job, kind: event.kind }, "an engine event for other bytes was ignored");
    await recordAudit(tx, tenant, {
      action: "engine.event_ignore",
      actorKind: "system",
      targetType: "engine_event",
      targetId: id,
      data: { job, kind: event.kind, reason: "other_bytes" },
    });
    return "ignored";
  }
  if (event.kind === "onboard.progress") {
    await updateOnboarding(tx, pub, id, {
      state: "working",
      progress: { step: event.step, done: event.done, total: event.total },
    });
    return "applied";
  }
  if (event.kind === "onboard.rejected") {
    await updateOnboarding(tx, pub, id, {
      state: "rejected",
      checks: event.files,
      problem: event.code,
      params: event.params,
      message: event.message,
    });
    await audit("onboarding.fail", { code: event.code });
    return "applied";
  }
  if (event.dataset.key !== row.dataset_key) return { refuse: "dataset_key" };
  if (event.dataset.bytes < 1) return { refuse: "dataset_key" };
  await updateOnboarding(tx, pub, id, {
    state: "ready",
    checks: event.files,
    report: event.report,
    dataset: { version_id: event.dataset.version_id, sha256: event.dataset.sha256, bytes: event.dataset.bytes },
  });
  await audit("onboarding.ready", { editions: event.report.editions, pages: event.report.pages });
  return "applied";
}
