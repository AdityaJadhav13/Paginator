// The content tables' own rules (migrations 2026_11_20_0001 and 0002): a revision's history cannot be forged, rows name
// only their own organisation's and publication's rows, unique keys and ids reveal nothing across a wall, a bundle's
// key and revisions are its own, the Desk's limits, each idempotency key is its user's, and an edition's date reads as
// its text. The walls themselves are the tenancy tests'.
import { sql } from "kysely";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/pools.ts";
import { ORG_A, ORG_B, childId, insert, seed } from "./fixtures.ts";
import { freshDatabase } from "./helpers.ts";

const db = await freshDatabase();
let su: Client;
let app: Client;
afterAll(() => db.drop());
beforeAll(async () => {
  su = await db.connect("postgres");
  app = await db.connect("app");
  await seed(su);
});

const [VARTA, EXPRESS] = ORG_A.pubs;
const EXPRESS_PUB = EXPRESS ?? VARTA;
const STORY = childId(VARTA, 3);
const inVarta = { org_id: ORG_A.id, publication_id: VARTA.id };

/** Runs text as pgn_app inside a context (as withTenant sets it), then rolls back. */
async function as(text: string, values: unknown[] = [], user = ORG_A.user, pubs = ORG_A.pubs.map((p) => p.id)) {
  await app.query("begin");
  try {
    await app.query(
      "select set_config('app.org_id', $1, true), set_config('app.user_id', $2, true), " +
        "set_config('app.pub_ids', $3, true)",
      [ORG_A.id, user, `{${pubs.join(",")}}`],
    );
    return await app.query(text, values);
  } finally {
    await app.query("rollback");
  }
}

/** The statement fails with this message, inside the superuser's transaction (which goes on: a savepoint). */
async function refused(statement: () => Promise<unknown>, message: string) {
  await su.query("savepoint refused");
  await expect(statement()).rejects.toThrow(message);
  await su.query("rollback to savepoint refused");
}

/** What a statement as pgn_app did: "ok", or its error's code and message (never its detail, which names values). */
async function outcomeAs(text: string, values: unknown[], pubs?: string[]): Promise<string> {
  try {
    await as(text, values, ORG_A.user, pubs);
    return "ok";
  } catch (error) {
    const { code, message } = error as { code?: string; message?: string };
    return `${code}: ${message}`;
  }
}

/** Runs fn as the superuser in a transaction that is rolled back. */
async function undone(fn: () => Promise<unknown>) {
  await su.query("begin");
  try {
    await fn();
  } finally {
    await su.query("rollback");
  }
}

