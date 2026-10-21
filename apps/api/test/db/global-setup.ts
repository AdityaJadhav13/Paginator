// Setup for the database tests (pnpm test:db; docs/product/10-l2-newsroom-plan.md §7.3): one template database per
// run, made like the development database and migrated, which each test file clones (test/db/helpers.ts); at the end,
// every database of the run is dropped. It needs the development database (pnpm dev:up) and the settings of .env.dev
// (the environment wins over the file): without them the run fails, it never skips.
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client, escapeIdentifier } from "pg";
import type { TestProject } from "vitest/node";
import { migrate } from "../../src/db/migrate.ts";
import { type TestSettings, connect, secure } from "./settings.ts";

const ENV_FILE = fileURLToPath(new URL("../../../../.env.dev", import.meta.url));
const PASSWORDS = {
  postgres: "PGN_POSTGRES_PASSWORD",
  migrator: "PGN_MIGRATOR_PASSWORD",
  app: "PGN_APP_PASSWORD",
  auth: "PGN_AUTH_PASSWORD",
  engine: "PGN_ENGINE_PASSWORD",
  listen: "PGN_LISTEN_PASSWORD",
} as const;

function settings(): TestSettings {
  if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
  const env = process.env;
  const missing = Object.values(PASSWORDS).filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(
      `The database tests need the development database's settings, and ${missing.join(", ")} are not set: ` +
        "copy .env.dev.example to .env.dev, run pnpm dev:up, then pnpm test:db.",
    );
  }
  const passwords = Object.fromEntries(
    Object.entries(PASSWORDS).map(([role, name]) => [role, env[name] ?? ""]),
  ) as TestSettings["passwords"];
  return {
    host: env["PGN_DB_HOST"] || "127.0.0.1",
    port: Number(env["PGN_DB_PORT"] || 55432),
    run: `pgn_test_${randomBytes(4).toString("hex")}`,
    passwords,
  };
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const base = settings();
  let admin: Client;
  try {
    admin = await connect(base, "postgres");
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    throw new Error(
      `The database tests could not reach the development database at ${base.host}:${base.port} (${why}): ` +
        "run pnpm dev:up first.",
      { cause: error },
    );
  }
  const template = `${base.run}_template`;
  try {
    await admin.query(`create database ${escapeIdentifier(template)} template template0`);
    await secure(admin, base, template, true);
    await migrate({ host: base.host, port: base.port, name: template, password: base.passwords.migrator });
  } catch (error) {
    await dropRun(admin, base.run);
    await admin.end();
    throw error;
  }
  project.provide("database", { ...base, template });
  return async () => {
    await dropRun(admin, base.run);
    await admin.end();
  };
}

/** Drops every database this run made, its clones included, even while connected. */
async function dropRun(admin: Client, run: string): Promise<void> {
  const { rows } = await admin.query<{ datname: string }>(
    "select datname from pg_database where starts_with(datname, $1)",
    [`${run}_`],
  );
  for (const { datname } of rows) await admin.query(`drop database ${escapeIdentifier(datname)} with (force)`);
}
