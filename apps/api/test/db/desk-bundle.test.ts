// "Send to the Desk" (src/modules/stories/desk-bundle.ts; tools/desk/CONTRACT.md §6) on a migrated clone and the run's
// bucket: the ZIP the API streams (its files, bundle.json's every key, desk-text/1 bodies, revisions, photo SHA-256s, no
// ZIP64), its limits, who may ask, what is recorded and what it refuses, and the Desk's own code on what it sends
// (test/support/desk_roundtrip.py): the round trip into a throwaway Desk home, every story and photo arriving and a
// re-export after an edit replacing what changed; desk_text on the same bodies as the API's port; a cut-off ZIP refused
// as damaged; a repetitive bundle taken. Every person, story and picture is fictional.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDatabase } from "./helpers.ts";
import { type IdentityApp, identityApp } from "./identity-app.ts";
import { type Org, type Person, newsroom } from "./newsroom.ts";
import { realPng } from "../support/pictures.ts";
import { deskText, isDeskText, writeZip } from "../../src/modules/stories/desk-bundle.ts";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const DESK_PY = process.env.PAGEINATOR_DESK_PY ?? join(REPO, "experiments/phase0/pdfx1/.venv/bin/python");

const db = await freshDatabase();
let it_: IdentityApp;
let su: Client;
const n = newsroom(
  () => it_,
  () => su,
);
const { call, change } = n;
let a: Org;
let editor: Person;
let reporter: Person;
let edition: string;
let other: string;
let section: string;
const DAY = "2026-11-30";
let days = 0;
/** A new edition of the first publication, on a day of its own. */
async function newEdition(pub = a.pubId): Promise<{ id: string; day: string }> {
  days += 1;
  const day = `2027-01-${String(days).padStart(2, "0")}`;
  const made = await su.query<{ id: string }>(
    `insert into app.edition (org_id, publication_id, edition_date, desk_key, pages)
     values ($1, $2, $3::date, $3::text, 8) returning id`,
    [a.orgId, pub, day],
  );
  return { id: made.rows[0]?.id as string, day };
}