describe("app.story_revision", () => {
  it("takes changes while open, and closes", async () => {
    const updated = await as(
      "update app.story_revision set body = 'दुसरा परिच्छेद.', closed_at = now() where story_id = $1 returning rev",
      [STORY],
    );
    expect(updated.rows).toEqual([{ rev: 1 }]);
  });

  it("refuses UPDATE, DELETE and TRUNCATE of a closed revision, even to the superuser", async () => {
    await undone(async () => {
      await su.query("update app.story_revision set closed_at = now() where story_id = $1", [STORY]);
      for (const statement of [
        "update app.story_revision set body = 'x'",
        "update app.story_revision set closed_at = null",
        "delete from app.story_revision",
      ]) {
        await su.query("savepoint s");
        const op = statement.split(" ")[0]?.toUpperCase();
        await expect(su.query(statement), statement).rejects.toThrow(
          `app.story_revision: revision 1 of story ${STORY} is closed, so ${op} is not allowed`,
        );
        await su.query("rollback to savepoint s");
      }
      // a bundle's revisions refer to it, so a plain TRUNCATE is refused by that key; with CASCADE, by the trigger
      await refused(
        () => su.query("truncate app.story_revision"),
        "cannot truncate a table referenced in a foreign key",
      );
      await expect(su.query("truncate app.story_revision cascade")).rejects.toThrow(
        "app.story_revision keeps its closed revisions: TRUNCATE is not allowed",
      );
    });
  });

  it("pgn_app may never delete a revision", async () => {
    await expect(as("delete from app.story_revision")).rejects.toThrow("permission denied for table story_revision");
  });

  it("has at most one open revision per story", async () => {
    const second = { ...inVarta, story_id: STORY, rev: 2, author_id: ORG_A.user };
    await expect(insert(su, "story_revision", second)).rejects.toThrow("story_revision_one_open");
    await undone(async () => {
      await su.query("update app.story_revision set closed_at = now() where story_id = $1", [STORY]);
      await insert(su, "story_revision", second);
    });
  });

  it("counts the Desk's limits in characters, as the Desk does", async () => {
    const at = { ...inVarta, story_id: STORY, rev: 2, author_id: ORG_A.user };
    await undone(async () => {
      await su.query("update app.story_revision set closed_at = now() where story_id = $1", [STORY]);
      await insert(su, "story_revision", { ...at, headline: "😀".repeat(2000) });
      await refused(
        () => insert(su, "story_revision", { ...at, rev: 3, headline: "😀".repeat(2001) }),
        "story_revision_headline_check",
      );
      await refused(
        () => insert(su, "story_revision", { ...at, rev: 3, body_format: "html" }),
        "story_revision_body_format_check",
      );
    });
  });

  it("cannot be forged: a new revision is open and the next, and its keys never change", async () => {
    // a story of its own, which no bundle holds (a bundle's key on a revision would refuse a renumbering first)
    const own = childId(VARTA, 10);
    await insert(su, "story", {
      ...inVarta,
      id: own,
      desk_key: "a-00000000bb",
      reporter_id: ORG_A.user,
      language: "mr",
    });
    await insert(su, "story_revision", { ...inVarta, story_id: own, rev: 1, author_id: ORG_A.user });
    const empty = childId(VARTA, 12); // a story with no revision yet
    await insert(su, "story", {
      ...inVarta,
      id: empty,
      desk_key: "a-00000000dd",
      reporter_id: ORG_A.user,
      language: "mr",
    });
    const add =
      "insert into app.story_revision (org_id, publication_id, story_id, rev, author_id, closed_at) " +
      "values ($1, $2, $3, $4, $5, $6)";
    const row = (rev: number, closed: Date | null) => [ORG_A.id, VARTA.id, own, rev, ORG_A.user, closed];
    await expect(as(add, row(2, new Date()))).rejects.toThrow("a new revision is open");
    await expect(as(add, row(7, null))).rejects.toThrow(`the next revision of story ${own} is 2, not 7`);
    await expect(as(add, row(1, null))).rejects.toThrow(`the next revision of story ${own} is 2, not 1`);
    await expect(as("update app.story_revision set rev = 42 where story_id = $1", [own])).rejects.toThrow(
      "a revision keeps its story and its number",
    );
    await expect(as("update app.story_revision set story_id = $1 where story_id = $2", [empty, own])).rejects.toThrow(
      "a revision keeps its story and its number",
    );
    await undone(async () => {
      await su.query("update app.story_revision set closed_at = now() where story_id = $1", [own]);
      await insert(su, "story_revision", { ...inVarta, story_id: own, rev: 2, author_id: ORG_A.user }); // allowed
    });
  });
});

describe("unique keys and ids tell nothing across a wall", () => {
  it("a user of one publication gets the same refusal for another's story, whatever it holds", async () => {
    const bare = { org_id: ORG_A.id, publication_id: EXPRESS_PUB.id, id: childId(EXPRESS_PUB, 11) };
    await insert(su, "story", { ...bare, desk_key: "a-00000000cc", reporter_id: ORG_A.user, language: "en" });
    const full = childId(EXPRESS_PUB, 3); // has an open revision and a photo
    const onlyVarta = [VARTA.id];
    const revision =
      "insert into app.story_revision (org_id, publication_id, story_id, rev, author_id) values ($1, $2, $3, 1, $4)";
    const photo = "insert into app.story_photo (org_id, publication_id, story_id, asset_id) values ($1, $2, $3, $4)";
    for (const [text, last] of [
      [revision, ORG_A.user],
      [photo, childId(VARTA, 5)],
    ] as const) {
      const withRows = await outcomeAs(text, [ORG_A.id, VARTA.id, full, last], onlyVarta);
      const without = await outcomeAs(text, [ORG_A.id, VARTA.id, bare.id, last], onlyVarta);
      expect(withRows).toMatch(/^23503: .*violates foreign key constraint/);
      expect(without).toBe(withRows);
    }
  });

  it("an id pgn_app sends is replaced by the database's own", async () => {
    const theirs = childId(ORG_B.pubs[0], 1); // org B's section
    const result = await as(
      "insert into app.section (id, org_id, publication_id, name) values ($1, $2, $3, 'x') returning id",
      [theirs, ORG_A.id, VARTA.id],
    );
    const made = (result.rows[0] as { id: string }).id;
    expect(made).not.toBe(theirs);
    expect(made).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/); // a uuidv7
  });
});

