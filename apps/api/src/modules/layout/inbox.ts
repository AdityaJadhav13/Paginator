// Hosted layout's engine events, applied in the engine inbox's one transaction (src/modules/media/engine-inbox.ts;
// docs/product/10-l2-newsroom-plan.md §2.2). The inbox's asset_id is the event's target: the profile (engine.setup),
// the edition (engine.measure), the run (engine.layout) or the ad slot's artwork row (media.ad). Each target is found
// under the event's organisation and publication, so another's is not found (refused: not_found), except an ad slot's
// artwork, which a person may have cleared since (ignored).
//   - profile.ready → the profile ready (its config, which must be the profile's own config.json; its templates, grid
//     and six plans), and so in use; profile.rejected and a failed engine.setup → failed, with the code and the Desk's
//     words. Only a profile still setting up, and only for its dataset's bytes, takes them.
//   - measure.status → the edition's measuring progress, for the snapshot it names (its SHA-256); a failed
//     engine.measure → failed.
//   - run.progress → a heartbeat, the run's state and its pages' states; run.page → a page made (its files, each under
//     the run's own folder runs/<run>/); run.finished → the run settled: its pages and their check verdicts (also kept by
//     the bytes' SHA-256 and the checker's, app.pdf_check), the stories not placed with the engine's reason, edition.pdf
//     and press-files.zip. On a done run the edition's Ready stories it placed become Placed and its Placed stories it
//     did not place go back to Ready (system changes, audited as story.status_change); never on a failed or cancelled
//     run. A failed engine.layout → failed, in the Desk's words for a lost worker (m.run.restarted) when the worker was
//     lost or restarted. Every run event is applied only while the run is active and for its own request (SHA-256):
//     a cancelled or ended run ignores what comes later.
//   - ad.ready → the slot's artwork ready (its raster and preview under the asset's own renditions folder
//     assets/<asset>/r/); ad.rejected and a failed media.ad → failed. Only for the artwork's own picture and bytes.
// Audited as the system: engine_profile.ready/fail, layout.run_done/run_fail.
import type { EngineEvent } from "@pageinator/contracts";
import type { FastifyBaseLogger } from "fastify";
import { recordAudit } from "../../db/audit.ts";
import {
  ACTIVE_STATES,
  type DeskTextValue,
  findArtwork,
  findProfile,
  findRun,
  measureOf,
  putPage,
  recordCheck,
  settleArtwork,
  settleMeasure,
  settleProfile,
  type Stored,
  updateRun,
  writeBackPlaced,
} from "../../db/layout.ts";
import { findAsset } from "../../db/media.ts";
import type { Tenant, Tx } from "../../db/tenant.ts";
import type { Applied } from "../media/imports.ts";
import { RESTARTED, plain, runFailed } from "./views.ts";

const LAYOUT_KINDS = new Set(["engine.setup", "engine.measure", "engine.layout", "media.ad"]);

export type LayoutEvent =
  | Extract<
      EngineEvent,
      {
        kind:
          | "profile.ready"
          | "profile.rejected"
          | "measure.status"
          | "run.progress"
          | "run.page"
          | "run.finished"
          | "ad.ready"
          | "ad.rejected";
      }
    >
  | (Extract<EngineEvent, { kind: "job.failed" }> & {
      job_kind: "engine.setup" | "engine.measure" | "engine.layout" | "media.ad";
    });

export function isLayoutEvent(event: EngineEvent): event is LayoutEvent {
  return event.kind === "job.failed"
    ? LAYOUT_KINDS.has(event.job_kind)
    : /^(profile|measure|run|ad)\./.test(event.kind);
}

/** The target an event names (the inbox's asset_id). */
export function layoutTarget(event: LayoutEvent): string {
  if (event.kind === "job.failed") return event.target_id;
  if ("profile_id" in event) return event.profile_id;
  if ("artwork_id" in event) return event.artwork_id;
  if ("run_id" in event) return event.run_id;
  return event.edition_id;
}

/** The job failures that mean the worker went away mid-run (the queue's sweep, or the worker's own restart). */
const LOST = new Set(["worker.lost", "worker.restarted"]);

