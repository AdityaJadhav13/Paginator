// The restore drill's count comparison (src/db/restore-drill.ts): the restored count lies between the live counts
// read before and after the dump.
import { describe, expect, it, vi } from "vitest";
import {
  type DrillDeps,
  compareCounts,
  restoreDrill,
  restoreName,
  withRestoreDatabase,
} from "../../src/db/restore-drill.ts";

describe("compareCounts", () => {
  it("passes equal counts, and a count between a write before and after the dump", () => {
    expect(compareCounts({ "app.story": 2 }, { "app.story": 2 }, { "app.story": 2 })).toEqual([]);
    expect(compareCounts({ "app.story": 2 }, { "app.story": 3 }, { "app.story": 4 })).toEqual([]);
  });

  it("fails a count outside the live ones, and a table missing on one side", () => {
    expect(compareCounts({ "app.story": 2 }, { "app.story": 1 }, { "app.story": 2 })).toEqual([
      "app.story: 1 restored, live 2..2",
    ]);
    expect(
      compareCounts({ "app.story": 2, "app.asset": 1 }, { "app.story": 2 }, { "app.story": 2, "app.asset": 1 }),
    ).toEqual(["app.asset: not in every database"]);
  });
});

const ENV = {
  PGN_BACKUP_PASSWORD: "fictional-backup-password",
  PGN_S3_BACKUPS_BUCKET: "pgn-test-backups",
  PGN_S3_ACCESS_KEY_ID: "fictional-key",
  PGN_S3_SECRET_ACCESS_KEY: "fictional-secret",
  PGN_RESTORE_ADMIN_PASSWORD: "fictional-admin-password",
};

/** A session that answers every query with no rows, and notes what it was asked and whether it was closed. */
function session(log: string[], who: string, fail?: RegExp) {
  return {
    query: vi.fn(async (text: string) => {
      log.push(`${who}: ${text}`);
      if (fail?.test(text)) throw new Error(`database "x" already exists`);
      return { rows: [] };
    }),
    end: vi.fn(async () => void log.push(`${who}: end`)),
  };
}

describe("the restored database", () => {
  it("has a name of its own each time: the time and a random part", () => {
    const now = new Date("2026-11-02T03:04:05Z");
    expect(restoreName("pageinator", now, "0a1b2c3d")).toBe("pageinator_restore_20261102030405_0a1b2c3d");
    expect(restoreName("pageinator", now)).not.toBe(restoreName("pageinator", now));
  });

  it("is never dropped when its name existed already (the create failed): only what the drill made is dropped", async () => {
    const log: string[] = [];
    const admin = session(log, "admin", /^create database/);
    const fn = vi.fn(async () => undefined);
    await expect(withRestoreDatabase(admin, "pageinator_restore_x", false, fn)).rejects.toThrow(/already exists/);
    expect(fn).not.toHaveBeenCalled();
    expect(log.filter((line) => line.includes("drop database"))).toEqual([]);
  });

  it("is dropped after the checks, also when they throw, and kept when asked", async () => {
    const log: string[] = [];
    const admin = session(log, "admin");
    await expect(
      withRestoreDatabase(admin, "r", false, async () => {
        throw new Error("a check broke");
      }),
    ).rejects.toThrow("a check broke");
    expect(log.at(-1)).toBe('admin: drop database if exists "r" with (force)');
    const kept: string[] = [];
    await withRestoreDatabase(session(kept, "admin"), "r", true, async () => undefined);
    expect(kept.some((line) => line.includes("drop database"))).toBe(false);
  });
});

describe("a failed backup", () => {
  it("closes the live session and stops at once, before any database is made", async () => {
    const log: string[] = [];
    const connect = vi.fn(async (database: string, as: "backup" | "admin") => session(log, `${as}@${database}`));
    const started = Date.now();
    await expect(
      restoreDrill(ENV, {
        connect: connect as unknown as DrillDeps["connect"], // a session with query and end only
        backup: async () => {
          throw new Error("node exited with 1");
        },
      }),
    ).rejects.toThrow("node exited with 1");
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(connect.mock.calls).toEqual([["pageinator", "backup"]]);
    expect(log.at(-1)).toBe("backup@pageinator: end");
  });
});