describe("rows name only their own organisation's and publication's rows", () => {
  it("a story cannot name another organisation's edition, section or person", async () => {
    const story = { ...inVarta, desk_key: "a-00000000ff", reporter_id: ORG_A.user, language: "mr" };
    await expect(insert(su, "story", { ...story, edition_id: childId(ORG_B.pubs[0], 2) })).rejects.toThrow(
      "story_org_id_publication_id_edition_id_fkey",
    );
    await expect(insert(su, "story", { ...story, section_id: childId(EXPRESS_PUB, 1) })).rejects.toThrow(
      "story_org_id_publication_id_section_id_fkey",
    );
    await expect(insert(su, "story", { ...story, reporter_id: ORG_B.user })).rejects.toThrow(
      "story_org_id_reporter_id_fkey",
    );
  });

  it("a revision, a photo and a status change cannot name another publication's story", async () => {
    const other = { org_id: ORG_A.id, publication_id: EXPRESS_PUB.id, story_id: STORY };
    await expect(insert(su, "story_revision", { ...other, rev: 1, author_id: ORG_A.user })).rejects.toThrow(
      "story_revision_org_id_publication_id_story_id_fkey",
    );
    await undone(async () => {
      await su.query("delete from app.story_photo where story_id = $1", [STORY]); // its one photo
      await refused(
        () => insert(su, "story_photo", { ...other, asset_id: childId(VARTA, 5) }),
        "story_photo_org_id_publication_id_story_id_fkey",
      );
    });
    const change = { ...other, from_status: "filed", to_status: "ready", changed_by: ORG_A.user };
    await expect(insert(su, "story_status_change", change)).rejects.toThrow(
      "story_status_change_org_id_publication_id_story_id_fkey",
    );
  });

  it("a reply is on its parent's story", async () => {
    await undone(async () => {
      const story = { ...inVarta, id: childId(VARTA, 7), desk_key: "a-00000000aa", reporter_id: ORG_A.user };
      await insert(su, "story", { ...story, language: "mr" });
      const reply = { ...inVarta, author_id: ORG_A.user, body: "A reply (fictional).", parent_id: childId(VARTA, 4) };
      await insert(su, "comment", { ...reply, target_id: STORY });
      await expect(insert(su, "comment", { ...reply, target_id: story.id })).rejects.toThrow(
        "comment_org_id_publication_id_target_id_parent_id_fkey",
      );
    });
  });

  it("a bundle's key is exactly its own folder's, and unique", async () => {
    const bundle = { ...inVarta, edition_id: childId(VARTA, 2), sha256: "0".repeat(64), created_by: ORG_A.user };
    const object = "01900000-0000-7000-8000-0000000000d1";
    const folder = (org: string, pub: string) => `orgs/${org}/pubs/${pub}/desk-bundles/`;
    const own = folder(ORG_A.id, VARTA.id);
    for (const key of [
      folder(ORG_B.id, VARTA.id) + `${object}.zip`,
      folder(ORG_A.id, EXPRESS_PUB.id) + `${object}.zip`,
      own,
      `${own}../../../../${ORG_B.id}/pubs/${ORG_B.pubs[0].id}/desk-bundles/${object}.zip`,
      `${own}./${object}.zip`,
      `${own}/${object}.zip`,
      `${own}${object}.zip/`,
      `${own}${object}.ZIP`,
      `${own}${object.toUpperCase()}.zip`,
      `${own}${object}.zip\n`,
    ]) {
      await expect(insert(su, "desk_bundle", { ...bundle, key }), key).rejects.toThrow("desk_bundle_key_check");
    }
    await undone(async () => {
      await insert(su, "desk_bundle", { ...bundle, key: `${own}${object}.zip` });
      await refused(
        () => insert(su, "desk_bundle", { ...bundle, key: `${own}${object}.zip` }),
        "desk_bundle_org_id_key_key",
      );
    });
  });

  it("a bundle holds only revisions of its own publication", async () => {
    const held = { ...inVarta, bundle_id: childId(VARTA, 6), rev: 1 };
    const revisionKey = "desk_bundle_revision_org_id_publication_id_story_id_rev_fkey";
    await undone(async () => {
      await su.query("delete from app.desk_bundle_revision"); // the fixture's own row
      await refused(
        () => insert(su, "desk_bundle_revision", { ...held, story_id: childId(EXPRESS_PUB, 3) }),
        revisionKey,
      );
      await refused(
        () => insert(su, "desk_bundle_revision", { ...held, story_id: childId(ORG_B.pubs[0], 3) }),
        revisionKey,
      );
      await refused(() => insert(su, "desk_bundle_revision", { ...held, story_id: STORY, rev: 2 }), revisionKey);
      await refused(
        () => insert(su, "desk_bundle_revision", { ...held, bundle_id: childId(EXPRESS_PUB, 6), story_id: STORY }),
        "desk_bundle_revision_org_id_publication_id_bundle_id_fkey",
      );
      await insert(su, "desk_bundle_revision", { ...held, story_id: STORY }); // its own: allowed
    });
  });
});