export async function applyLayoutEvent(
  tx: Tx,
  tenant: Tenant,
  event: LayoutEvent,
  job: string,
  log: FastifyBaseLogger,
): Promise<Applied> {
  const pub = event.pub_id;
  const target = layoutTarget(event);
  const otherBytes = async (): Promise<Applied> => {
    log.warn({ job, kind: event.kind }, "an engine event for other bytes was ignored");
    await recordAudit(tx, tenant, {
      action: "engine.event_ignore",
      actorKind: "system",
      targetType: "engine_event",
      targetId: target,
      data: { job, kind: event.kind, reason: "other_bytes" },
    });
    return "ignored";
  };

  // ------------------------------------------------------------------------------------------ the profile
  if (
    event.kind === "profile.ready" ||
    event.kind === "profile.rejected" ||
    (event.kind === "job.failed" && event.job_kind === "engine.setup")
  ) {
    const profile = await findProfile(tx, pub, target, true);
    if (!profile) return { refuse: "not_found" };
    if (profile.state !== "setting_up") return "ignored";
    if (event.kind !== "job.failed" && event.sha256 !== profile.dataset_sha256) return otherBytes();
    const audit = (action: "engine_profile.ready" | "engine_profile.fail", data: Record<string, unknown>) =>
      recordAudit(tx, tenant, {
        action,
        actorKind: "system",
        targetType: "engine_profile",
        targetId: target,
        publicationId: pub,
        data: { job, ...data },
      });
    if (event.kind === "profile.ready") {
      if (event.config.key !== profile.config_key) return { refuse: "config_key" };
      await settleProfile(tx, pub, target, {
        state: "ready",
        config: event.config,
        engineVersion: event.engine_version,
        templates: event.templates,
        grid: event.grid,
        plans: event.plans,
      });
      await audit("engine_profile.ready", { engineVersion: event.engine_version });
    } else {
      const message = event.kind === "profile.rejected" ? event.message : plain(event.message);
      await settleProfile(tx, pub, target, { state: "failed", problem: event.code, message });
      await audit("engine_profile.fail", { code: event.code });
    }
    return "applied";
  }

  // ------------------------------------------------------------------------------------------ measuring
  if (event.kind === "measure.status" || (event.kind === "job.failed" && event.job_kind === "engine.measure")) {
    const measure = await measureOf(tx, pub, target, true);
    if (!measure) return { refuse: "not_found" };
    if (event.kind === "job.failed") {
      if (measure.state !== "waiting" && measure.state !== "measuring") return "ignored";
      await settleMeasure(tx, pub, target, { state: "failed" });
      return "applied";
    }
    if (event.sha256 !== measure.sha256) return "ignored"; // an older snapshot's: a newer one is waiting
    await settleMeasure(tx, pub, target, {
      state: event.state,
      measured: event.measured,
      total: event.total,
      failed: event.failed,
    });
    return "applied";
  }

  // ------------------------------------------------------------------------------------------ ad slots
  if (
    event.kind === "ad.ready" ||
    event.kind === "ad.rejected" ||
    (event.kind === "job.failed" && event.job_kind === "media.ad")
  ) {
    const art = await findArtwork(tx, pub, target, true);
    if (!art) return "ignored"; // the slot was cleared since
    if (art.state !== "preparing") return "ignored";
    if (event.kind === "job.failed") {
      await settleArtwork(tx, pub, target, { state: "failed", problem: plain(event.message) });
      return "applied";
    }
    const asset = await findAsset(tx, pub, art.asset_id);
    if (event.asset_id !== art.asset_id || !asset || event.sha256 !== asset.sha256) return otherBytes();
    if (event.kind === "ad.rejected") {
      await settleArtwork(tx, pub, target, { state: "failed", problem: event.message });
      return "applied";
    }
    const folder = `${asset.original_key.slice(0, -"original".length)}r/`;
    if (!event.raster.key.startsWith(folder) || !event.preview.key.startsWith(folder)) return { refuse: "ad_key" };
    await settleArtwork(tx, pub, target, {
      state: "ready",
      raster: event.raster,
      preview: event.preview,
      paramsHash: event.params_hash,
    });
    return "applied";
  }

  // ------------------------------------------------------------------------------------------ runs
  const run = await findRun(tx, pub, target, true);
  if (!run) return { refuse: "not_found" };
  if (!ACTIVE_STATES.includes(run.state)) return "ignored"; // cancelled, or ended: what comes later changes nothing
  const audit = (action: "layout.run_done" | "layout.run_fail", data: Record<string, unknown>) =>
    recordAudit(tx, tenant, {
      action,
      actorKind: "system",
      targetType: "layout_run",
      targetId: run.id,
      publicationId: pub,
      data: { job, ...data },
    });
  if (event.kind === "job.failed") {
    const message = LOST.has(event.code) ? RESTARTED : runFailed(event.code);
    await updateRun(tx, pub, run.id, { state: "failed", finished: true, message, error: message });
    await audit("layout.run_fail", { code: event.code });
    return "applied";
  }
  if (event.sha256 !== run.request_sha256) return otherBytes();
  const folder = `${run.request_key.slice(0, -"request.json".length)}`;
  const inRun = (file: Stored | null | undefined) => !file || file.key.startsWith(folder);

  if (event.kind === "run.progress") {
    await updateRun(tx, pub, run.id, {
      state: event.state,
      message: event.message,
      heartbeat: true,
      started: true,
      elapsedS: event.elapsed_s,
    });
    for (const page of event.pages) await putPage(tx, tenant, pub, run.id, page, true);
    return "applied";
  }

  if (event.kind === "run.page") {
    if (![event.pdf, event.png, event.thumb].every(inRun)) return { refuse: "run_key" };
    await updateRun(tx, pub, run.id, { heartbeat: true, started: true });
    await putPage(tx, tenant, pub, run.id, {
      page: event.page,
      role: event.role,
      state: "done",
      articles: event.articles,
      pdf: event.pdf,
      png: event.png,
      thumb: event.thumb,
      warnings: event.warnings,
      seconds: event.seconds,
    });
    return "applied";
  }

  // run.finished
  const files = [event.edition_pdf, event.press_zip];
  for (const page of event.pages)
    if (page.state === "done") files.push(page.pdf, page.png, page.thumb, page.check.report);
  if (!files.every(inRun)) return { refuse: "run_key" };
  for (const page of event.pages) {
    if (page.state !== "done") {
      await putPage(tx, tenant, pub, run.id, {
        page: page.page,
        role: page.role,
        state: page.state,
        message: page.message,
      });
      continue;
    }
    const checked = { passed: page.check.passed, fails: page.check.fails, warnings: page.check.warnings };
    await recordCheck(tx, tenant.orgId, {
      sha256: page.pdf.sha256,
      checkerSha256: event.checker_sha256,
      ...checked,
      report: page.check.report,
    });
    await putPage(tx, tenant, pub, run.id, {
      page: page.page,
      role: page.role,
      state: "done",
      articles: page.articles,
      pdf: page.pdf,
      png: page.png,
      thumb: page.thumb,
      report: page.check.report,
      checked,
      warnings: page.warnings,
      seconds: page.seconds,
    });
  }
  const message: DeskTextValue | null = event.message;
  await updateRun(tx, pub, run.id, {
    state: event.state,
    message,
    error: event.error,
    finished: true,
    elapsedS: event.elapsed_s,
    engineVersion: event.engine_version,
    checkerSha256: event.checker_sha256,
    timings: event.timings,
    notPlaced: event.not_placed,
    editionPdf: event.edition_pdf,
    pressZip: event.press_zip,
  });
  if (event.state !== "done") {
    await audit("layout.run_fail", { code: event.state, pages: event.pages.length });
    return "applied";
  }
  const placed = event.pages.flatMap((page) => (page.state === "done" ? page.articles : []));
  const moved = await writeBackPlaced(tx, tenant, pub, run.edition_id, placed);
  for (const change of moved) {
    await recordAudit(tx, tenant, {
      action: "story.status_change",
      actorKind: "system",
      targetType: "story",
      targetId: change.id,
      publicationId: pub,
      data: { from: change.from_status, to: change.to_status, run: run.id },
    });
  }
  await audit("layout.run_done", {
    pages: event.pages.filter((page) => page.state === "done").length,
    failed: event.pages.filter((page) => page.state !== "done").length,
    notPlaced: event.not_placed.length,
    placed: moved.filter((change) => change.to_status === "placed").length,
    unplaced: moved.filter((change) => change.to_status === "ready").length,
  });
  return "applied";
}
