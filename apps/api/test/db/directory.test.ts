// The first tables' own rules (migration 2026_11_01_0002): the audit log only grows, a row cannot point at another
// organisation's publication, and the checks on publications and people. The walls themselves are the tenancy tests'.
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ORG_A, ORG_B, insert, seed } from "./fixtures.ts";
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

/** Runs text as pgn_app inside ORG_A's context (as withTenant sets it), then rolls back. */
async function asA(text: string, values: unknown[] = []) {
  await app.query("begin");
  try {
    await app.query(
      "select set_config('app.org_id', $1, true), set_config('app.user_id', $2, true), set_config('app.pub_ids', $3, true)",
      [ORG_A.id, ORG_A.user, `{${ORG_A.pubs.map((pub) => pub.id).join(",")}}`],
    );
    return await app.query(text, values);
  } finally {
    await app.query("rollback");
  }
}

describe("app.audit_event", () => {
  it("pgn_app may add and read events, but never change or delete one", async () => {
    await expect(asA("select count(*)::int as n from app.audit_event")).resolves.toMatchObject({ rows: [{ n: 1 }] });
    await expect(asA("update app.audit_event set action = 'test.changed'")).rejects.toThrow(
      "permission denied for table audit_event",
    );
    await expect(asA("delete from app.audit_event")).rejects.toThrow("permission denied for table audit_event");
  });

  it("refuses UPDATE, DELETE and TRUNCATE even to the superuser", async () => {
    for (const statement of [
      "update app.audit_event set action = 'test.changed'",
      "delete from app.audit_event",
      "truncate app.audit_event",
    ]) {
      const op = statement.split(" ")[0]?.toUpperCase();
      await expect(su.query(statement), statement).rejects.toThrow(
        `app.audit_event is append-only: ${op} is not allowed`,
      );
    }
    expect((await su.query("select count(*)::int as n from app.audit_event")).rows).toEqual([{ n: 2 }]);
  });

  it("cannot name another organisation's publication, whoever writes it", async () => {
    const event = { org_id: ORG_A.id, publication_id: ORG_B.pubs[0].id, actor_kind: "system", action: "test.cross" };
    await expect(insert(su, "audit_event", { ...event, target_type: "publication" })).rejects.toThrow(
      'violates foreign key constraint "audit_event_org_id_publication_id_fkey"',
    );
  });

  it("holds only well-formed actions and object data", async () => {
    const event = { org_id: ORG_A.id, actor_kind: "user", target_type: "story" };
    await expect(insert(su, "audit_event", { ...event, action: "Story Saved" })).rejects.toThrow(
      "audit_event_action_check",
    );
    await expect(insert(su, "audit_event", { ...event, action: "story" })).rejects.toThrow("audit_event_action_check");
    await expect(insert(su, "audit_event", { ...event, action: "story.saved", data: "[1]" })).rejects.toThrow(
      "audit_event_data_check",
    );
    await expect(insert(su, "audit_event", { ...event, action: "story.status_changed" })).resolves.toBeUndefined();
  });
});

describe("app.publication and app.person", () => {
  it("a publication's primary language is one of its languages, and its slug is plain", async () => {
    const pub = { org_id: ORG_A.id, name: "x", digit_style: "latin" };
    await expect(
      insert(su, "publication", { ...pub, slug: "x-1", languages: ["mr"], primary_language: "en" }),
    ).rejects.toThrow("publication_check");
    await expect(
      insert(su, "publication", { ...pub, slug: "Kalpaniknagar Express", languages: ["en"], primary_language: "en" }),
    ).rejects.toThrow("publication_slug_check");
    await expect(
      insert(su, "publication", { ...pub, slug: ORG_A.pubs[0].slug, languages: ["en"], primary_language: "en" }),
    ).rejects.toThrow("publication_org_id_slug_key");
  });

  it("a person is removed exactly when removed_at is set", async () => {
    const person = { org_id: ORG_A.id, user_id: ORG_B.user, display_name: "Desk Editor (fictional)" };
    await expect(insert(su, "person", { ...person, status: "removed" })).rejects.toThrow("person_check");
    await expect(insert(su, "person", { ...person, removed_at: new Date() })).rejects.toThrow("person_check");
  });

  it("every row belongs to an organisation that exists", async () => {
    const stranger = "01900000-0000-7000-8000-00000000000c";
    await expect(insert(su, "person", { org_id: stranger, user_id: ORG_A.user, display_name: "x" })).rejects.toThrow(
      "person_org_id_fkey",
    );
  });
});