describe("app.edition", () => {
  const edition = { ...inVarta, pages: 8 };

  it("has 4, 8 or 16 pages, one per day, and the Desk's id for its date", async () => {
    await expect(
      insert(su, "edition", { ...edition, edition_date: "2026-10-22", desk_key: "2026-10-22", pages: 6 }),
    ).rejects.toThrow("edition_pages_check");
    await expect(
      insert(su, "edition", { ...edition, edition_date: "2026-10-21", desk_key: "2026-10-21-2" }),
    ).rejects.toThrow("edition_org_id_publication_id_edition_date_key");
    await expect(
      insert(su, "edition", { ...edition, edition_date: "2026-10-22", desk_key: "2026-10-23" }),
    ).rejects.toThrow("edition_desk_key_check");
    await undone(() => insert(su, "edition", { ...edition, edition_date: "2026-10-22", desk_key: "2026-10-22-2" }));
  });

  it("is dated between 2000 and 2999", async () => {
    for (const [date, key] of [
      ["1999-12-31", "1999-12-31"],
      ["3000-01-01", "3000-01-01"],
      ["2026-10-22 BC", "2026-10-22"],
    ]) {
      await expect(insert(su, "edition", { ...edition, edition_date: date, desk_key: key }), date).rejects.toThrow(
        "edition_edition_date_check",
      );
    }
  });

  it("reads as ISO through the API's pool whatever the database's DateStyle, and never as anything else", async () => {
    await su.query(`alter database "${db.name}" set datestyle = 'SQL, DMY'`);
    const database = openDatabase(db.settings);
    try {
      const tenant = { orgId: ORG_A.id, userId: ORG_A.user, pubIds: [VARTA.id], requestId: "content-test" };
      const dates = await database.withTenant(tenant, (tx) =>
        tx.selectFrom("app.edition").select("edition_date").execute(),
      );
      expect(dates).toEqual([{ edition_date: "2026-10-21" }]);
      await expect(
        database.withTenant(tenant, async (tx) => {
          await sql`set local datestyle = 'SQL, DMY'`.execute(tx);
          return tx.selectFrom("app.edition").select("edition_date").execute();
        }),
      ).rejects.toThrow('A date came back as "21/10/2026", not YYYY-MM-DD');
    } finally {
      await database.close();
      await su.query(`alter database "${db.name}" reset datestyle`);
    }
  });

  it("reads its date as the date's text through the API's pool", async () => {
    const database = openDatabase(db.settings);
    try {
      const tenant = { orgId: ORG_A.id, userId: ORG_A.user, pubIds: [VARTA.id], requestId: "content-test" };
      const rows = await database.withTenant(tenant, (tx) =>
        tx.selectFrom("app.edition").select(["edition_date", "desk_key"]).execute(),
      );
      expect(rows).toEqual([{ edition_date: "2026-10-21", desk_key: "2026-10-21" }]);
    } finally {
      await database.close();
    }
  });
});

describe("app.idempotency_key", () => {
  const OTHER = childId(VARTA, 8); // a second person of ORG_A

  it("is its own user's only, within the organisation too", async () => {
    await insert(su, "person", { org_id: ORG_A.id, user_id: OTHER, display_name: "Desk Editor (fictional)" });
    expect((await as("select count(*)::int as n from app.idempotency_key")).rows).toEqual([{ n: 1 }]);
    expect((await as("select count(*)::int as n from app.idempotency_key", [], OTHER)).rows).toEqual([{ n: 0 }]);
    const row = [ORG_A.id, ORG_A.user, "01900000-0000-7000-8000-0000000000c2", "x", "0".repeat(64)];
    const text =
      "insert into app.idempotency_key (org_id, user_id, key, route, request_sha256) values ($1, $2, $3, $4, $5)";
    await expect(as(text, row, OTHER)).rejects.toThrow("new row violates row-level security policy");
    await expect(as(text, row)).resolves.toMatchObject({ rowCount: 1 });
  });

  it("holds an answer exactly when done", async () => {
    const key = { org_id: ORG_A.id, user_id: ORG_A.user, route: "x", request_sha256: "0".repeat(64) };
    await expect(
      insert(su, "idempotency_key", { ...key, key: "01900000-0000-7000-8000-0000000000c3", status: "done" }),
    ).rejects.toThrow("idempotency_key_check");
    await expect(
      insert(su, "idempotency_key", { ...key, key: "01900000-0000-7000-8000-0000000000c4", response_status: 201 }),
    ).rejects.toThrow("idempotency_key_check");
  });
});
