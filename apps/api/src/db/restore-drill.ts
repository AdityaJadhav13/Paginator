// The restore drill (docs/runbooks/restore.md, "Drill"; scripts/verify-restore.ts runs it): it reads the live
// database's facts, takes a dump exactly as the nightly backup does (scripts/db-backup.ts), reads the facts again,
// fetches the dump back and checks its SHA-256 against the store's, restores it with `pg_restore --exit-on-error` into a
// NEW database, and compares. Every fact is read as pgn_backup (BYPASSRLS, read-only), on the live and the restored
// database alike.
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import pg from "pg";
import { loadBackupConfig } from "../config.ts";
import { s3Client } from "../storage/s3.ts";
import { auditMarker } from "./audit.ts";
import { MIGRATIONS, MIGRATION_NAME } from "./migrate.ts";

type Facts = {
  counts: Record<string, number>;
  migrations: string[];
  policies: string;
  rls: string;
  auditMarker: { id: string; hash: string } | undefined;
  storyMarker: { story_id: string; rev: number; hash: string } | undefined;
};
type Line = { status: "PASS" | "FAIL" | "SKIP"; check: string; detail: string };

const SYSTEM = "('pg_catalog', 'information_schema', 'pg_toast')";

/** Each table's restored count must lie between the live counts read just before and just after the dump (equal when
 * nobody wrote in between); a table only on one side fails. */
export function compareCounts(
  before: Record<string, number>,
  restored: Record<string, number>,
  after: Record<string, number>,
): string[] {
  const names = new Set([...Object.keys(before), ...Object.keys(restored), ...Object.keys(after)]);
  const problems: string[] = [];
  for (const name of [...names].sort()) {
    const [b, r, a] = [before[name], restored[name], after[name]];
    if (b === undefined || r === undefined || a === undefined) problems.push(`${name}: not in every database`);
    else if (r < Math.min(b, a) || r > Math.max(b, a)) problems.push(`${name}: ${r} restored, live ${b}..${a}`);
  }
  return problems;
}

