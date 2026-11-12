// The Newsroom board's reads of the stories list (src/modules/stories): ?edition=none (stories in no edition), and the
// list item's photo (the board's flags) and can (its moves, the same rules as the story's own). Fictional data only.
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDatabase } from "./helpers.ts";
import { type IdentityApp, identityApp } from "./identity-app.ts";
import { type Org, type Person, newsroom } from "./newsroom.ts";

const db = await freshDatabase();
let it_: IdentityApp;
let su: Client;
const n = newsroom(
  () => it_,
  () => su,
);
let org: Org;
let editor: Person;
let reporter: Person;

beforeAll(async () => {
  it_ = await identityApp(db, { PGN_LOG_LEVEL: "silent" });
  su = await db.connect("postgres");
  org = await n.organisation();
  const on = (role: string) => [{ publicationId: org.pubId, roles: [role], grants: [] }];
  editor = await n.member(org, on("editor"), "member", "editor");
  reporter = await n.member(org, on("reporter"), "member", "reporter");
}, 120_000);
afterAll(async () => {
  await it_.close();
  await db.drop();
});

const stories = () => `/api/v1/orgs/${org.orgId}/pubs/${org.pubId}/stories`;

describe("the board's list", () => {
  it("lists the stories in no edition, and each item's photo and moves", async () => {
    const { rows } = await su.query<{ id: string }>(
      `insert into app.edition (org_id, publication_id, edition_date, desk_key, pages)
       values ($1, $2, '2026-12-07', '2026-12-07', 8) returning id`,
      [org.orgId, org.pubId],
    );
    const editionId = rows[0]!.id;
    const loose = (await n.change("POST", stories(), reporter.cookie, { headline: "In no edition" })).json();
    const placed = (await n.change("POST", stories(), editor.cookie, { headline: "In the edition", editionId })).json();

    const none = (await n.call("GET", `${stories()}?edition=none`, editor.cookie)).json();
    expect(none.items.map((s: { id: string }) => s.id)).toEqual([loose.id]);
    expect(none.items[0]).toMatchObject({ photo: null, can: { transitions: ["held", "spiked"] } });
    const inIt = (await n.call("GET", `${stories()}?edition=${editionId}`, editor.cookie)).json();
    expect(inIt.items.map((s: { id: string }) => s.id)).toEqual([placed.id]);
    const all = (await n.call("GET", stories(), editor.cookie)).json();
    expect(all.items).toHaveLength(2);

    // the reporter's own list: their story, their one move
    const own = (await n.call("GET", `${stories()}?edition=none`, reporter.cookie)).json();
    expect(own.items[0]).toMatchObject({ id: loose.id, can: { edit: true, transitions: ["filed"] } });
    expect((await n.call("GET", `${stories()}?edition=nothing`, editor.cookie)).statusCode).toBe(400);
  });
});
