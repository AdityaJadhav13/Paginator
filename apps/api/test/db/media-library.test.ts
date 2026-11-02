// The media library (src/modules/media/library.ts; docs/product/10-l2-newsroom-plan.md §5.3, L2.2) on a migrated
// clone, through the API's own routes: who sees which pictures, the filters and pages, a picture's own facts on its
// revision, and its delete. One picture goes through an upload with purpose "library"; the rest are rows put in by the
// superuser, every one fictional.
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDatabase } from "./helpers.ts";
import { type IdentityApp, identityApp } from "./identity-app.ts";
import { type Org, type Person, newsroom } from "./newsroom.ts";
import { jpeg } from "../support/pictures.ts";

const db = await freshDatabase();
let it_: IdentityApp;
let su: Client;
const n = newsroom(
  () => it_,
  () => su,
);
const { call, change } = n;
let a: Org;
let other: Org;
let photo: Person;
let reporter: Person;
let reporter2: Person;
let viewer: Person;
let pages: string; // a publication of its own, for the pages

beforeAll(async () => {
  it_ = await identityApp(db);
  su = await db.connect("postgres");
  a = await n.organisation();
  other = await n.organisation();
  pages = await n.addPublication(a, "Library pages (fictional)");
  const on = (role: string, pub = a.pubId) => [{ publicationId: pub, roles: [role], grants: [] }];
  photo = await n.member(a, [...on("photo_editor"), ...on("photo_editor", pages)], "member", "photo");
  reporter = await n.member(a, on("reporter"), "member", "reporter");
  reporter2 = await n.member(a, on("reporter"), "member", "reporter");
  viewer = await n.member(a, on("viewer"), "member", "viewer");
}, 60_000);
afterAll(async () => {
  await it_.close();
  await db.drop();
});

const base = (pub = a.pubId, org = a.orgId) => `/api/v1/orgs/${org}/pubs/${pub}`;
const media = (query = "", pub = a.pubId) => `${base(pub)}/media${query}`;
const assetUrl = (id: string, pub = a.pubId) => `${base(pub)}/assets/${id}`;

type Facts = { caption?: string; credit?: string; photographer?: string; status?: string; problem?: string };
let seed = 0;
/** A picture row of publication `pub`, uploaded by `by`, as the upload would leave it. */
async function picture(by: string, facts: Facts = {}, pub = a.pubId, org = a.orgId): Promise<string> {
  seed += 1;
  const { rows } = await su.query<{ id: string }>(
    `insert into app.asset (org_id, publication_id, desk_key, sha256, bytes, mime, width_px, height_px, uploaded_by,
       caption, credit, photographer, status, problem)
     values ($1, $2::uuid, 'p-' || lpad(to_hex($3::int), 10, '0'), encode(sha256(($3::text || $2::text)::bytea), 'hex'), 1000,
       'image/jpeg', 1200, 800, $4, $5, $6, $7, $8, $9)
     returning id`,
    [
      org,
      pub,
      seed,
      by,
      facts.caption ?? "",
      facts.credit ?? "",
      facts.photographer ?? "",
      facts.status ?? "received",
      facts.problem ?? null,
    ],
  );
  return rows[0]?.id ?? "";
}

async function story(cookie: string) {
  const made = await change("POST", `${base()}/stories`, cookie, { headline: "A story (fictional)", body: "Short." });
  expect(made.statusCode, made.body).toBe(201);
  return made.json() as { id: string; revision: number };
}

async function attach(cookie: string, storyId: string, revision: number, assetId: string) {
  const res = await call("PUT", `${base()}/stories/${storyId}/photo`, cookie, { baseRevision: revision, assetId });
  expect(res.statusCode, res.body).toBe(200);
}

const ids = (res: { json: () => { items: { id: string }[] } }) => res.json().items.map((item) => item.id);

