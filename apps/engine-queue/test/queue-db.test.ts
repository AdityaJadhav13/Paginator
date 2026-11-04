// The queue end to end, on a database and a store of the test's own: Graphile Worker installed in schema `queue` by an
// owner, run as an engine role with ENGINE_GRANTS only (and an app role with APP_ENQUEUE), roles of the test's own
// (uniquely named, dropped after), driving the real Python runner (the newsprint conversion stood in for, as in
// apps/engine-worker's tests: the real profile is private) against an S3 store, and stand-in runners for the queue's
// own behaviour. Runs only when asked, and then fails, never skips:
//   PGN_QUEUE_DB_URL=postgres://postgres:…@127.0.0.1:…/postgres  (a superuser of a throwaway server)
//   PGN_QUEUE_PYTHON=apps/engine-worker/.venv/bin/python  PGN_S3_ENDPOINT=… PGN_S3_ACCESS_KEY_ID=… PGN_S3_SECRET_ACCESS_KEY=…
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeWorkerUtils } from "graphile-worker";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EngineEvent, WorkerResult } from "@pageinator/contracts";
import {
  APP_ENQUEUE,
  ENGINE_GRANTS,
  exhaustedJobs,
  installQueueSchema,
  MAX_ATTEMPTS,
  QUEUE_SCHEMA,
  refreshLock,
  runnerEnv,
  startQueue,
  type Report,
  type RunnerSettings,
} from "../src/index.ts";
import { doneResult, finished, PAYLOADS, RUN } from "./engine-fixtures.ts";
import type { JobHelpers } from "graphile-worker";

const ADMIN = process.env["PGN_QUEUE_DB_URL"];
const WORKER = fileURLToPath(new URL("../../engine-worker/", import.meta.url));
const ORG = "01890a5d-ac96-774b-bcce-b302099a8057";
const PUB = "01890a5d-ac96-774b-bcce-b302099a8058";
const ASSET = "01890a5d-ac96-774b-bcce-b302099a8059";
const OTHER_ORG = "9b2f4c1e-5d3a-4f6b-8c7d-0e1f2a3b4c5d"; // Better Auth's organisation ids are version 4
// the stand-in conversion (as test_jobs.py's), then the real command's main
const STAND_IN =
  "from pgn_worker.desk import images; images.rgb_to_cmyk = lambda img: img.convert('CMYK'); " +
  "from pgn_worker import run; raise SystemExit(run.main())";
// a fictional photo put in the store as the API leaves an original: its version id and SHA-256 on stdout
const UPLOAD = `
import hashlib, io, json, sys
from PIL import Image
from pgn_worker.storage_s3 import S3Settings
from pgn_worker.keys import KeyGuard
img = Image.new("RGB", (300, 200), (200, 20, 20)); buf = io.BytesIO(); img.save(buf, "JPEG"); data = buf.getvalue()
s = S3Settings.from_env(); c = s.client()
c.create_bucket(Bucket=s.work_bucket)
c.put_bucket_versioning(Bucket=s.work_bucket, VersioningConfiguration={"Status": "Enabled"})
v = c.put_object(Bucket=s.work_bucket, Key=KeyGuard(sys.argv[1], sys.argv[2]).asset_original(sys.argv[3]), Body=data)
print(json.dumps({"version_id": v["VersionId"], "sha256": hashlib.sha256(data).hexdigest()}))
`;
const REMOVE = `
from pgn_worker.storage_s3 import S3Settings
s = S3Settings.from_env(); c = s.client(); b = s.work_bucket
assert b.startswith("pgn-queue-test-")
listed = c.list_object_versions(Bucket=b)
for v in [*listed.get("Versions", []), *listed.get("DeleteMarkers", [])]:
    c.delete_object(Bucket=b, Key=v["Key"], VersionId=v["VersionId"])
c.delete_bucket(Bucket=b)
`;

// the stand-in runners' results: the runner's real ones (packages/contracts' fixture), for the job they are given
const results = JSON.parse(
  readFileSync(new URL("../../../packages/contracts/test/fixtures/worker-results.json", import.meta.url), "utf8"),
) as unknown[];
const ready = WorkerResult.parse(results[0]);
if (ready.outcome !== "done" || ready.event.kind !== "media.ready")
  throw new Error("the fixture's first result is a ready photo");