async function facts(client: Pick<pg.Client, "query">): Promise<Facts> {
  const tables = await client.query<{ name: string }>(
    `select format('%I.%I', schemaname, tablename) as name from pg_tables where schemaname not in ${SYSTEM} order by 1`,
  );
  const counts: Record<string, number> = {};
  for (const { name } of tables.rows) {
    counts[name] = Number((await client.query<{ n: string }>(`select count(*) as n from ${name}`)).rows[0]?.n);
  }
  const migrations = (await client.query<{ name: string }>("select name from migrations.kysely_migration order by 1"))
    .rows;
  const policies = await client.query(
    `select schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check from pg_policies
     order by 1, 2, 3`,
  );
  const rls = await client.query(
    `select n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c
     join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r', 'p') and n.nspname not in ${SYSTEM}
     order by 1, 2`,
  );
  const story = await client.query<{ story_id: string; rev: number; hash: string }>(
    `select story_id, rev, md5(concat_ws(e'\\n', headline, kicker, deck, byline, body)) as hash from app.story_revision
     order by opened_at desc, story_id, rev desc limit 1`,
  );
  return {
    counts,
    migrations: migrations.map((row) => row.name),
    policies: JSON.stringify(policies.rows),
    rls: JSON.stringify(rls.rows),
    auditMarker: await auditMarker(client),
    storyMarker: story.rows[0],
  };
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${command} exited with ${code}`))));
  });
}

/** A restored database's name: the live one's, the time and a random part, so two drills never pick the same. */
export function restoreName(live: string, now = new Date(), random = randomBytes(4).toString("hex")): string {
  return `${live}_restore_${now.toISOString().replace(/\D/g, "").slice(0, 14)}_${random}`;
}

type Querier = { query(text: string): Promise<unknown> };

/** Makes the database, runs fn, and drops it afterwards unless kept: only a database this call made is ever dropped
 * (a name that exists already fails the create, and that database is left alone). */
export async function withRestoreDatabase<T>(
  admin: Querier,
  name: string,
  keep: boolean,
  fn: () => Promise<T>,
): Promise<T> {
  await admin.query(`create database ${pg.escapeIdentifier(name)} template template0`);
  try {
    return await fn();
  } finally {
    if (keep) console.log(`kept: database ${name}`);
    else await admin.query(`drop database if exists ${pg.escapeIdentifier(name)} with (force)`);
  }
}

type Client = Pick<pg.Client, "query" | "end">;
export type DrillDeps = {
  /** A session as pgn_backup (read-only) on a database, or as the admin on `postgres`. */
  connect(database: string, as: "backup" | "admin"): Promise<Client>;
  /** scripts/db-backup.ts; its output. */
  backup(): Promise<string>;
};

function liveDeps(env: NodeJS.ProcessEnv): DrillDeps {
  const config = loadBackupConfig(env);
  const adminPassword = env["PGN_RESTORE_ADMIN_PASSWORD"] ?? "";
  // the backup runs without the admin's password: it needs only its own settings
  const backupEnv = Object.fromEntries(Object.entries(env).filter(([key]) => key !== "PGN_RESTORE_ADMIN_PASSWORD"));
  return {
    async connect(database, as) {
      const client = new pg.Client({
        host: config.database.host,
        port: config.database.port,
        database,
        application_name: "pageinator-verify-restore",
        ...(as === "backup"
          ? { user: "pgn_backup", password: config.database.password, options: "-c default_transaction_read_only=on" }
          : { user: env["PGN_RESTORE_ADMIN_USER"] || "postgres", password: adminPassword }),
      });
      try {
        await client.connect();
      } catch (error) {
        await client.end().catch(() => undefined);
        throw error;
      }
      return client;
    },
    backup: () => run("node", ["scripts/db-backup.ts"], backupEnv),
  };
}

/** Runs the drill; prints one line per check (also when it stops part way) and returns false when any check failed.
 * Every session and file it opens is closed or removed on every path. */
export async function restoreDrill(env: NodeJS.ProcessEnv = process.env, deps?: DrillDeps): Promise<boolean> {
  const started = Date.now();
  const config = loadBackupConfig(env);
  const adminPassword = env["PGN_RESTORE_ADMIN_PASSWORD"];
  if (!adminPassword) throw new Error("PGN_RESTORE_ADMIN_PASSWORD must be set");
  const adminUser = env["PGN_RESTORE_ADMIN_USER"] || "postgres";
  const { connect, backup } = deps ?? liveDeps(env);
  const { host, port, name } = config.database;
  const lines: Line[] = [];
  const say = (ok: boolean, check: string, detail: string) =>
    lines.push({ status: ok ? "PASS" : "FAIL", check, detail });
  const skip = (check: string, detail = "none in the live database") => lines.push({ status: "SKIP", check, detail });
  let file: string | undefined;
  let key: string | undefined;
  try {
    const live = await connect(name, "backup");
    let before: Facts;
    let after: Facts;
    let done: string;
    try {
      before = await facts(live);
      done = await backup();
      after = await facts(live);
    } finally {
      await live.end();
    }
    key = /^backup done: s3:\/\/[^/]+\/(\S+?),/m.exec(done)?.[1];
    if (!key) throw new Error(`the backup did not say where it put the dump: ${done.trim()}`);

    // the dump back from the store, with its SHA-256 against the one the backup recorded (metadata and checksum)
    const client = s3Client(config.storage);
    const head = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key, ChecksumMode: "ENABLED" }));
    const object = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
    file = join(env["PGN_BACKUP_DIR"] || "/tmp", `pgn-restore-${Date.now()}-${randomBytes(4).toString("hex")}.dump`);
    const hash = createHash("sha256");
    const hashing = new Transform({
      transform(chunk: Buffer, _encoding, next) {
        hash.update(chunk);
        next(null, chunk);
      },
    });
    await pipeline(object.Body as Readable, hashing, createWriteStream(file, { mode: 0o600 }));
    const sha256 = hash.digest();
    say(head.Metadata?.["sha256"] === sha256.toString("hex"), "dump: sha256 metadata", sha256.toString("hex"));
    say(
      head.ChecksumSHA256 === undefined || head.ChecksumSHA256 === sha256.toString("base64"),
      "dump: store checksum",
      head.ChecksumSHA256 === undefined ? "the store gave none" : "equal",
    );
    say(head.ObjectLockMode === "GOVERNANCE", "dump: object lock", `${head.ObjectLockMode ?? "none"}`);

    const restoredName = restoreName(name);
    const dumpFile = file;
    const admin = await connect("postgres", "admin");
    try {
      await withRestoreDatabase(admin, restoredName, env["PGN_RESTORE_KEEP"] === "1", async () => {
        const restoreStarted = Date.now();
        await run(
          "pg_restore",
          [
            "--exit-on-error",
            "--no-password",
            `--host=${host}`,
            `--port=${port}`,
            `--username=${adminUser}`,
            `--dbname=${restoredName}`,
            dumpFile,
          ],
          { ...env, PGPASSWORD: adminPassword },
        );
        say(true, "restore: pg_restore --exit-on-error", `${restoredName}, ${Date.now() - restoreStarted} ms`);
        await admin.query(`grant connect on database ${pg.escapeIdentifier(restoredName)} to pgn_backup`);
        const restored = await connect(restoredName, "backup");
        try {
          const got = await facts(restored);
          const problems = compareCounts(before.counts, got.counts, after.counts);
          const watched = ["app.story", 'identity."user"', "app.asset"]
            .map((table) => `${table} ${got.counts[table] ?? "?"}`)
            .join(", ");
          say(
            problems.length === 0,
            "counts",
            problems.join("; ") || `${Object.keys(got.counts).length} tables; ${watched}`,
          );
          // as live, and every migration this release carries (none pending, none unknown)
          const carried = (await readdir(MIGRATIONS))
            .filter((file) => MIGRATION_NAME.test(file))
            .map((file) => file.replace(/\.ts$/, ""))
            .sort();
          say(
            JSON.stringify(got.migrations) === JSON.stringify(after.migrations) &&
              JSON.stringify(got.migrations) === JSON.stringify(carried),
            "migrations",
            `${got.migrations.length} applied of ${carried.length} in this release, newest ${got.migrations.at(-1) ?? "none"}`,
          );
          say(
            got.policies === after.policies,
            "row-level security policies",
            `${JSON.parse(got.policies).length} policies`,
          );
          const rls = JSON.parse(got.rls) as {
            nspname: string;
            relforcerowsecurity: boolean;
            relrowsecurity: boolean;
          }[];
          const app = rls.filter((row) => row.nspname === "app");
          say(
            got.rls === after.rls && app.every((row) => row.relrowsecurity && row.relforcerowsecurity),
            "RLS on and FORCE RLS",
            `${app.length} app tables all forced; every table's flags as live`,
          );
          const audit = before.auditMarker;
          if (!audit) skip("marker: newest audit event");
          else
            say(
              (await auditMarker(restored, audit.id))?.hash === audit.hash,
              "marker: newest audit event",
              `md5 ${audit.hash}`,
            );
          const story = before.storyMarker;
          if (!story) skip("marker: newest story text");
          else {
            const { rows } = await restored.query<{ hash: string }>(
              `select md5(concat_ws(e'\\n', headline, kicker, deck, byline, body)) as hash from app.story_revision
             where story_id = $1 and rev = $2`,
              [story.story_id, story.rev],
            );
            say(rows[0]?.hash === story.hash, "marker: newest story text", `md5 ${story.hash}`);
          }

          const work = process.env["PGN_S3_WORK_BUCKET"];
          if (!work) skip("photos in the store", "PGN_S3_WORK_BUCKET is not set");
          else {
            const photos = await restored.query<{ original_key: string; version_id: string | null }>(
              "select original_key, version_id from app.asset where deleted_at is null order by created_at desc limit 5",
            );
            const missing: string[] = [];
            for (const photo of photos.rows) {
              await client
                .send(
                  new HeadObjectCommand({
                    Bucket: work,
                    Key: photo.original_key,
                    ...(photo.version_id ? { VersionId: photo.version_id } : {}),
                  }),
                )
                .catch(() => missing.push(photo.original_key));
            }
            if (photos.rows.length === 0) skip("photos in the store");
            else
              say(
                missing.length === 0,
                "photos in the store",
                missing.length ? `missing: ${missing.join(", ")}` : `${photos.rows.length} newest originals found`,
              );
          }
        } finally {
          await restored.end();
        }
      });
    } finally {
      await admin.end();
    }
  } finally {
    if (file) await rm(file, { force: true });
    for (const line of lines) console.log(`${line.status} ${line.check}: ${line.detail}`);
    if (key)
      console.log(`dump s3://${config.bucket}/${key}; drill took ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }
  return lines.every((line) => line.status !== "FAIL");
}