describe("an upload into the library", () => {
  it("makes a picture listed newest first, with its facts and no grid to judge it by", async () => {
    const file = jpeg(1200, 800, 0, 9001);
    const presigned = await change("POST", `${base()}/uploads`, photo.cookie, {
      purpose: "library",
      filename: "library.jpg",
      contentType: "image/jpeg",
      bytes: file.length,
    });
    expect(presigned.statusCode, presigned.body).toBe(201);
    const policy = presigned.json();
    const form = new FormData();
    for (const [name, value] of Object.entries(policy.fields as Record<string, string>)) form.append(name, value);
    form.append("file", new Blob([file]));
    expect((await fetch(policy.url, { method: "POST", body: form })).status).toBe(204);
    const done = await call("POST", `${base()}/uploads/${policy.uploadId}/complete`, photo.cookie);
    expect(done.statusCode, done.body).toBe(200);
    const id = done.json().asset.id;
    const { rows } = await su.query("select purpose from app.upload where id = $1", [policy.uploadId]);
    expect(rows).toEqual([{ purpose: "library" }]);

    const listed = await call("GET", media(), photo.cookie);
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json().items[0]).toMatchObject({
      id,
      status: "received",
      problem: null,
      mime: "image/jpeg",
      widthPx: 1200,
      heightPx: 800,
      caption: "",
      sharpUpToCols: null,
      uploadedBy: { id: photo.id },
      usedBy: [],
      revision: 1,
      previewUrl: null,
    });
  });
});

describe("pages and filters", () => {
  it("answers 60 a page, newest first, and the rest after the cursor", async () => {
    const pub = pages;
    const made: string[] = [];
    for (let i = 0; i < 65; i += 1) made.push(await picture(photo.id, {}, pub));
    const cookie = photo.cookie;
    const first = await call("GET", media("", pub), cookie);
    expect(first.statusCode, first.body).toBe(200);
    expect(ids(first)).toEqual([...made].reverse().slice(0, 60));
    const next = first.json().next;
    expect(typeof next).toBe("string");
    const second = await call("GET", media(`?cursor=${next}`, pub), cookie);
    expect([ids(second), second.json().next]).toEqual([[...made].reverse().slice(60), null]);
    expect((await call("GET", media("?cursor=nonsense", pub), cookie)).statusCode).toBe(400);
  });

  it("finds by caption, credit or photographer, a missing caption or credit, and a story's photo", async () => {
    const rain = await picture(photo.id, { caption: "Rain on the ghats, 100% wet", credit: "" });
    const fort = await picture(photo.id, { caption: "", credit: "Fort (fictional)", photographer: "A. Kulkarni" });
    const q = (query: string) => call("GET", media(query), photo.cookie).then(ids);
    expect(await q("?q=ghats")).toEqual([rain]);
    expect(await q("?q=kulkarni")).toEqual([fort]);
    expect(await q(`?q=${encodeURIComponent("100%")}`)).toEqual([rain]);
    expect(await q(`?q=${encodeURIComponent("_")}`)).toEqual([]); // a literal underscore, not "any one letter"
    expect(await q("?missing=caption")).toContain(fort);
    expect(await q("?missing=caption")).not.toContain(rain);
    expect(await q("?missing=credit")).toContain(rain);
    expect(await q("?missing=credit")).not.toContain(fort);
    const mine = await story(a.ownerCookie);
    await attach(photo.cookie, mine.id, mine.revision, fort);
    expect(await q(`?story=${mine.id}`)).toEqual([fort]);
    // no grid is stored, so no picture is known too small
    expect(await q("?tooSmallForCols=2")).toEqual([]);
    expect((await call("GET", media("?missing=place"), photo.cookie)).statusCode).toBe(400);
  });
});

