// The point-in-time check (src/db/restore-drill.ts pointInTimeCheck; docs/runbooks/restore.md path A) on real
// databases: a copy of a seeded database, made at one moment, stands for RDS's restore to that moment, and the live
// database moves on after it. Every session is the superuser's here (the tests have no pgn_backup role).
import { type Client, escapeIdentifier } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { type DrillDeps, pointInTimeCheck } from "../../src/db/restore-drill.ts";
import { seed } from "./fixtures.ts";
import { type TestDatabase, freshDatabase } from "./helpers.ts";
import { connect } from "./settings.ts";

const ENV = {
  PGN_BACKUP_PASSWORD: "fictional-backup-password",
  PGN_S3_BACKUPS_BUCKET: "pgn-test-backups",
  PGN_S3_ACCESS_KEY_ID: "fictional-key",
  PGN_S3_SECRET_ACCESS_KEY: "fictional-secret",
  PGN_RESTORE_TARGET_HOST: "restored.example.test",
};

let live: TestDatabase;
let targetName: string;
let at: string;
const opened: Client[] = [];

const deps = {
  async connect(_database: string, as: string) {
    const client =
      as === "target" ? await connect(inject("database"), "postgres", targetName) : await live.connect("postgres");
    opened.push(client);
    return client;
  },
  backup: async () => "",
} as unknown as DrillDeps; // sessions with query and end

/** The check's lines, and whether it passed. */
async function check(): Promise<{ ok: boolean; lines: string[] }> {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  try {
    const ok = await pointInTimeCheck({ ...ENV, PGN_RESTORE_TIME: at }, deps);
    return { ok, lines: log.mock.calls.map((call) => String(call[0])) };
  } finally {
    log.mockRestore();
  }
}

async function onLive(text: string) {
  const su = await live.connect("postgres");
  await su.query(text);
}

beforeAll(async () => {
  live = await freshDatabase();
  const su = await live.connect("postgres");
  await seed(su);
  // history from well before the restore time: an event per organisation, and each story's revision closed
  await su.query(`insert into app.audit_event (org_id, actor_kind, action, target_type, at)
    select org_id, 'system', 'test.before', 'org', now() - interval '10 minutes' from app.org_settings`);
  await su.query(`update app.story_revision
    set opened_at = now() - interval '20 minutes', closed_at = now() - interval '10 minutes'`);
  await su.end();
  // the restore: a copy as the database is now (a template may have no session open)
  const run = inject("database");
  targetName = `${live.name}_pitr`;
  const admin = await connect(run, "postgres");
  try {
    at = new Date().toISOString();
    await admin.query(`create database ${escapeIdentifier(targetName)} template ${escapeIdentifier(live.name)}`);
  } finally {
    await admin.end();
  }
  // the live database moves on: a newer event
  await onLive(`insert into app.audit_event (org_id, actor_kind, action, target_type)
    select org_id, 'system', 'test.after', 'org' from app.org_settings`);
});

afterAll(async () => {
  await Promise.all(opened.map((client) => client.end().catch(() => undefined)));
  const admin = await connect(inject("database"), "postgres");
  try {
    await admin.query(`drop database if exists ${escapeIdentifier(targetName)} with (force)`);
  } finally {
    await admin.end();
  }
  await live?.drop();
});

describe("the point-in-time check", () => {
  it("passes a copy made at the restore time, though the live database moved on", async () => {
    const { ok, lines } = await check();
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^PASS migrations: \d+ applied, as live's first ones$/),
        expect.stringMatching(/^PASS row-level security policies: \d+ policies$/),
        expect.stringMatching(/^PASS RLS on and FORCE RLS: /),
        expect.stringMatching(/^PASS audit events to the restore time: 2 in the target, 2 live, /),
        expect.stringMatching(/^PASS nothing after the restore time: /),
        expect.stringMatching(/^PASS closed story revisions to the restore time: ([1-9]\d*) in the target, \1 live, /),
        "SKIP photos in the store: PGN_S3_WORK_BUCKET is not set",
      ]),
    );
    expect(ok).toBe(true);
  });

  it("fails when the target lacks an event live recorded before the restore time (a restore to an earlier time)", async () => {
    await onLive(`insert into app.audit_event (org_id, actor_kind, action, target_type, at)
      select org_id, 'system', 'test.lost', 'org', now() - interval '5 minutes' from app.org_settings limit 1`);
    const { ok, lines } = await check();
    expect(lines).toContainEqual(
      expect.stringMatching(/^FAIL audit events to the restore time: 2 in the target, 3 live/),
    );
    expect(ok).toBe(false);
  });

  it("fails a target with an event after the restore time, and says how many migrations a target behind has to apply", async () => {
    const target = await connect(inject("database"), "postgres", targetName);
    try {
      await target.query(`insert into app.audit_event (org_id, actor_kind, action, target_type, at)
        select org_id, 'system', 'test.later', 'org', now() + interval '10 minutes' from app.org_settings limit 1`);
      await target.query(`delete from migrations.kysely_migration
        where name = (select max(name) from migrations.kysely_migration)`);
    } finally {
      await target.end();
    }
    const { lines } = await check();
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^FAIL nothing after the restore time: .*, \d+ s after /),
        expect.stringMatching(/^PASS migrations: \d+ applied, as live's first ones; 1 to apply/),
        "SKIP row-level security policies: the migrations differ from live's: check again after them",
      ]),
    );
  });

  it("refuses a restore time without its zone, or later than now", async () => {
    for (const time of ["2026-11-05T16:30:00", "2999-01-01T00:00:00Z"]) {
      await expect(pointInTimeCheck({ ...ENV, PGN_RESTORE_TIME: time }, deps)).rejects.toThrow(/PGN_RESTORE_TIME/);
    }
  });
});
