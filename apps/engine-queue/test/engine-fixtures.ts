// Fictional engine jobs and events (L2.3), each checked by the contract: the queue's tests of the engine's kinds.
import {
  EngineEvent,
  WORKER_JOB_FORMAT,
  WORKER_PROGRESS_FORMAT,
  WORKER_RESULT_FORMAT,
  WorkerJob,
  WorkerProgress,
  WorkerResult,
} from "@pageinator/contracts";

export const ORG = "01890a5d-ac96-774b-bcce-b302099a8057";
export const PUB = "01890a5d-ac96-774b-bcce-b302099a8058";
export const RUN = "01890a5d-ac96-774b-bcce-b302099a805a";
export const EDITION = "01890a5d-ac96-774b-bcce-b302099a805b";
export const PROFILE = "01890a5d-ac96-774b-bcce-b302099a805c";
export const ARTWORK = "01890a5d-ac96-774b-bcce-b302099a805d";
export const ASSET = "01890a5d-ac96-774b-bcce-b302099a805e";
export const ONBOARDING = "01890a5d-ac96-774b-bcce-b302099a805f";
export const SHA = "a".repeat(64);
const facts = {
  profile_id: PROFILE,
  dataset_version_id: "d1",
  dataset_sha256: "b".repeat(64),
  config_version_id: "c1",
  config_sha256: "c".repeat(64),
};

export const PAYLOADS = {
  "engine.setup": { org_id: ORG, pub_id: PUB, profile_id: PROFILE, version_id: "v1", sha256: SHA },
  "engine.measure": {
    org_id: ORG,
    pub_id: PUB,
    edition_id: EDITION,
    edition_key: "2026-11-04",
    version_id: "v1",
    sha256: SHA,
    ...facts,
  },
  "engine.layout": {
    org_id: ORG,
    pub_id: PUB,
    run_id: RUN,
    edition_key: "2026-11-04",
    run_key: "r-20261104-101500",
    version_id: "v1",
    sha256: SHA,
    ...facts,
  },
  "media.ad": {
    org_id: ORG,
    pub_id: PUB,
    artwork_id: ARTWORK,
    asset_id: ASSET,
    version_id: "v1",
    sha256: SHA,
    w_mm: "120",
    h_mm: "80.5",
  },
  "engine.onboard": { org_id: ORG, pub_id: PUB, onboarding_id: ONBOARDING, version_id: "v1", sha256: SHA },
} as const;
export type EngineKind = keyof typeof PAYLOADS;

const words = { text: "A fictional message.", code: null, params: null };
export const finished = (state: "done" | "failed" | "cancelled" = "cancelled") =>
  EngineEvent.parse({
    kind: "run.finished",
    org_id: ORG,
    pub_id: PUB,
    run_id: RUN,
    sha256: SHA,
    state,
    message: null,
    error: null,
    pages: [],
    not_placed: [],
    edition_pdf: null,
    press_zip: null,
    checker_sha256: "d".repeat(64),
    engine_version: "fake 1",
    timings: {},
    elapsed_s: 3,
  });
export const runProgress = (elapsed = 1) =>
  EngineEvent.parse({
    kind: "run.progress",
    org_id: ORG,
    pub_id: PUB,
    run_id: RUN,
    sha256: SHA,
    state: "layout",
    message: null,
    pages: [{ page: 1, role: "front", state: "working" }],
    elapsed_s: elapsed,
  });
export const measured = (state: "measuring" | "stopped" | "done" = "done") =>
  EngineEvent.parse({
    kind: "measure.status",
    org_id: ORG,
    pub_id: PUB,
    edition_id: EDITION,
    sha256: SHA,
    state,
    measured: 2,
    total: 3,
    failed: 0,
  });
export const profileRejected = () =>
  EngineEvent.parse({
    kind: "profile.rejected",
    org_id: ORG,
    pub_id: PUB,
    profile_id: PROFILE,
    sha256: SHA,
    code: "profile.no_pages",
    message: words,
  });
export const adRejected = () =>
  EngineEvent.parse({
    kind: "ad.rejected",
    org_id: ORG,
    pub_id: PUB,
    artwork_id: ARTWORK,
    asset_id: ASSET,
    sha256: SHA,
    message: words,
    status: 422,
  });
const onboardBase = { org_id: ORG, pub_id: PUB, onboarding_id: ONBOARDING, sha256: SHA };
export const onboardProgress = (done = 1) =>
  EngineEvent.parse({ kind: "onboard.progress", ...onboardBase, step: "reading", done, total: 12 });
export const onboardRejected = () =>
  EngineEvent.parse({
    kind: "onboard.rejected",
    ...onboardBase,
    code: "onboard.too_few_editions",
    params: null,
    files: [{ n: 1, status: "refused", date: null, pages: 4, notes: [{ code: "onboard.no_date", count: null }] }],
    message: "Fewer than 3 editions could be used.",
  });

export const engineJob = (kind: EngineKind, id = "1") =>
  WorkerJob.parse({ format: WORKER_JOB_FORMAT, id, kind, args: PAYLOADS[kind] });
const KIND_OF: Partial<Record<EngineEvent["kind"], EngineKind>> = {
  "profile.ready": "engine.setup",
  "profile.rejected": "engine.setup",
  "measure.status": "engine.measure",
  "run.finished": "engine.layout",
  "ad.ready": "media.ad",
  "ad.rejected": "media.ad",
  "onboard.ready": "engine.onboard",
  "onboard.rejected": "engine.onboard",
};
export const doneResult = (event: EngineEvent, job = "1") =>
  WorkerResult.parse({
    format: WORKER_RESULT_FORMAT,
    job,
    kind: KIND_OF[event.kind],
    outcome: "done",
    event,
  }) as Extract<WorkerResult, { outcome: "done" }>;
export const progressLine = (event: EngineEvent, seq: number, job = "1") =>
  WorkerProgress.parse({ format: WORKER_PROGRESS_FORMAT, job, seq, event });