describe("who sees which pictures", () => {
  it("shows a Reporter only theirs, their refused ones too; the desk every one", async () => {
    const theirs = await picture(reporter.id);
    const refusedTheirs = await picture(reporter.id, { status: "rejected", problem: "m.photo.small" });
    const someoneElses = await picture(photo.id);
    const refusedElses = await picture(photo.id, { status: "failed", problem: "worker.lost" });
    const onTheirStory = await picture(photo.id);
    const mine = await story(reporter.cookie);
    await attach(photo.cookie, mine.id, mine.revision, onTheirStory);

    const seen = await call("GET", media(), reporter.cookie).then(ids);
    expect(seen).toEqual(expect.arrayContaining([theirs, refusedTheirs, onTheirStory]));
    expect(seen).not.toContain(someoneElses);
    expect(seen).not.toContain(refusedElses);
    const one = await call("GET", assetUrl(refusedTheirs), reporter.cookie);
    expect([one.statusCode, one.json().problem, one.json().status]).toEqual([200, "m.photo.small", "rejected"]);
    expect((await call("GET", assetUrl(someoneElses), reporter.cookie)).statusCode).toBe(404);

    const desk = await call("GET", media(), photo.cookie).then(ids);
    expect(desk).toEqual(expect.arrayContaining([theirs, refusedTheirs, someoneElses, refusedElses, onTheirStory]));
    expect((await call("GET", assetUrl(refusedElses), viewer.cookie)).json().problem).toBe("worker.lost");
  });

  it("names in usedBy only the stories the person may see", async () => {
    const theirs = await picture(reporter.id);
    const elsewhere = await story(reporter2.cookie);
    await attach(photo.cookie, elsewhere.id, elsewhere.revision, theirs);
    const forReporter = await call("GET", assetUrl(theirs), reporter.cookie);
    // in use all the same (so not deletable), though the story is not theirs to see
    expect(forReporter.json()).toMatchObject({ usedBy: [], inUse: true, mayEdit: true });
    const forDesk = await call("GET", assetUrl(theirs), photo.cookie);
    expect(forDesk.json().usedBy).toEqual([{ storyId: elsewhere.id, headline: "A story (fictional)" }]);
    expect(forDesk.json()).toMatchObject({ inUse: true, mayEdit: true });
    expect((await call("GET", assetUrl(theirs), viewer.cookie)).json()).toMatchObject({ inUse: true, mayEdit: false });
    // ?story= a story they may not see: none, not which picture is its photo
    expect(await call("GET", media(`?story=${elsewhere.id}`), reporter.cookie).then(ids)).toEqual([]);
    expect(await call("GET", media(`?story=${elsewhere.id}`), photo.cookie).then(ids)).toEqual([theirs]);
    expect(await call("GET", media("?story=00000000-0000-4000-8000-000000000000"), photo.cookie).then(ids)).toEqual([]);
  });

  it("keeps another organisation out: not listed, not found, not changed", async () => {
    const ours = await picture(photo.id);
    const theirs = await call("GET", `${base(other.pubId, other.orgId)}/media`, other.ownerCookie);
    expect([theirs.statusCode, ids(theirs)]).toEqual([200, []]);
    expect(ids(await call("GET", media(), photo.cookie))).toContain(ours);
    // our publication, under their organisation's address or ours: never theirs to reach
    expect((await call("GET", `${base(a.pubId, other.orgId)}/assets/${ours}`, other.ownerCookie)).statusCode).toBe(404);
    expect((await call("GET", `${base(a.pubId, other.orgId)}/media`, other.ownerCookie)).statusCode).toBe(404);
    expect((await call("GET", assetUrl(ours), other.ownerCookie)).statusCode).toBe(404);
    const patch = await call("PATCH", assetUrl(ours), other.ownerCookie, { baseRevision: 1, caption: "x" });
    expect(patch.statusCode).toBe(404);
    // their own publication's address with our picture's id: no such picture there
    const crossed = await call("GET", `${base(other.pubId, other.orgId)}/assets/${ours}`, other.ownerCookie);
    expect(crossed.statusCode).toBe(404);
  });
});

