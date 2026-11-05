// The archive's routes (packages/contracts/src/archive.ts) on a migrated clone: fictional released editions made as the
// superuser (an edition, its done run with page 1's thumbnail, the stories it placed, releases with their files), then
// read through the API: newest edition first with files and the thumbnail flag, the year, month and kind filters, the
// search by headline, reporter and section (a % taken literally), a release still being written left out, a release's
// view with its edition's releases, and another organisation's never seen. Every name is fictional.
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
let a: Org;
let b: Org;
let reporter: Person;
let reporterName = "";
const SHA = "f".repeat(64);
const releases = new Map<string, string>(); // "<date>#<number>" → id
const pubPath = (org: Org) => `/api/v1/orgs/${org.orgId}/pubs/${org.pubId}`;

/** An edition of `date` laid out by one done run (page 1 with a thumbnail when asked), placing these stories. */
async function edition(
  org: Org,
  date: string,
  stories: { key: string; headline: string; section?: string }[],
  thumb = true,
) {
  const owner = await n.userId(org.owner);
  const e = await su.query<{ id: string }>(
    `insert into app.edition (org_id, publication_id, edition_date, desk_key, pages, back_page_ads, issue)
     values ($1, $2, $3::date, $3::text, 4, false, '1') returning id`,
    [org.orgId, org.pubId, date],
  );
  const editionId = e.rows[0]?.id ?? "";
  const r = await su.query<{ id: string }>(
    `insert into app.layout_run (org_id, publication_id, edition_id, desk_key, state, finished_at, created_by)
     values ($1, $2, $3, $4, 'done', now(), $5) returning id`,
    [org.orgId, org.pubId, editionId, `r-${date.replaceAll("-", "")}-101500`, owner],
  );
  const runId = r.rows[0]?.id ?? "";
  const stored = JSON.stringify({ key: "orgs/x/thumb.png", version_id: "v1", sha256: SHA, bytes: 10 });
  for (const page of [1, 2]) {
    await su.query(
      `insert into app.run_page (org_id, publication_id, run_id, page_no, role, state, articles, thumb)
       values ($1, $2, $3, $4, $5, 'done', $6, $7)`,
      [
        org.orgId,
        org.pubId,
        runId,
        page,
        page === 1 ? "front" : "back",
        JSON.stringify(page === 1 ? stories.map((s) => s.key) : []),
        page === 1 && thumb ? stored : null,
      ],
    );
  }
  for (const story of stories) {
    const section = story.section
      ? (
          await su.query<{ id: string }>(
            `insert into app.section (org_id, publication_id, name) values ($1, $2, $3) returning id`,
            [org.orgId, org.pubId, story.section],
          )
        ).rows[0]?.id
      : null;
    const s = await su.query<{ id: string }>(
      `insert into app.story (org_id, publication_id, edition_id, desk_key, reporter_id, language, section_id)
       values ($1, $2, $3, $4, $5, 'mr', $6) returning id`,
      [org.orgId, org.pubId, editionId, story.key, org === a ? reporter.id : owner, section],
    );
    await su.query(
      `insert into app.story_revision (org_id, publication_id, story_id, rev, headline, author_id)
       values ($1, $2, $3, 1, $4, $5)
       on conflict (org_id, publication_id, story_id, rev) do update set headline = excluded.headline`,
      [org.orgId, org.pubId, s.rows[0]?.id, story.headline, owner],
    );
  }
  return { editionId, runId, owner };
}

/** A release of the edition (archived: its manifest written, unless `written` is false) with these pages' files. */
async function release(
  org: Org,
  date: string,
  made: { editionId: string; runId: string; owner: string },
  number: number,
  pages: number[],
  written = true,
) {
  const r = await su.query<{ id: string }>(
    `insert into app.release (org_id, publication_id, edition_id, run_id, number, kind, approved_by, retain_until,
       manifest_key, manifest_version_id, manifest_sha256, verified_at)
     values ($1, $2, $3, $4, $5, $6, $7, now() + interval '10 years', $8, $9, $10, $11) returning id`,
    [
      org.orgId,
      org.pubId,
      made.editionId,
      made.runId,
      number,
      number === 1 ? "release" : "correction",
      made.owner,
      written ? "k/manifest.json" : null,
      written ? "v1" : null,
      written ? SHA : null,
      written ? new Date() : null,
    ],
  );
  const id = r.rows[0]?.id ?? "";
  for (const page of pages) {
    await su.query(
      `insert into app.release_file (org_id, publication_id, release_id, page_no, name, rev, sha256, bytes, archive_key,
         archive_version_id)
       values ($1, $2, $3, $4, $5, 0, $6, 100, 'k/page.pdf', 'v1')`,
      [org.orgId, org.pubId, id, page, `${date}_P0${page}${number > 1 ? `_v${number}` : ""}.pdf`, SHA],
    );
  }
  releases.set(`${org === b ? "b:" : ""}${date}#${number}`, id);
  return id;
}