/** The Desk's own code (test/support/desk_roundtrip.py): one command, its JSON answer. */
function desk(...args: string[]): unknown {
  expect(existsSync(DESK_PY), `the Desk's Python (set PAGEINATOR_DESK_PY): ${DESK_PY}`).toBe(true);
  const run = spawnSync(
    DESK_PY,
    ["-B", join(REPO, "apps/api/test/support/desk_roundtrip.py"), args[0] as string, REPO, ...args.slice(1)],
    {
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout);
}

/** Writes files into a temporary folder, runs fn on it, and removes it. */
function inFolder<T>(files: Record<string, Uint8Array | string>, fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "pgn-desk-bundle-"));
  try {
    for (const [name, data] of Object.entries(files)) writeFileSync(join(dir, name), data);
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

beforeAll(async () => {
  it_ = await identityApp(db);
  su = await db.connect("postgres");
  a = await n.organisation();
  editor = await n.member(a, [{ publicationId: a.pubId, roles: ["editor"], grants: [] }], "member", "editor");
  reporter = await n.member(a, [{ publicationId: a.pubId, roles: ["reporter"], grants: [] }], "member", "reporter");
  const made = await su.query<{ id: string }>(
    `insert into app.edition (org_id, publication_id, edition_date, desk_key, pages)
     values ($1, $2, $3::date, $3::text, 8), ($1, $2, '2026-12-01', '2026-12-01', 4) returning id`,
    [a.orgId, a.pubId, DAY],
  );
  [edition, other] = made.rows.map((row) => row.id) as [string, string];
  section = (
    await su.query<{ id: string }>(
      "insert into app.section (org_id, publication_id, name) values ($1, $2, 'शहर') returning id",
      [a.orgId, a.pubId],
    )
  ).rows[0]?.id as string;
}, 120_000);
afterAll(async () => {
  await it_.close();
  await db.drop();
});

const stories = () => `/api/v1/orgs/${a.orgId}/pubs/${a.pubId}/stories`;
const bundleUrl = (e = edition) => `/api/v1/orgs/${a.orgId}/pubs/${a.pubId}/editions/${e}/desk-bundle`;

async function story(extra: Record<string, unknown>, to: "ready" | "draft" = "ready") {
  const made = await change("POST", stories(), editor.cookie, {
    headline: "Rain over Kalpaniknagar (fictional)",
    body: "First line of the first paragraph\nand its second line.\n\n## A subheading\n\nSecond paragraph.",
    editionId: edition,
    sectionId: section,
    priority: 2,
    pagePin: 3,
    ...extra,
  });
  expect(made.statusCode, made.body).toBe(201);
  let s = made.json() as { id: string; revision: number };
  if (to === "ready") {
    for (const target of ["filed", "ready"]) {
      const moved = await change("POST", `${stories()}/${s.id}/transitions`, editor.cookie, {
        to: target,
        baseRevision: s.revision,
      });
      expect(moved.statusCode, moved.body).toBe(200);
      s = moved.json();
    }
  }
  return s;
}

/** A real picture uploaded and completed: its asset. */
async function picture(seed: number) {
  const file = realPng(40, 30, [seed, 80, 120]);
  const presigned = await change("POST", `/api/v1/orgs/${a.orgId}/pubs/${a.pubId}/uploads`, editor.cookie, {
    purpose: "story_photo",
    filename: "IMG_0001.png",
    contentType: "image/png",
    bytes: file.length,
  });
  const policy = presigned.json();
  const form = new FormData();
  for (const [name, value] of Object.entries(policy.fields as Record<string, string>)) form.append(name, value);
  form.append("file", new Blob([file]));
  expect((await fetch(policy.url, { method: "POST", body: form })).status).toBe(204);
  const done = await call(
    "POST",
    `/api/v1/orgs/${a.orgId}/pubs/${a.pubId}/uploads/${policy.uploadId}/complete`,
    editor.cookie,
  );
  expect(done.statusCode, done.body).toBe(200);
  return { ...(done.json().asset as { id: string; sha256: string }), bytes: file };
}

async function attach(s: { id: string; revision: number }, assetId: string, caption = "Clouds (fictional)") {
  const res = await call("PUT", `${stories()}/${s.id}/photo`, editor.cookie, {
    baseRevision: s.revision,
    assetId,
    caption,
    credit: "Photo desk (fictional)",
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { id: string; revision: number };
}

async function exportBundle(body: unknown = {}, e = edition) {
  const res = await it_.app.inject({
    method: "POST",
    url: bundleUrl(e),
    headers: {
      cookie: editor.cookie,
      origin: "https://app.example.test",
      "x-pageinator": "1",
      "content-type": "application/json",
    },
    payload: body as Record<string, unknown>,
    remoteAddress: n.address(),
  });
  return res;
}

describe("the story bundle", () => {
  it("is a ZIP of bundle.json and one file per distinct photo, every key there, as CONTRACT.md §6 says", async () => {
    const photo = await picture(10);
    const s1 = await attach(await story({}), photo.id);
    const s2 = await story({ headline: "Market day (fictional)", body: "One paragraph only.", pagePin: null });
    const s3 = await attach(await story({ headline: "Same photo (fictional)", sectionId: null }), photo.id, "Again");
    await story({ headline: "Still a draft (fictional)" }, "draft");
    const res = await exportBundle();
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers["content-type"]).toBe("application/zip");
    expect(res.headers["content-disposition"]).toBe(`attachment; filename="pageinator-stories-${DAY}.zip"`);
    expect(res.headers["cache-control"]).toBe("no-store");
    const zip1 = res.rawPayload;
    // no ZIP64: no ZIP64 end record or locator anywhere in the end of the file
    const tail = Buffer.from(zip1.subarray(-1024));
    expect([
      tail.includes(Buffer.from("PK\x06\x06", "latin1")),
      tail.includes(Buffer.from("PK\x06\x07", "latin1")),
    ]).toEqual([false, false]);
    const files = unzipSync(zip1);
    const photoName = `photos/${photo.sha256}.png`;
    expect(Object.keys(files).sort()).toEqual(["bundle.json", photoName]);
    expect(
      createHash("sha256")
        .update(files[photoName] as Uint8Array)
        .digest("hex"),
    ).toBe(photo.sha256);
    expect(Buffer.from(files[photoName] as Uint8Array).equals(Buffer.from(photo.bytes))).toBe(true);
    const doc = JSON.parse(new TextDecoder().decode(files["bundle.json"]));
    expect(Object.keys(doc)).toEqual(["format", "bundle", "source", "edition", "stories"]);
    expect(doc.format).toBe("pageinator.story-bundle/1");
    expect(doc.bundle).toEqual({
      id: res.headers["x-pageinator-bundle"],
      created: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+05:30$/),
    });
    expect(doc.source).toEqual({ organisation_id: a.orgId, publication_id: a.pubId });
    expect(doc.edition).toEqual({ date: DAY, pages: 8 });
    expect(doc.stories.map((s: { id: string }) => s.id)).toEqual([s1.id, s2.id, s3.id]); // Ready only, oldest first
    const [one, two, three] = doc.stories;
    expect(Object.keys(one)).toEqual([
      "id",
      "revision",
      "headline",
      "kicker",
      "deck",
      "byline",
      "body",
      "body_format",
      "section",
      "priority",
      "page",
      "language",
      "photo",
    ]);
    expect(one).toMatchObject({
      revision: s1.revision,
      headline: "Rain over Kalpaniknagar (fictional)",
      body: "First line of the first paragraph and its second line.\n\n## A subheading\n\nSecond paragraph.",
      body_format: "desk-text/1",
      section: "शहर",
      priority: 2,
      page: 3,
      language: "mr",
    });
    expect(one.photo).toEqual({
      file: photoName,
      sha256: photo.sha256,
      filename: expect.stringMatching(/^p-[0-9a-f]{10}\.png$/),
      caption: "Clouds (fictional)",
      credit: "Photo desk (fictional)",
    });
    expect([two.photo, two.page, three.section, three.photo.file]).toEqual([null, null, null, photoName]);
    // recorded: the bundle and each story's text revision, and audited
    const { rows } = await su.query(
      `select r.story_id, r.rev, r.version from app.desk_bundle_revision r join app.desk_bundle b on b.id = r.bundle_id
       where b.id = $1 order by r.story_id`,
      [doc.bundle.id],
    );
    // the revision sent (the story's version), beside its text revision
    const sent = Object.fromEntries(doc.stories.map((s: { id: string; revision: number }) => [s.id, s.revision]));
    expect(rows.map((row) => [row.story_id, row.version])).toEqual(
      rows.map((row) => [row.story_id, sent[row.story_id]]),
    );
    expect(rows.every((row) => row.rev === 1)).toBe(true);
    const audit = await su.query("select data from app.audit_event where action = 'desk.export' and target_id = $1", [
      edition,
    ]);
    expect(audit.rows).toEqual([{ data: { bundle: doc.bundle.id, stories: 3, photos: 1 } }]);
  });

  it("takes the states asked for, and only the edition's stories", async () => {
    const res = await exportBundle({ statuses: ["draft"] });
    const doc = JSON.parse(new TextDecoder().decode(unzipSync(res.rawPayload)["bundle.json"]));
    expect(doc.stories.map((s: { headline: string }) => s.headline)).toEqual(["Still a draft (fictional)"]);
    const empty = await it_.app.inject({
      method: "POST",
      url: bundleUrl(other),
      headers: {
        cookie: editor.cookie,
        origin: "https://app.example.test",
        "x-pageinator": "1",
        "content-type": "application/json",
      },
      payload: {},
      remoteAddress: n.address(),
    });
    expect(JSON.parse(new TextDecoder().decode(unzipSync(empty.rawPayload)["bundle.json"])).stories).toEqual([]);
  });

  it("is the desk's to ask for: a Reporter gets 403, another publication's or a made-up edition 404", async () => {
    expect((await change("POST", bundleUrl(), reporter.cookie, {})).statusCode).toBe(403);
    expect((await change("POST", bundleUrl(crypto.randomUUID()), editor.cookie, {})).statusCode).toBe(404);
    const b = await n.organisation();
    const theirs = await su.query<{ id: string }>(
      `insert into app.edition (org_id, publication_id, edition_date, desk_key, pages) values ($1, $2, $3::date, $3::text, 8)
       returning id`,
      [b.orgId, b.pubId, DAY],
    );
    expect((await change("POST", bundleUrl(theirs.rows[0]?.id), a.ownerCookie, {})).statusCode).toBe(404);
    // an edition of the organisation's other publication, asked for under the first
    const p2 = await n.addPublication(a, "Kalpaniknagar Express");
    const sibling = await newEdition(p2);
    expect((await change("POST", bundleUrl(sibling.id), a.ownerCookie, {})).statusCode).toBe(404);
  });

  it("never sends spiked stories, even when asked (400)", async () => {
    const res = await exportBundle({ statuses: ["ready", "spiked"] });
    expect([res.statusCode, res.json().error.details[0].message]).toEqual([
      400,
      "Spiked stories are never sent to the Desk: restore a story first.",
    ]);
  });

  it("holds at most 200 stories", async () => {
    const many = await su.query<{ id: string }>(
      `select id from app.edition where org_id = $1 and desk_key = '2026-12-01'`,
      [a.orgId],
    );
    const e = many.rows[0]?.id as string;
    const paste = async (count: number) => {
      const text = Array.from({ length: count }, (_, i) => `Brief ${i} (fictional)\nA line.`).join("\n---\n");
      const pasted = await change("POST", `${stories()}/paste`, editor.cookie, { text, editionId: e });
      expect(pasted.statusCode).toBe(201);
      await su.query("update app.story set status = 'ready' where org_id = $1 and edition_id = $2", [a.orgId, e]);
    };
    await paste(200);
    const exactly = await exportBundle({}, e);
    expect([exactly.statusCode, exactly.headers["x-pageinator-stories"]]).toEqual([200, "200"]);
    expect(JSON.parse(new TextDecoder().decode(unzipSync(exactly.rawPayload)["bundle.json"])).stories).toHaveLength(
      200,
    );
    await paste(1);
    const res = await change("POST", bundleUrl(e), editor.cookie, {});
    expect([res.statusCode, res.json().error.details[0].message]).toEqual([
      400,
      "A bundle holds at most 200 stories: send fewer at a time.",
    ]);
  });
});

describe("the bundle's limits and checks", () => {
  it("refuses, before anything is recorded or sent, photos over 200 MB in all (413)", async () => {
    const big = await su.query<{ id: string }>(
      `insert into app.edition (org_id, publication_id, edition_date, desk_key, pages) values ($1, $2, '2026-12-02', '2026-12-02', 8)
       returning id`,
      [a.orgId, a.pubId],
    );
    const e = big.rows[0]?.id as string;
    for (let i = 0; i < 6; i += 1) {
      const photo = await picture(30 + i);
      const s = await story({ headline: `Heavy ${i} (fictional)`, editionId: e, pagePin: null });
      await attach(s, photo.id);
      // as if each were a 40 MiB original (the check reads the asset's size; nothing is read from the store)
      await su.query("update app.asset set bytes = 41943040 where id = $1", [photo.id]);
    }
    const before = await su.query("select count(*)::int as n from app.desk_bundle");
    const res = await change("POST", bundleUrl(e), editor.cookie, {});
    expect([res.statusCode, res.json().error.code]).toEqual([413, "file_too_large"]);
    expect((await su.query("select count(*)::int as n from app.desk_bundle")).rows).toEqual(before.rows);
  }, 60_000);

  it("refuses, naming each story, a story whose photo was rejected or deleted (409), rather than send it without", async () => {
    const e = (await newEdition()).id;
    const rejected = await picture(70);
    const deleted = await picture(71);
    await attach(await story({ headline: "Rejected photo (fictional)", editionId: e, pagePin: null }), rejected.id);
    await attach(await story({ headline: "Deleted photo (fictional)", editionId: e, pagePin: null }), deleted.id);
    await story({ headline: "Fine (fictional)", editionId: e, pagePin: null });
    await su.query("update app.asset set status = 'rejected' where id = $1", [rejected.id]);
    await su.query("update app.asset set deleted_at = now() where id = $1", [deleted.id]);
    const before = await su.query("select count(*)::int as n from app.desk_bundle");
    const res = await change("POST", bundleUrl(e), editor.cookie, {});
    expect([res.statusCode, res.json().error.code]).toEqual([409, "bundle_refused"]);
    expect(res.json().error.details.map((d: { message: string }) => d.message)).toEqual([
      "“Rejected photo (fictional)” has a photo that was rejected or deleted: take it off the story, or give it another, then send again.",
      "“Deleted photo (fictional)” has a photo that was rejected or deleted: take it off the story, or give it another, then send again.",
    ]);
    // the reason and the headline, for the web to word in the reader's language (L2-354)
    expect(res.json().error.details.map((d: { reason: string; params: unknown }) => [d.reason, d.params])).toEqual([
      ["bundle.photo_unusable", { headline: "Rejected photo (fictional)" }],
      ["bundle.photo_unusable", { headline: "Deleted photo (fictional)" }],
    ]);
    expect((await su.query("select count(*)::int as n from app.desk_bundle")).rows).toEqual(before.rows);
  });

  it("refuses, naming it, a story whose subheading starts with # (409), and never drops the #", async () => {
    const e = (await newEdition()).id;
    await story({
      headline: "Rally (fictional)",
      body: "The rally.\n\n## #MeToo rally\n\nMore.",
      editionId: e,
      pagePin: null,
    });
    const res = await change("POST", bundleUrl(e), editor.cookie, {});
    expect([res.statusCode, res.json().error.code, res.json().error.details[0].message]).toEqual([
      409,
      "bundle_refused",
      "The subheading “## #MeToo rally” in “Rally (fictional)” starts with #, which the Desk cannot print as a subheading: change it in the story.",
    ]);
    expect(res.json().error.details[0]).toMatchObject({
      reason: "bundle.subheading_hash",
      params: { subheading: "#MeToo rally", headline: "Rally (fictional)" },
    });
  });

  it("cuts the ZIP off when a photo's bytes are not the ones its asset names (the route)", async () => {
    const e = (await newEdition()).id;
    const photo = await picture(60);
    await attach(await story({ headline: "Tampered (fictional)", editionId: e, pagePin: null }), photo.id);
    await su.query("update app.asset set sha256 = $2 where id = $1", [photo.id, "0".repeat(64)]);
    // the answer began before the photo was read: it is cut off (the connection is destroyed), never completed
    await expect(change("POST", bundleUrl(e), editor.cookie, {})).rejects.toThrow(
      "response destroyed before completion",
    );
  });

  it("and what such a cut-off ZIP holds, the Desk refuses as damaged (m.bundle.damaged)", async () => {
    const out = new PassThrough();
    const got: Buffer[] = [];
    out.on("data", (chunk: Buffer) => got.push(chunk));
    const sha = "0".repeat(64);
    const json = new TextEncoder().encode(
      JSON.stringify({
        format: "pageinator.story-bundle/1",
        bundle: { id: "b-1", created: "2026-11-30T06:00:00+05:30" },
        source: { organisation_id: a.orgId, publication_id: a.pubId },
        edition: { date: DAY, pages: 8 },
        stories: [],
      }),
    );
    const store = {
      read: async () =>
        (async function* () {
          yield realPng(20, 20);
        })(),
    };
    await expect(
      writeZip(
        out,
        json,
        [{ name: `photos/${sha}.png`, sha256: sha, bytes: 0, key: "k", version: "v" }],
        store,
        new Date(),
      ),
    ).rejects.toThrow("not the bytes its asset names");
    const partial = Buffer.concat(got);
    expect(partial.length).toBeGreaterThan(0);
    expect(inFolder({ "cut.zip": partial }, (dir) => desk("open", join(dir, "cut.zip")))).toEqual({
      refused: "m.bundle.damaged",
    });
  });

  it("stores bundle.json, so a repetitive story never trips the Desk's 100:1 packing limit", async () => {
    const e = (await newEdition()).id;
    const body = "same words again ".repeat(11_000).trim(); // about 187,000 characters, one paragraph
    for (let i = 0; i < 8; i += 1)
      await story({ headline: `Repetitive ${i} (fictional)`, body, editionId: e, pagePin: null });
    const res = await exportBundle({}, e);
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.length).toBeGreaterThan(1_400_000); // stored, not packed
    expect(inFolder({ "big.zip": res.rawPayload }, (dir) => desk("open", join(dir, "big.zip")))).toEqual({
      ok: true,
      stories: 8,
    });
  }, 60_000);

  it("writes bodies the Desk's own desk_text takes, and its port decides every case as the Desk does", async () => {
    const raw = [
      "One.\n\nTwo.",
      "  One.\r\n\r\n  Two.  \r\n",
      "One.\n##   Heading\nTwo.",
      "### Heading",
      "\ufeff## x",
      "One.\u2028Two.",
      "\u00a0One\u00a0two.",
      "One\u001c two.",
      "A line\nthat goes on.\n\nNext.",
      "",
    ];
    const cases = [
      ...raw.map((body) => deskText(body).text),
      "One.\nTwo.",
      "One.\n\n\nTwo.",
      "##Heading",
      "## #Heading",
      "## \ufeffx",
      "\ufeff",
      "## \u001cx",
      "\u00a0## x",
      "\u00a0##x",
      "## \u00a0x",
      "  ",
      "\n\nOne.",
      "One.\r",
    ];
    const python = inFolder({ "bodies.json": JSON.stringify(cases) }, (dir) =>
      desk("desk_text", join(dir, "bodies.json")),
    ) as boolean[];
    expect(cases.map(isDeskText)).toEqual(python);
    expect(python.slice(0, raw.length)).toEqual(raw.map(() => true)); // what the API writes, the Desk takes
  });
});