describe("a picture's own facts", () => {
  it("are changed on the revision, cleaned and audited; a stale one answers 409 with the picture now", async () => {
    const id = await picture(photo.id);
    const saved = await call("PATCH", assetUrl(id), photo.cookie, {
      baseRevision: 1,
      caption: "  Rain on the ghats\u0007 ",
      photographer: "A. Kulkarni",
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({ caption: "Rain on the ghats", photographer: "A. Kulkarni", revision: 2 });
    const stale = await call("PATCH", assetUrl(id), photo.cookie, { baseRevision: 1, credit: "Late" });
    expect([stale.statusCode, stale.json().error.code]).toEqual([409, "asset_changed"]);
    expect(stale.json().error.current).toMatchObject({ id, revision: 2, caption: "Rain on the ghats", credit: "" });
    const { rows } = await su.query(
      "select data from app.audit_event where action = 'asset.edit' and target_id = $1 order by id",
      [id],
    );
    expect(rows).toEqual([{ data: { revision: 2, fields: ["caption", "photographer"] } }]);

    // nothing to change: refused; a change to what it already says: the picture as it is, no revision, no audit
    const empty = await call("PATCH", assetUrl(id), photo.cookie, { baseRevision: 2 });
    expect([empty.statusCode, empty.json().error.code]).toEqual([400, "invalid_request"]);
    const same = await call("PATCH", assetUrl(id), photo.cookie, { baseRevision: 2, caption: "Rain on the ghats " });
    expect([same.statusCode, same.json().revision]).toEqual([200, 2]);
    const staleSame = await call("PATCH", assetUrl(id), photo.cookie, {
      baseRevision: 1,
      caption: "Rain on the ghats",
    });
    expect(staleSame.statusCode).toBe(409);
    const after = await su.query(
      "select count(*)::int as n from app.audit_event where action = 'asset.edit' and target_id = $1",
      [id],
    );
    expect(after.rows).toEqual([{ n: 1 }]);
  });

  it("are a Reporter's to change only on a picture they uploaded; never a Viewer's", async () => {
    const theirs = await picture(reporter.id);
    const onTheirStory = await picture(photo.id);
    const mine = await story(reporter.cookie);
    await attach(photo.cookie, mine.id, mine.revision, onTheirStory);
    expect((await call("PATCH", assetUrl(theirs), reporter.cookie, { baseRevision: 1, credit: "Me" })).statusCode).toBe(
      200,
    );
    const notTheirs = await call("PATCH", assetUrl(onTheirStory), reporter.cookie, { baseRevision: 1, credit: "Me" });
    expect([notTheirs.statusCode, notTheirs.json().error.code]).toEqual([403, "not_allowed"]);
    expect((await call("GET", assetUrl(onTheirStory), reporter.cookie)).json().mayEdit).toBe(false);
    // the same picture uploaded again by the Reporter (deduplicated to it): theirs to change too
    const again = await picture(photo.id);
    await su.query(
      `insert into app.upload (org_id, publication_id, user_id, purpose, declared_type, declared_bytes, expires_at,
         status, completed_at, asset_id)
       values ($1, $2, $3, 'library', 'image/jpeg', 1000, now() + interval '1 hour', 'completed', now(), $4)`,
      [a.orgId, a.pubId, reporter.id, again],
    );
    expect((await call("GET", assetUrl(again), reporter.cookie)).json().mayEdit).toBe(true);
    expect((await call("PATCH", assetUrl(again), reporter.cookie, { baseRevision: 1, credit: "Me" })).statusCode).toBe(
      200,
    );
    expect((await call("GET", assetUrl(theirs), viewer.cookie)).statusCode).toBe(200);
    expect((await call("PATCH", assetUrl(theirs), viewer.cookie, { baseRevision: 2, credit: "V" })).statusCode).toBe(
      403,
    );
  });
});

describe("deleting a picture", () => {
  it("is refused while a story has it, and to a Reporter; stale answers 409; then it is gone and audited", async () => {
    const id = await picture(reporter.id);
    const used = await story(a.ownerCookie);
    await attach(photo.cookie, used.id, used.revision, id);
    const inUse = await call("DELETE", `${assetUrl(id)}?baseRevision=1`, photo.cookie);
    expect([inUse.statusCode, inUse.json().error.code]).toEqual([409, "asset_in_use"]);
    const off = await call(
      "DELETE",
      `${base()}/stories/${used.id}/photo?baseRevision=${used.revision + 1}`,
      photo.cookie,
    );
    expect(off.statusCode, off.body).toBe(200);

    expect((await call("DELETE", `${assetUrl(id)}?baseRevision=1`, reporter.cookie)).statusCode).toBe(403);
    expect((await call("DELETE", `${assetUrl(id)}?baseRevision=1`, viewer.cookie)).statusCode).toBe(403);
    const stale = await call("DELETE", `${assetUrl(id)}?baseRevision=7`, photo.cookie);
    expect([stale.statusCode, stale.json().error.code, stale.json().error.current.revision]).toEqual([
      409,
      "asset_changed",
      1,
    ]);
    expect((await call("DELETE", `${assetUrl(id)}?baseRevision=1`, photo.cookie)).statusCode).toBe(204);
    expect((await call("GET", assetUrl(id), photo.cookie)).statusCode).toBe(404);
    expect(await call("GET", media(), photo.cookie).then(ids)).not.toContain(id);
    expect((await call("GET", assetUrl(id), reporter.cookie)).statusCode).toBe(404);
    const again = await story(a.ownerCookie);
    const attachDeleted = await call("PUT", `${base()}/stories/${again.id}/photo`, photo.cookie, {
      baseRevision: again.revision,
      assetId: id,
    });
    expect(attachDeleted.statusCode).toBe(400);
    const { rows } = await su.query(
      "select data from app.audit_event where action = 'asset.delete' and target_id = $1",
      [id],
    );
    expect(rows).toEqual([{ data: { revision: 1 } }]);
  });
});
