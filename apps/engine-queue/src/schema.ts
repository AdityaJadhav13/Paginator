// Graphile Worker's own schema, installed by the API's migrator (plan §2.2 step 1) inside its migration's transaction.
// Graphile Worker's migrate() runs each of its migrations in a transaction of its own (BEGIN … COMMIT on the client
// it is given), so it cannot run inside the migrator's; this applies the same SQL texts, in the same order, recorded in
// queue.migrations as migrate() records them (lib/migrate.js of 0.18.0: the bootstrap, then each migration not yet
// recorded, with its `breaking` flag). A worker that starts later finds every migration recorded and installs nothing.
// A Graphile Worker upgrade is read again (its migrate.js and its SQL) and installed by a new API migration that calls
// this once more: only the migrations not yet recorded run.
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { QUEUE_SCHEMA } from "./tasks.ts";

/** Graphile Worker's migration files, as its package ships them (sql/NNNNNN.sql; its migrate() reads the same texts,
 * bundled). Read as files: the package exports nothing but its entry point. */
function migrationFiles(): [string, string][] {
  const folder = new URL("../sql/", pathToFileURL(createRequire(import.meta.url).resolve("graphile-worker")));
  return readdirSync(folder)
    .filter((file) => /^[0-9]{6}\.sql$/.test(file))
    .sort()
    .map((file) => [file, readFileSync(new URL(file, folder), "utf8")]);
}

/** One SQL statement (or, with no values, several) on the migrator's transaction. */
export type Query = (text: string, values?: readonly unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

const SCHEMA = `"${QUEUE_SCHEMA}"`;

/** Applies Graphile Worker's migrations that `queue.migrations` does not record yet; returns their numbers. */
export async function installQueueSchema(query: Query): Promise<number[]> {
  // the bootstrap, as installSchema() writes it (the schema itself is the migrator's, made by the API's first migration)
  await query(`create schema if not exists ${SCHEMA};
create table if not exists ${SCHEMA}.migrations(
  id int primary key,
  ts timestamptz default now() not null
);
alter table ${SCHEMA}.migrations add column if not exists breaking boolean not null default false;`);
  const known = migrationFiles().map(([file, text]) => ({
    id: Number.parseInt(file.slice(0, 6), 10),
    text: text.replace(/:GRAPHILE_WORKER_SCHEMA\b/g, SCHEMA),
    breaking: text.startsWith("--! breaking"),
  }));
  const { rows } = await query(`select coalesce(max(id), 0)::int as id from ${SCHEMA}.migrations`);
  const latest = Number(rows[0]?.["id"] ?? 0);
  const highest = Math.max(...known.map((m) => m.id));
  if (latest > highest)
    throw new Error(`queue.migrations records Graphile Worker migration ${latest}; this version knows ${highest} only`);
  const applied: number[] = [];
  for (const m of known) {
    if (m.id <= latest) continue;
    await query(`insert into ${SCHEMA}.migrations (id, breaking) values ($1, $2)`, [m.id, m.breaking]);
    await query(m.text);
    applied.push(m.id);
  }
  return applied;
}
