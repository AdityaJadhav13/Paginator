// The migration runner (src/db/migrate.ts) on empty databases made like the development one: what it applies, as
// whom, where it records it, and what it refuses.
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { MIGRATIONS, MIGRATION_NAME, migrate } from "../../src/db/migrate.ts";
import { type TestDatabase, freshDatabase } from "./helpers.ts";

const made: TestDatabase[] = [];
const folders: string[] = [];
afterAll(async () => {
  await Promise.all(made.map((db) => db.drop()));
  await Promise.all(folders.map((folder) => rm(folder, { recursive: true, force: true })));
});

async function empty(): Promise<TestDatabase> {
  const db = await freshDatabase("empty");
  made.push(db);
  return db;
}

/** A folder of planted migrations: plain JavaScript in .ts files, importing nothing. */
async function folder(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pgn-migrations-"));
  folders.push(dir);
  for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
  return dir;
}

const createSchema = (name: string) =>
  `export async function up(db) { await db.schema.createSchema("${name}").execute(); }`;

describe("migrate", () => {
  it("applies every migration once, in name order, as pgn_owner, recorded outside the public schema", async () => {
    const db = await empty();
    const names = (await readdir(MIGRATIONS)).filter((file) => MIGRATION_NAME.test(file)).sort();
    expect(names.length).toBeGreaterThan(0);
    expect(await migrate(db.migrator)).toEqual(names.map((file) => file.replace(/\.ts$/, "")));
    expect(await migrate(db.migrator)).toEqual([]);

    const su = await db.connect("postgres");
    const schemas = await su.query(
      `select nspname as name, pg_get_userbyid(nspowner) as owner from pg_namespace
       where nspname not like 'pg\\_%' and nspname not in ('information_schema', 'public') order by 1`,
    );
    expect(schemas.rows).toEqual(
      ["app", "identity", "migrations", "queue"].map((name) => ({ name, owner: "pgn_owner" })),
    );
    const tables = await su.query(
      `select schemaname || '.' || tablename as name, tableowner as owner from pg_tables
       where schemaname not in ('pg_catalog', 'information_schema') order by 1`,
    );
    expect(tables.rows.every((row) => row.owner === "pgn_owner")).toBe(true);
    expect(tables.rows.map((row) => row.name)).toContain("migrations.kysely_migration");
    expect(tables.rows.filter((row) => String(row.name).startsWith("public."))).toEqual([]);
  });

  it("names the migration that failed, and applies nothing of that run", async () => {
    const db = await empty();
    const planted = await folder({
      "2026_01_01_0001_good.ts": createSchema("planted"),
      "2026_01_01_0002_bad.ts": `export async function up(db) {
        await db.schema.createTable("nowhere.t").addColumn("x", "integer").execute();
      }`,
    });
    await expect(migrate(db.migrator, planted)).rejects.toThrow(
      'The migration 2026_01_01_0002_bad failed: schema "nowhere" does not exist',
    );
    const su = await db.connect("postgres");
    expect((await su.query("select 1 from pg_namespace where nspname = 'planted'")).rowCount).toBe(0);
    expect((await su.query("select name from migrations.kysely_migration")).rows).toEqual([]);
  });

  it("refuses a folder holding anything but migrations, before connecting", async () => {
    const db = await empty();
    const planted = await folder({
      "2026_01_01_0001_good.ts": createSchema("planted"),
      "notes.md": "not a migration",
      "2026_01_01_1_short.ts": createSchema("short"),
      ".DS_Store": "",
    });
    await expect(migrate({ ...db.migrator, password: "not-the-password" }, planted)).rejects.toThrow(
      "The migrations folder holds files that are not migrations: 2026_01_01_1_short.ts, notes.md.",
    );
  });

  it("refuses hidden files before connecting: Kysely would run a .ts one, and an AppleDouble ._ file breaks a run", async () => {
    const db = await empty();
    const good = { "2026_01_01_0001_good.ts": createSchema("planted") };
    const notTheMigrator = { ...db.migrator, password: "not-the-password" }; // never used: nothing connects
    const hidden = await folder({ ...good, ".backup_of_0001.ts": createSchema("planted_hidden") });
    await expect(migrate(notTheMigrator, hidden)).rejects.toThrow(
      "The migrations folder holds files that are not migrations: .backup_of_0001.ts.",
    );
    const appleDouble = await folder({ ...good, "._2026_01_01_0001_good.ts": "\u0000\u0005\u0016\u0007 binary" });
    await expect(migrate(notTheMigrator, appleDouble)).rejects.toThrow(
      "The migrations folder holds files that are not migrations: ._2026_01_01_0001_good.ts.",
    );
    // macOS's Finder file is the one exception, and Kysely never sees it
    const finder = await folder({ ...good, ".DS_Store": "" });
    expect(await migrate(db.migrator, finder)).toEqual(["2026_01_01_0001_good"]);
    const su = await db.connect("postgres");
    expect((await su.query("select nspname from pg_namespace where nspname like 'planted%'")).rows).toEqual([
      { nspname: "planted" },
    ]);
  });

  it("refuses a migration without an up function, and applies none", async () => {
    const db = await empty();
    const planted = await folder({
      "2026_01_01_0001_good.ts": createSchema("planted"),
      "2026_01_01_0002_typo.ts": "export async function upp(db) {}",
    });
    await expect(migrate(db.migrator, planted)).rejects.toThrow(
      "2026_01_01_0002_typo.ts is named as a migration but has no up().",
    );
    const su = await db.connect("postgres");
    expect((await su.query("select 1 from pg_namespace where nspname = 'planted'")).rowCount).toBe(0);
  });

  it("is forward only: it refuses to run once an applied migration is missing or a new one sorts before it", async () => {
    const db = await empty();
    const first = await folder({
      "2026_01_01_0001_a.ts": createSchema("planted_a"),
      "2026_01_01_0003_c.ts": createSchema("planted_c"),
    });
    expect(await migrate(db.migrator, first)).toEqual(["2026_01_01_0001_a", "2026_01_01_0003_c"]);
    const missing = await folder({ "2026_01_01_0003_c.ts": createSchema("planted_c") });
    await expect(migrate(db.migrator, missing)).rejects.toThrow("2026_01_01_0001_a");
    const before = await folder({
      "2026_01_01_0001_a.ts": createSchema("planted_a"),
      "2026_01_01_0002_b.ts": createSchema("planted_b"),
      "2026_01_01_0003_c.ts": createSchema("planted_c"),
    });
    await expect(migrate(db.migrator, before)).rejects.toThrow("2026_01_01_0002_b");
  });

  it("says plainly when it cannot sign in", async () => {
    const db = await empty();
    await expect(migrate({ ...db.migrator, password: "not-the-password" })).rejects.toThrow(
      'The migrations did not run: password authentication failed for user "pgn_migrator"',
    );
  });
});