beforeAll(async () => {
  it_ = await identityApp(db);
  su = await db.connect("postgres");
  a = await n.organisation();
  b = await n.organisation();
  reporter = await n.member(a, [{ publicationId: a.pubId, roles: ["reporter"], grants: [] }], "member", "reporter");
  reporterName =
    (await su.query<{ display_name: string }>("select display_name from app.person where user_id = $1", [reporter.id]))
      .rows[0]?.display_name ?? "";
  const nov = await edition(a, "2026-11-02", [
    { key: "a-0000000001", headline: "Fictional dam opens 100% early", section: "City desk" },
    { key: "a-0000000002", headline: "Rain on the fictional hills" },
  ]);
  await release(a, "2026-11-02", nov, 1, [1, 2]);
  await release(a, "2026-11-02", nov, 2, [1]);
  const oct = await edition(a, "2026-10-24", [{ key: "a-0000000003", headline: "Market day" }], false);
  await release(a, "2026-10-24", oct, 1, [1, 2]);
  const old = await edition(a, "2025-12-31", [{ key: "a-0000000004", headline: "Year end" }]);
  await release(a, "2025-12-31", old, 1, [1, 2], false); // still being written: not in the archive
  const theirs = await edition(b, "2026-11-02", [{ key: "a-0000000001", headline: "Fictional dam opens 100% early" }]);
  await release(b, "2026-11-02", theirs, 1, [1]);
}, 90_000);
afterAll(async () => {
  await it_.close();
  await db.drop();
});

const list = async (query = "", who = reporter.cookie, org = a) => {
  const reply = await n.call("GET", `${pubPath(org)}/archive${query}`, who);
  expect(reply.statusCode).toBe(200);
  return reply.json() as {
    items: {
      releaseId: string;
      editionDate: string;
      number: number;
      files: number;
      frontThumb: boolean;
      matches: unknown[];
    }[];
    truncated: boolean;
  };
};
const keys = (items: { editionDate: string; number: number }[]) => items.map((i) => `${i.editionDate}#${i.number}`);

describe("the archive list", () => {
  it("is every archived release, newest edition first, to a reporter (archive.view)", async () => {
    const all = await list();
    expect(keys(all.items)).toEqual(["2026-11-02#2", "2026-11-02#1", "2026-10-24#1"]);
    expect(all.items.map((i) => [i.files, i.frontThumb])).toEqual([
      [1, true],
      [2, true],
      [2, false],
    ]);
    expect(all.truncated).toBe(false);
  });

  it("filters by year, month and kind", async () => {
    expect(keys((await list("?year=2025")).items)).toEqual([]);
    expect(keys((await list("?year=2026&month=10")).items)).toEqual(["2026-10-24#1"]);
    expect(keys((await list("?kind=correction")).items)).toEqual(["2026-11-02#2"]);
    expect((await n.call("GET", `${pubPath(a)}/archive?month=13`, reporter.cookie)).statusCode).toBe(400);
  });

  it("searches the placed stories by headline, reporter and section, a % taken literally", async () => {
    const byHeadline = await list(`?q=${encodeURIComponent("100%")}`);
    expect(keys(byHeadline.items)).toEqual(["2026-11-02#2", "2026-11-02#1"]);
    expect(byHeadline.items[0]?.matches).toEqual([
      expect.objectContaining({
        headline: "Fictional dam opens 100% early",
        section: "City desk",
        reporter: reporterName,
      }),
    ]);
    expect(keys((await list(`?q=${encodeURIComponent("0%e")}`)).items)).toEqual([]);
    expect(keys((await list("?q=city%20DESK")).items)).toEqual(["2026-11-02#2", "2026-11-02#1"]);
    expect(keys((await list(`?q=${encodeURIComponent(reporterName)}&kind=release`)).items)).toEqual([
      "2026-11-02#1",
      "2026-10-24#1",
    ]);
    expect(keys((await list("?q=nowhere")).items)).toEqual([]);
  });

  it("names no story to a role the story rules show none (Advertising): its search finds nothing", async () => {
    const ads = await n.member(a, [{ publicationId: a.pubId, roles: ["advertising"], grants: [] }], "member", "ads");
    expect(keys((await list("", ads.cookie)).items)).toEqual(["2026-11-02#2", "2026-11-02#1", "2026-10-24#1"]);
    expect((await list(`?q=${encodeURIComponent("100%")}`, ads.cookie)).items).toEqual([]);
  });
});

describe("an archived release", () => {
  it("is shown with its edition's releases", async () => {
    const id = releases.get("2026-11-02#2") ?? "";
    const reply = await n.call("GET", `${pubPath(a)}/archive/releases/${id}`, reporter.cookie);
    expect(reply.statusCode).toBe(200);
    const body = reply.json();
    expect(body.release).toMatchObject({ id, number: 2, kind: "correction", printProfile: null });
    expect(body.release.files.map((f: { name: string }) => f.name)).toEqual(["2026-11-02_P01_v2.pdf"]);
    expect(body.edition).toMatchObject({ date: "2026-11-02" });
    expect(body.edition.releases.map((r: { number: number }) => r.number)).toEqual([2, 1]);
  });

  it("is not found while still being written, unknown, or another organisation's", async () => {
    const path = (id: string) => `${pubPath(a)}/archive/releases/${id}`;
    expect((await n.call("GET", path(releases.get("2025-12-31#1") ?? ""), reporter.cookie)).statusCode).toBe(404);
    expect((await n.call("GET", path("not-a-uuid"), reporter.cookie)).statusCode).toBe(404);
    expect((await n.call("GET", path(releases.get("b:2026-11-02#1") ?? ""), reporter.cookie)).statusCode).toBe(404);
    expect([403, 404]).toContain((await n.call("GET", `${pubPath(b)}/archive`, reporter.cookie)).statusCode);
    expect(keys((await list("", b.ownerCookie, b)).items)).toEqual(["2026-11-02#1"]);
  });
});