const misconfigured = results.find(
  (r) => WorkerResult.parse(r).outcome === "failed" && JSON.stringify(r).includes('"worker.config"'),
);
const READY_PAYLOAD = {
  org_id: ready.event.org_id,
  pub_id: ready.event.pub_id,
  asset_id: ready.event.asset_id,
  version_id: "v1",
  sha256: ready.event.sha256,
};
/** A stand-in runner (Node) that reads the job, then writes `result` for it and exits with `code`, or hangs (null). */
function standIn(result: unknown, code: number, timeoutMs = 2_000): RunnerSettings {
  const answer =
    result === null
      ? "setInterval(()=>{},1000);"
      : `const j=JSON.parse(job);process.stdout.write(JSON.stringify({...${JSON.stringify(result)},job:j.id})+'\\n',()=>process.exit(${code}));`;
  const script = "let job='';process.stdin.on('data',c=>job+=c);process.stdin.on('end',()=>{" + answer + "});";
  return { command: process.execPath, args: ["-e", script], health: ["-e", ""], cwd: WORKER, env: {}, timeoutMs };
}
const hex = () => randomBytes(4).toString("hex");
async function until(what: () => Promise<boolean>, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await what())) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 100));
  }
}
function collect() {
  const reported: Array<[EngineEvent, string]> = [];
  const report: Report = async (event, jobId) => void reported.push([EngineEvent.parse(event), jobId]);
  return { reported, report };
}
type JobRow = {
  id: string;
  attempts: number;
  max_attempts: number;
  locked_by: string | null;
  last_error: string | null;
  run_at: Date;
};