describe("the round trip into the Desk (deskserver/bundle.py)", () => {
  it("brings every story and photo in, and a re-export after an edit replaces what changed", async () => {
    const { id: e, day } = await newEdition();
    const photo = await picture(90);
    const s1 = await attach(await story({ editionId: e }), photo.id);
    const s2 = await story({
      headline: "Market day (fictional)",
      body: "One paragraph only.",
      editionId: e,
      pagePin: null,
    });
    const s3 = await attach(
      await story({ headline: "Same photo (fictional)", editionId: e, sectionId: null }),
      photo.id,
      "Again",
    );
    const zip1 = (await exportBundle({}, e)).rawPayload;
    // an edit of the text of one, and of the photo's caption of another: both get a higher revision
    const edited = await call("PATCH", `${stories()}/${s2.id}`, editor.cookie, {
      baseRevision: s2.revision,
      headline: "Market day, later (fictional)",
    });
    expect(edited.statusCode, edited.body).toBe(200);
    const recaptioned = await call("PATCH", `${stories()}/${s1.id}/photo`, editor.cookie, {
      baseRevision: s1.revision,
      caption: "Clouds, later (fictional)",
    });
    expect(recaptioned.statusCode, recaptioned.body).toBe(200);
    const zip2 = (await exportBundle({}, e)).rawPayload;
    const out = inFolder({ "1.zip": zip1, "2.zip": zip2 }, (dir) =>
      desk("import", join(dir, "home"), day, "8", join(dir, "1.zip"), join(dir, "2.zip")),
    ) as {
      imports: Record<string, { story: string; reason?: string }[]>[];
      articles: {
        story: string;
        headline: string;
        body: string;
        revision: number;
        photo: { caption: string } | null;
        photo_file: boolean;
      }[];
    };
    const ids = (list: { story: string }[] | undefined) => (list ?? []).map((item) => item.story).sort();
    expect(ids(out.imports[0]?.added)).toEqual([s1.id, s2.id, s3.id].sort());
    expect([out.imports[0]?.refused, out.imports[0]?.kept]).toEqual([[], []]);
    expect(ids(out.imports[1]?.replaced)).toEqual([s1.id, s2.id].sort());
    expect(ids(out.imports[1]?.unchanged)).toEqual([s3.id]);
    const byStory = Object.fromEntries(out.articles.map((article) => [article.story, article]));
    expect(byStory[s2.id]?.headline).toBe("Market day, later (fictional)");
    expect(byStory[s1.id]?.photo?.caption).toBe("Clouds, later (fictional)");
    expect([byStory[s1.id]?.photo_file, byStory[s3.id]?.photo_file]).toEqual([true, true]);
    expect(byStory[s1.id]?.body).toBe(
      "First line of the first paragraph and its second line.\n\n## A subheading\n\nSecond paragraph.",
    );
  }, 60_000);
});