describe.runIf(ADMIN)("the queue on a database and a store of its own", () => {
  const engineRole = `pgn_engine_test_${hex()}`;
  const appRole = `pgn_app_test_${hex()}`;
  const password = randomBytes(18).toString("hex");
  const db = `pgn_queue_test_${hex()}`;
  const admin = new pg.Client({ connectionString: ADMIN });
  const url = new URL(ADMIN ?? "postgres://x/x");
  url.pathname = `/${db}`;
  const owner = new pg.Client({ connectionString: url.href });
  const as = (role: string) => {
    const u = new URL(url.href);
    u.username = role;
    u.password = password;
    return u.href;
  };
  const engineUrl = as(engineRole);
  const engineGrants = ENGINE_GRANTS.replaceAll("pgn_engine", engineRole);
  const queue = (runner: RunnerSettings, report: Report) =>
    startQueue({ connectionString: engineUrl, concurrency: 1, noHandleSignals: true, runner, report });
  const jobs = async () =>
    (
      await owner.query<JobRow>(
        `select id::text, attempts, max_attempts, locked_by, last_error, run_at
         from ${QUEUE_SCHEMA}._private_jobs order by id`,
      )
    ).rows;
  const enqueue = async (maxAttempts: number) => {
    const utils = await makeWorkerUtils({ connectionString: url.href, schema: QUEUE_SCHEMA });
    try {
      return (await utils.addJob("media.ingest", READY_PAYLOAD, { maxAttempts })).id;
    } finally {
      await utils.release();
    }
  };

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`create database ${db}`);
    // the role setup's rights (infra/docker/postgres-init.sql): only the login roles connect; nobody makes temp tables
    for (const role of [engineRole, appRole])
      await admin.query(
        `create role ${role} login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '${password}'`,
      );
    await admin.query(`revoke all on database ${db} from public`);
    await admin.query(`grant connect on database ${db} to ${engineRole}, ${appRole}`);
    await owner.connect();
    await owner.query(`revoke all on schema public from public; create schema ${QUEUE_SCHEMA}; create schema app`);
    await owner.query(`grant usage on schema app to ${appRole}`);
    // the tenancy context the wrapper checks (the API's first migration makes the same)
    await owner.query(`create function app.current_org() returns uuid language sql stable set search_path = pg_catalog
      return nullif(current_setting('app.org_id', true), '')::uuid`);
    // the owner (the migrator, in the API's migrations) installs Graphile Worker in its own transaction, then grants
    // each role its part
    await owner.query("begin");
    await installQueueSchema((text, values) => owner.query(text, values ? [...values] : undefined));
    await owner.query("commit");
    await owner.query(engineGrants);
    await owner.query(APP_ENQUEUE.replaceAll("pgn_app", appRole));
  }, 60_000);

  afterAll(async () => {
    await owner.end().catch(() => {});
    await admin.query(`drop database if exists ${db} with (force)`);
    await admin.query(`drop role if exists ${engineRole}`);
    await admin.query(`drop role if exists ${appRole}`);
    await admin.end();
  });

  it("installs Graphile Worker's schema as its own migrate() does, once", async () => {
    // Graphile Worker's own migrate(), into a schema of its own, then the two compared through the catalog
    const utils = await makeWorkerUtils({ connectionString: url.href, schema: "queue_ref" });
    await utils.migrate();
    await utils.release();
    const shape = async (schema: string) => {
      const { rows } = await owner.query<{ line: string }>(
        `select 'column ' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable
           || ' ' || coalesce(column_default, '') as line
         from information_schema.columns where table_schema = $1
         union all select 'function ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') '
           || p.prosrc from pg_proc p where p.pronamespace = $1::regnamespace
         union all select 'index ' || indexdef from pg_indexes where schemaname = $1
         union all select 'trigger ' || c.relname || '.' || t.tgname from pg_trigger t
           join pg_class c on c.oid = t.tgrelid where c.relnamespace = $1::regnamespace and not t.tgisinternal
         union all select 'rls ' || relname || ' ' || relrowsecurity from pg_class
           where relnamespace = $1::regnamespace and relkind = 'r'`,
        [schema],
      );
      const { rows: migrations } = await owner.query<{ line: string }>(
        `select 'migration ' || id || ' ' || breaking as line from "${schema}".migrations`,
      );
      const named = new RegExp(`(?<![A-Za-z0-9_])"?${schema}"?(?![A-Za-z0-9_])`, "g");
      return [...rows, ...migrations].map((r) => r.line.replace(named, "S")).sort();
    };
    const ours = await shape(QUEUE_SCHEMA);
    expect(ours.filter((l) => l.startsWith("migration "))).toHaveLength(20);
    expect(ours).toEqual(await shape("queue_ref"));
    await owner.query("drop schema queue_ref cascade");
    // run again, it finds every migration recorded and runs none
    expect(await installQueueSchema((text, values) => owner.query(text, values ? [...values] : undefined))).toEqual([]);
  });

  it("gives the engine role what running jobs needs, and nothing more", async () => {
    const roles = await admin.query(`select rolsuper, rolbypassrls from pg_roles where rolname = $1`, [engineRole]);
    expect(roles.rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
    const id = await enqueue(1);
    const engine = new pg.Client({ connectionString: engineUrl });
    await engine.connect();
    try {
      for (const sql of [
        "create table queue.planted (id int)",
        "create schema planted",
        "create temporary table planted (id int)",
        "update queue.migrations set breaking = true",
        "insert into queue._private_jobs (task_id, payload) values (1, '{}')",
        "insert into queue._private_known_crontabs (identifier, known_since) values ('x', now())",
        "select queue.add_job('media.ingest', '{}')",
        "select * from queue.jobs",
      ])
        await expect(engine.query(sql), sql).rejects.toThrow(/permission denied/);
      expect((await engine.query("select count(*)::int as n from queue._private_jobs")).rows).toEqual([{ n: 1 }]);
      // without its policy the role sees no job: row-level security is what opens the table to it
      await owner.query("drop policy engine_takes_jobs on queue._private_jobs");
      expect((await engine.query("select count(*)::int as n from queue._private_jobs")).rows).toEqual([{ n: 0 }]);
    } finally {
      await owner.query(engineGrants.split("\n").find((l) => l.includes("engine_takes_jobs")) ?? "");
      await engine.end();
      await owner.query("delete from queue._private_jobs where id = $1", [id]);
    }
  });

  it("lets the app role enqueue only through its wrapper, with the queue's attempts and key", async () => {
    const app = new pg.Client({ connectionString: as(appRole) });
    await app.connect();
    try {
      await expect(app.query("select queue.add_job('media.ingest', '{}')")).rejects.toThrow(/permission denied/);
      await expect(app.query("select * from queue._private_jobs")).rejects.toThrow(/permission denied/);
      const enqueue = (org: string) =>
        app.query<{ id: string }>("select app.enqueue_media_ingest($1, $2, $3, $4, $5)::text as id", [
          org,
          PUB,
          ASSET,
          "v1",
          "a".repeat(64),
        ]);
      // only for the organisation of the caller's transaction (withTenant's app.org_id)
      await expect(enqueue(ORG)).rejects.toMatchObject({ code: "42501" });
      await app.query("begin");
      await app.query("select set_config('app.org_id', $1, true)", [ORG]);
      await expect(enqueue(OTHER_ORG)).rejects.toMatchObject({ code: "42501" });
      await app.query("rollback");
      await app.query("begin");
      await app.query("select set_config('app.org_id', $1, true)", [ORG]);
      const { rows } = await enqueue(ORG);
      await app.query("commit");
      const job = await owner.query(
        `select j.payload, j.max_attempts, j.key, t.identifier as task_identifier
         from ${QUEUE_SCHEMA}._private_jobs as j join ${QUEUE_SCHEMA}._private_tasks as t on t.id = j.task_id
         where j.id = $1`,
        [rows[0]?.id],
      );
      expect(job.rows).toEqual([
        {
          payload: { org_id: ORG, pub_id: PUB, asset_id: ASSET, version_id: "v1", sha256: "a".repeat(64) },
          max_attempts: MAX_ATTEMPTS,
          key: `asset:${ASSET}`,
          task_identifier: "media.ingest",
        },
      ]);
    } finally {
      await app.end();
      await owner.query("delete from queue._private_jobs");
    }
    const engine = new pg.Client({ connectionString: engineUrl });
    await engine.connect();
    await expect(engine.query("select app.enqueue_media_ingest($1, $1, $1, 'v1', 'x')", [ORG])).rejects.toThrow(
      /permission denied/,
    );
    await engine.end();
  });

  it("runs media.ingest as the engine role through the real runner and reports media.ready", async () => {
    const python = process.env["PGN_QUEUE_PYTHON"] ?? "";
    expect(python, "PGN_QUEUE_PYTHON").not.toBe("");
    const bucket = `pgn-queue-test-${randomBytes(6).toString("hex")}`;
    const folder = mkdtempSync(join(tmpdir(), "pgn-queue-"));
    const homes = join(folder, "homes");
    mkdirSync(homes);
    chmodSync(homes, 0o700);
    const profile = join(folder, "fictional.icc");
    writeFileSync(profile, "a fictional colour profile");
    const env = runnerEnv({
      ...process.env,
      PYTHONPATH: WORKER,
      PGN_S3_WORK_BUCKET: bucket,
      PGN_ICC_SHA256: createHash("sha256").update("a fictional colour profile").digest("hex"),
      PAGEINATOR_ICC: profile,
      PGN_WORKER_HOMES: homes,
    });
    try {
      const stored = JSON.parse(
        execFileSync(python, ["-B", "-c", UPLOAD, ORG, PUB, ASSET], { cwd: WORKER, env, encoding: "utf8" }),
      ) as { version_id: string; sha256: string };
      const utils = await makeWorkerUtils({ connectionString: url.href, schema: QUEUE_SCHEMA });
      const payload = { org_id: ORG, pub_id: PUB, asset_id: ASSET, ...stored };
      const job = await utils.addJob("media.ingest", payload, { maxAttempts: 2 });
      await utils.release();

      const { reported, report } = collect();
      // Graphile Worker's cron, with no item, only reads known_crontabs: nothing it does is refused
      const logged = vi.spyOn(console, "error");
      const runner = await queue(
        {
          command: python,
          args: ["-B", "-c", STAND_IN],
          health: ["-B", "-m", "pgn_worker.health"], // the real health command, on the test's homes and profile
          cwd: WORKER,
          env,
          timeoutMs: 60_000,
        },
        report,
      );
      await until(async () => reported.length > 0, 60_000);
      await runner.stop();
      await runner.promise;
      expect(logged.mock.calls.flat().filter((m) => /cron|permission/i.test(String(m)))).toEqual([]);
      logged.mockRestore();
      expect(reported).toHaveLength(1);
      const [event, jobId] = reported[0] ?? [];
      expect(jobId).toBe(job.id);
      expect(event?.kind === "media.ready" && [event.asset_id, event.width_px, event.renditions.length]).toEqual([
        ASSET,
        300,
        3,
      ]);
      expect(await jobs()).toEqual([]); // the job is finished and gone
    } finally {
      try {
        execFileSync(python, ["-B", "-c", REMOVE], { cwd: WORKER, env });
      } catch {
        // no bucket was made
      }
    }
  }, 120_000);

  it("never leaves a job locked when it stops: a running job ends and is run again soon", async () => {
    const id = await enqueue(3);
    const { reported, report } = collect();
    const hang = await queue(standIn(null, 0), report);
    await until(async () => (await jobs())[0]?.locked_by != null);
    await hang.stop();
    await hang.promise;
    const [row] = await jobs();
    expect(row).toMatchObject({ id, attempts: 1, max_attempts: 3, locked_by: null });
    expect(row?.last_error).toContain("worker.timeout");
    expect((row?.run_at.getTime() ?? Infinity) - Date.now()).toBeLessThan(5_000); // the first backoff: e¹ s
    expect(reported).toEqual([]);
    // a queue started again runs it as soon as that backoff ends
    const good = await queue(standIn(results[0], 0), report);
    await until(async () => reported.length > 0);
    await good.stop();
    expect(reported.map(([e, j]) => [e.kind, j])).toEqual([["media.ready", id]]);
    expect(await jobs()).toEqual([]);
  }, 60_000);

  it("releases a lock left by a process that is gone (older than the runner's limit and its margin), not a live one", async () => {
    const [dead, alive] = [await enqueue(3), await enqueue(3)];
    const set = (sql: string, id: string) => owner.query(`update queue._private_jobs set ${sql} where id = $1`, [id]);
    // killed (SIGKILL, a reboot) on its first attempt, ten minutes ago: Graphile Worker would wait 4 hours
    await set("attempts = 1, locked_by = 'killed', locked_at = now() - interval '10 minutes'", dead);
    await set("attempts = 1, locked_by = 'alive', locked_at = now()", alive);
    const { reported, report } = collect();
    const good = await queue(standIn(results[0], 0), report); // a 2 s limit: stale after 2 s + 5 minutes
    await until(async () => reported.length > 0);
    await good.stop();
    await good.promise;
    expect(reported.map(([e, j]) => [e.kind, j])).toEqual([["media.ready", dead]]);
    expect(await jobs()).toEqual([expect.objectContaining({ id: alive, attempts: 1, locked_by: "alive" })]);
    await owner.query("delete from queue._private_jobs");
  }, 30_000);

  it("finishes a job it reported on its last attempt, though the queue stops at once", async () => {
    const id = await enqueue(1);
    const { reported, report } = collect();
    const hang = await queue(standIn(null, 0), report);
    await until(async () => (await jobs())[0]?.locked_by != null);
    await hang.stop();
    expect(reported.map(([e, j]) => [e.kind, e.kind === "job.failed" && e.code, j])).toEqual([
      ["job.failed", "worker.timeout", id],
    ]);
    expect(await jobs()).toEqual([]);
  }, 30_000);

  it("stops the queue on a misconfigured worker, and gives the job its attempt back", async () => {
    expect(misconfigured).toBeDefined();
    const id = await enqueue(1);
    const { reported, report } = collect();
    const stopped = await queue(standIn(misconfigured, 78), report);
    await expect(stopped.promise).rejects.toThrow(/misconfigured/);
    expect(reported).toEqual([]);
    expect(await jobs()).toEqual([expect.objectContaining({ id, attempts: 1, max_attempts: 2, locked_by: null })]);
    await owner.query("delete from queue._private_jobs");
  }, 30_000);

  it("lists the jobs nobody will settle, for the API's sweep: out of attempts, unlocked or locked too long", async () => {
    const [spent, dead, running, waiting] = [await enqueue(1), await enqueue(2), await enqueue(1), await enqueue(3)];
    const set = (sql: string, id: string) => owner.query(`update queue._private_jobs set ${sql} where id = $1`, [id]);
    await set("attempts = max_attempts, last_error = 'x'", spent);
    await set("attempts = 2, locked_by = 'pool-gone', locked_at = now() - interval '1 hour'", dead);
    await set("attempts = 1, locked_by = 'pool-alive', locked_at = now()", running);
    await set("attempts = 1", waiting);
    const found = await exhaustedJobs(
      (text, values) => owner.query(text, values ? [...values] : undefined),
      10 * 60_000,
    );
    expect(found.map((j) => [j.id, j.task_identifier, j.payload])).toEqual([
      [spent, "media.ingest", READY_PAYLOAD],
      [dead, "media.ingest", READY_PAYLOAD],
    ]);
    await owner.query("delete from queue._private_jobs");
  });

  it("keeps a running layout's lock fresh, and stops it on a user's cancel (engine_cancel), reporting its answer", async () => {
    const utils = await makeWorkerUtils({ connectionString: url.href, schema: QUEUE_SCHEMA });
    const job = await utils.addJob("engine.layout", PAYLOADS["engine.layout"], {
      queueName: "engine-cpu",
      jobKey: `run:${RUN}`,
      maxAttempts: 1,
    });
    await utils.release();
    // the launcher's part: on SIGTERM it answers run.finished cancelled
    const answer = JSON.stringify(doneResult(finished("cancelled")));
    const script =
      "let job='';process.stdin.on('data',c=>job+=c);process.stdin.on('end',()=>{const j=JSON.parse(job);" +
      `process.on('SIGTERM',()=>process.stdout.write(JSON.stringify({...${answer},job:j.id})+'\\n',()=>process.exit(0)));` +
      "setInterval(()=>{},1000);});";
    const { reported, report } = collect();
    const runner = await queue(
      {
        command: process.execPath,
        args: ["-e", script],
        health: ["-e", ""],
        cwd: WORKER,
        env: {},
        timeoutMs: 2_000,
        limitsMs: { "engine.layout": 60_000 },
      },
      report,
    );
    try {
      await until(async () => (await jobs())[0]?.locked_by != null);
      const locks = async () =>
        (
          await owner.query<{ job: Date; queue: Date; locked_by: string; job_queue_id: number }>(
            `select j.locked_at as job, q.locked_at as queue, j.locked_by, j.job_queue_id
             from queue._private_jobs j join queue._private_job_queues q on q.id = j.job_queue_id where j.id = $1`,
            [job.id],
          )
        ).rows[0];
      const held = await locks();
      expect(held?.queue).not.toBeNull(); // the named queue is locked with the job
      await owner.query("update queue._private_jobs set locked_at = now() - interval '10 minutes' where id = $1", [
        job.id,
      ]);
      await owner.query("update queue._private_job_queues set locked_at = now() - interval '10 minutes'");
      // the refresh, as the engine role under ENGINE_GRANTS: another holder's lock is left alone, its own refreshed
      const engine = new pg.Client({ connectionString: engineUrl });
      await engine.connect();
      try {
        const as = (lockedBy: string) =>
          ({
            job: {
              id: job.id,
              locked_by: lockedBy,
              job_queue_id: held?.job_queue_id,
              task_identifier: "engine.layout",
            },
            withPgClient: (fn: (c: pg.Client) => unknown) => fn(engine),
            logger: { warn: (m: string) => expect.fail(m) },
          }) as unknown as JobHelpers;
        const age = async () => {
          const l = await locks();
          return [Date.now() - (l?.job.getTime() ?? 0), Date.now() - (l?.queue.getTime() ?? 0)].map(
            (ms) => ms < 60_000,
          );
        };
        await refreshLock(as("another-pool"));
        expect(await age()).toEqual([false, false]);
        await refreshLock(as(held?.locked_by ?? ""));
        expect(await age()).toEqual([true, true]);
      } finally {
        await engine.end();
      }
      // a user's cancel: the API's app.cancel_engine_job NOTIFYs the job's key (again until heard: the listener may
      // still be connecting)
      await until(async () => {
        await owner.query("select pg_notify('engine_cancel', $1)", [`run:${RUN}`]);
        return reported.length > 0;
      });
      expect(reported.map(([e, j]) => [e.kind, e.kind === "run.finished" && e.state, j])).toEqual([
        ["run.finished", "cancelled", job.id],
      ]);
      await until(async () => (await jobs()).length === 0); // finished, not failed: never run again
    } finally {
      await runner.stop();
      await runner.promise;
      await owner.query("delete from queue._private_jobs");
    }
  }, 60_000);
});
