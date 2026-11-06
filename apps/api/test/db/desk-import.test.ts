// The one-time import of the Desk's home (docs/product/10-l2-newsroom-plan.md §3.8; scripts/import-desk.ts,
// src/db/desk-import.ts), on a migrated clone and the run's bucket: a FICTIONAL desk home is written here (fictional
// Marathi and English text, generated PNGs, tiny one-page PDFs), packed by tools/desk/export-home.sh exactly as on the
// Mac, then imported: the counts, every stored file read back against the manifest, the rows and jobs it makes, a
// second import that changes nothing, a dry run that writes nothing, samples left out (or taken when asked), a bundle
// that does not match its manifest refused whole, the audit rows (actor kind import), and the organisation wall.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, crc32 } from "node:zlib";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { strToU8, unzipSync, zipSync } from "fflate";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { type ImportReport, ImportRefused, importDesk } from "../../src/db/desk-import.ts";
import { s3Client, s3Store } from "../../src/storage/s3.ts";
import { freshDatabase } from "./helpers.ts";
import { type IdentityApp, ORIGIN, SECRET, identityApp } from "./identity-app.ts";
import { type Org, newsroom } from "./newsroom.ts";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const API = fileURLToPath(new URL("../../", import.meta.url));
const EXPORT = join(REPO, "tools/desk/export-home.sh");
const ED = "2026-10-21";
const RUN = "r-20261021-120000";
const OLD_RUN = "r-20261021-101500";

const db = await freshDatabase();
let it_: IdentityApp;
let su: Client;
const n = newsroom(
  () => it_,
  () => su,
);
let a: Org;
let b: Org;
let ownerA: string;
let scratch: string;
let bundle: string;
let datasetZip: string;
let exported: string;

const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

/** A real PNG of w×h grey pixels (the API reads its size from its header). */
function png(w: number, h: number, grey: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 0, 0, 0, 0], 8); // 8-bit greyscale
  const rows = Buffer.concat(Array.from({ length: h }, () => Buffer.from([0, ...Array<number>(w).fill(grey)])));
  return Buffer.concat([
    Buffer.from("\x89PNG\r\n\x1a\n", "latin1"),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A small valid one-page PDF, its text making each page's bytes its own. */
function pdf(label: string): Buffer {
  const stream = `BT /F1 12 Tf 20 20 Td (${label}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, i) => {
    const at = body.length;
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return at;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((at) => `${String(at).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

function write(path: string, content: string | Buffer | object) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === "string" || Buffer.isBuffer(content) ? content : JSON.stringify(content));
}

const article = (id: string, headline: string, body: string, extra: object = {}) => ({
  id,
  headline,
  kicker: "",
  deck: "",
  byline: "काल्पनिक प्रतिनिधी",
  body,
  priority: 3,
  page: null,
  photo: null,
  source: "typed",
  created: "2026-10-21T09:00:00+05:30",
  updated: "2026-10-21T09:30:00+05:30",
  ...extra,
});

/** A fictional desk home and dataset, as the Desk lays them out (tools/desk/CONTRACT.md §1). */
function fictionalHome(root: string): { home: string; dataset: string } {
  const home = join(root, "home");
  const dataset = join(root, "dataset");
  write(join(dataset, "report/page1/pages/kalpanik__p1.json"), { page: 1, sample: "kalpanik" });
  write(join(dataset, "report/page1/photos/kalpanik__p1/index.json"), { elements: {} });
  write(join(dataset, "report/page1/brand/masthead.json"), { name: "fictional" });
  write(join(dataset, "report/headlines.jsonl"), '{"id": "h1"}\n');
  write(join(dataset, "work/kalpanik/measure.json"), { pages: [] });
  write(join(dataset, "work/kalpanik/scan.tif"), "not read by the engine");
  write(join(dataset, "samples/kalpanik/source.pdf"), "not read by the engine");
  write(join(home, "config.json"), {
    schema: "pageinator.desk.config/1",
    engine: "desk-engine/fictional",
    dataset,
    templates: { front: "kalpanik__p1" },
  });
  write(join(home, "cache/options/x.json"), "{}");
  write(join(home, "trash/2026-10-01-1/edition.json"), "{}");
  write(join(home, "edit-service.log"), "log");
  write(join(home, ".desk.lock"), "");

  const ed = join(home, "editions", ED);
  write(join(ed, "edition.json"), {
    schema: "pageinator.desk.edition/1",
    id: ED,
    date: ED,
    pages: 4,
    back_page_ads: true,
    volume: "वर्ष १",
    issue: "अंक २",
    price: "₹ ५",
    created: "2026-10-20T15:30:12+05:30",
    updated: "2026-10-21T10:00:00+05:30",
  });
  write(join(ed, "articles.json"), {
    schema: "pageinator.desk.articles/1",
    articles: [
      article("a-0000000001", "काल्पनिकनगरात नवा पूल", "पहिला परिच्छेद.\n\nदुसरा परिच्छेद.", {
        priority: 1,
        photo: { id: "p-0000000001", caption: "नवा पूल", credit: "काल्पनिक छायाचित्रकार", width_px: 40, height_px: 30 },
      }),
      article("a-0000000002", "Fictional market opens", "The fictional market opened today.\n\n## Prices\n\nLow."),
      article("a-0000000003", "Pinned fictional brief", "A short fictional item.", { page: 2, source: "pasted" }),
      article("a-0000000004", "जुनी काल्पनिक बातमी", "नमुना मजकूर.", { source: "sample:kalpanik" }),
    ],
  });
  write(join(ed, "photos/p-0000000001.orig.png"), png(40, 30, 120));
  write(join(ed, "photos/p-0000000001.jpg"), "preview bytes");
  write(join(ed, "photos/p-0000000001.cmyk.gz"), "raster bytes");
  write(join(ed, "photos/index.json"), { elements: { "p-0000000001": { width_px: 40, height_px: 30, ppi: null } } });
  write(join(ed, "ads/back-1.orig.png"), png(20, 10, 30));
  write(join(ed, "ads/back-1.cmyk.gz"), "ad raster");
  write(join(ed, "ads/index.json"), { elements: { "back-1": { width_px: 20, height_px: 10, ppi: null } } });
  write(join(ed, "measure-status.json"), { state: "done" });
  write(join(ed, ".bundle-left"), "staging");

  const run = join(ed, "runs", RUN);
  write(join(run, "request.json"), { edition: { id: ED }, articles: [], ads: {} });
  const page = (no: number, role: string, articles: string[]) => {
    const nn = String(no).padStart(2, "0");
    write(join(run, `page-${nn}.pdf`), pdf(`page ${no}`));
    write(join(run, `page-${nn}.png`), png(8, 10, no * 10));
    write(join(run, `page-${nn}.thumb.png`), png(4, 5, no * 10));
    write(join(run, `page-${nn}.pdfx-check.txt`), `PASS everything\nWARN fictional warning ${no}\n`);
    return {
      page: no,
      role,
      state: "done",
      articles,
      pdf: `page-${nn}.pdf`,
      png: `page-${nn}.png`,
      thumb: `page-${nn}.thumb.png`,
      seconds: 12.5,
      message: "",
      warnings: no === 4 ? ["The page is not full."] : [],
      pdfx_check: { passed: true, fails: 0, warnings: 1 },
    };
  };
  write(join(run, "status.json"), {
    schema: "pageinator.desk.run-status/1",
    run: RUN,
    edition: ED,
    state: "done",
    created: "2026-10-21T12:00:00+05:30",
    started: "2026-10-21T12:00:01+05:30",
    finished: "2026-10-21T12:09:00+05:30",
    elapsed_s: 539,
    message: "",
    error: null,
    pages: [
      page(1, "front", ["a-0000000001"]),
      page(2, "inside", ["a-0000000003"]),
      page(3, "inside", []),
      page(4, "back", []),
    ],
    not_placed: [{ article: "a-0000000002", reason: "It did not fit." }],
    timings: { measure_s: 10, plan_s: 2, layout_s: 500 },
    edition_pdf: "edition.pdf",
    zip: "press-files.zip",
    msgs: { "The page is not full.": { code: "m.warn.notFill", params: {} } },
  });
  write(join(run, "edition.pdf"), pdf("whole edition"));
  write(join(run, "press-files.zip"), Buffer.from(zipSync({ "page-01.pdf": pdf("page 1") })));
  write(join(run, "plan.json"), { stories: {} });
  // the run's own ads (what its pages print): back-2 is listed without its raster, so it prints none
  write(join(run, "ads/back-1.cmyk.gz"), "the run's ad raster");
  write(join(run, "ads/index.json"), { elements: { "back-1": { width_px: 20, height_px: 10 }, "back-2": {} } });
  write(join(run, "engine.log"), "engine output");
  write(join(ed, "runs", OLD_RUN, "request.json"), { edition: { id: ED } });
  write(join(ed, "runs", OLD_RUN, "status.json"), {
    state: "failed",
    created: "2026-10-21T10:15:00+05:30",
    started: "2026-10-21T10:15:01+05:30",
    finished: "2026-10-21T10:16:00+05:30",
    message: "The layout engine stopped.",
    error: "The layout engine stopped.",
    pages: [],
    not_placed: [],
  });

  const ed2 = join(home, "editions", "2026-10-22");
  write(join(ed2, "edition.json"), {
    schema: "pageinator.desk.edition/1",
    id: "2026-10-22",
    date: "2026-10-22",
    pages: 8,
  });
  write(join(ed2, "articles.json"), {
    articles: [article("a-0000000005", "Second fictional day", "Its fictional text.")],
  });
  return { home, dataset };
}

const source = (path = bundle) => createReadStream(path);
const run = (org: Org, options: Partial<Parameters<typeof importDesk>[0]> = {}): Promise<ImportReport> =>
  importDesk({
    database: it_.database,
    store: s3Store(it_.config.storage!),
    orgId: org.orgId,
    pubId: org.pubId,
    actorId: ownerA,
    source: source(),
    ...options,
  });

async function rowsOf(org: Org) {
  const count = async (table: string) =>
    Number(
      (await su.query(`select count(*) from app.${table} where org_id = $1`, [org.orgId])).rows[0]?.count as string,
    );
  const objects = await s3Client(it_.config.storage!).send(
    new ListObjectsV2Command({ Bucket: it_.config.storage!.workBucket, Prefix: `orgs/${org.orgId}/` }),
  );
  return {
    edition: await count("edition"),
    story: await count("story"),
    asset: await count("asset"),
    layout_run: await count("layout_run"),
    run_page: await count("run_page"),
    ad_slot_artwork: await count("ad_slot_artwork"),
    audit: Number(
      (await su.query("select count(*) from app.audit_event where org_id = $1 and actor_kind = 'import'", [org.orgId]))
        .rows[0]?.count as string,
    ),
    objects: objects.KeyCount ?? 0,
  };
}

beforeAll(async () => {
  it_ = await identityApp(db);
  su = await db.connect("postgres");
  a = await n.organisation();
  b = await n.organisation();
  ownerA = await n.userId(a.owner);
  // a ready engine profile whose 4-page plan with back-page ads has the slot back-1 (the ad's size comes from it)
  const { rows } = await su.query<{ id: string }>(
    `insert into app.upload (org_id, publication_id, user_id, purpose, declared_type, declared_bytes, expires_at)
     values ($1, $2, $3, 'engine_dataset', 'application/zip', 100, now()) returning id`,
    [a.orgId, a.pubId, ownerA],
  );
  const plan = {
    pages: 4,
    back_page_ads: true,
    page_plan: [
      {
        page: 4,
        role: "back",
        template_role: "back",
        news_mm2: 1,
        ad_slots: [{ slot: "back-1", w_mm: 250, h_mm: 120.5 }],
      },
    ],
  };
  await su.query(
    `insert into app.engine_profile (org_id, publication_id, version, state, upload_id, dataset_sha256, dataset_bytes,
       config_version_id, config_sha256, engine_version, templates, grid, plans, created_by)
     values ($1, $2, 1, 'ready', $3, $4, 100, 'v1', $4, 'desk-engine/fictional', '{}', '{}', $5, $6)`,
    [a.orgId, a.pubId, rows[0]?.id, "a".repeat(64), JSON.stringify([plan]), ownerA],
  );
  scratch = mkdtempSync(join(tmpdir(), "pgn-desk-import-test-"));
  const { home } = fictionalHome(scratch);
  const out = join(scratch, "out");
  const made = spawnSync("sh", [EXPORT, "--home", home, "--out", out], { encoding: "utf8" });
  expect(made.status, made.stderr).toBe(0);
  exported = made.stdout;
  bundle = join(out, "desk-home.zip");
  datasetZip = join(out, "engine-dataset.zip");
}, 120_000);
afterAll(async () => {
  rmSync(scratch, { recursive: true, force: true });
  await it_.close();
  await db.drop();
});

describe("tools/desk/export-home.sh", () => {
  it("packs the editions with a manifest, leaving out the Desk's temporaries, and prints both SHA-256s", () => {
    const files = unzipSync(readFileSync(bundle));
    const names = Object.keys(files).sort();
    expect(names).toContain("manifest.json");
    expect(names).toContain("config.json");
    expect(names).toContain(`editions/${ED}/runs/${RUN}/page-01.pdf`);
    expect(names).toContain(`editions/${ED}/runs/${RUN}/plan.json`);
    expect(names).toContain(`editions/${ED}/photos/p-0000000001.cmyk.gz`);
    for (const left of [
      "engine.log",
      "measure-status.json",
      ".bundle-left",
      ".desk.lock",
      "cache/",
      "trash/",
      "edit-service",
    ]) {
      expect(names.filter((name) => name.includes(left))).toEqual([]);
    }
    const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"])) as {
      format: string;
      files: { path: string; bytes: number; sha256: string }[];
    };
    expect(manifest.format).toBe("pageinator.desk-export/1");
    expect(manifest.files.map((f) => f.path).sort()).toEqual(names.filter((name) => name !== "manifest.json"));
    for (const file of manifest.files) {
      expect(file.sha256).toBe(sha(files[file.path] ?? new Uint8Array()));
      expect(file.bytes).toBe(files[file.path]?.length);
    }
    expect(exported).toContain(sha(readFileSync(bundle)));
    expect(exported).toContain(sha(readFileSync(datasetZip)));
  });

  it("packs only what the engine reads of the dataset, with the Desk's config.json at its root", () => {
    expect(Object.keys(unzipSync(readFileSync(datasetZip))).sort()).toEqual([
      "config.json",
      "report/headlines.jsonl",
      "report/page1/brand/masthead.json",
      "report/page1/pages/kalpanik__p1.json",
      "report/page1/photos/kalpanik__p1/index.json",
      "work/kalpanik/measure.json",
    ]);
  });

  it("refuses to write over an earlier export, or into the repository", () => {
    const home = join(scratch, "home");
    const again = spawnSync("sh", [EXPORT, "--home", home, "--out", join(scratch, "out")], { encoding: "utf8" });
    expect(again.status).toBe(1);
    expect(again.stderr).toContain("exists already");
    const inside = spawnSync("sh", [EXPORT, "--home", home, "--out", join(REPO, "tmp-export")], { encoding: "utf8" });
    expect(inside.status).toBe(1);
    expect(inside.stderr).toContain("outside the repository");
    rmSync(join(REPO, "tmp-export"), { recursive: true, force: true });
  });
});

describe("import-desk", () => {
  it("a dry run counts and writes nothing", async () => {
    const before = await rowsOf(a);
    const report = await run(a, { dryRun: true });
    expect(report.counts.editions).toEqual({ found: 2, added: 2, existing: 0, skipped: 0 });
    expect(report.counts.stories).toEqual({ found: 4, added: 4, existing: 0, skipped: 0 });
    expect(report.files).toEqual([]);
    expect(await rowsOf(a)).toEqual(before);
  });

  it("imports editions, stories, photos, ads and the newest done run; every stored file matches the manifest", async () => {
    const report = await run(a);
    expect(report.counts).toEqual({
      editions: { found: 2, added: 2, existing: 0, skipped: 0 },
      stories: { found: 4, added: 4, existing: 0, skipped: 0 },
      photos: { found: 1, added: 1, existing: 0, skipped: 0 },
      ads: { found: 1, added: 1, existing: 0, skipped: 0 },
      runs: { found: 1, added: 1, existing: 0, skipped: 0 },
      pages: { found: 4, added: 4, existing: 0, skipped: 0 },
    });
    expect(report.samples).toBe(1);
    // the photo and ad originals, request.json, four pages × 4 files, edition.pdf and press-files.zip
    expect(report.files).toHaveLength(2 + 1 + 16 + 2);
    for (const file of report.files) expect(file.stored).toBe(file.manifest);

    const stories = await su.query(
      `select s.desk_key, s.status, s.priority, s.page_pin, s.language, s.origin, r.rev, r.headline, r.body_format,
         r.words, e.desk_key as edition
       from app.story s join app.story_revision r on r.story_id = s.id join app.edition e on e.id = s.edition_id
       where s.org_id = $1 order by s.desk_key`,
      [a.orgId],
    );
    expect(stories.rows).toMatchObject([
      { desk_key: "a-0000000001", status: "placed", priority: 1, language: "mr", origin: "typed", rev: 1, edition: ED },
      { desk_key: "a-0000000002", status: "ready", language: "en", headline: "Fictional market opens", words: 6 },
      { desk_key: "a-0000000003", status: "placed", page_pin: 2, origin: "pasted" },
      { desk_key: "a-0000000005", status: "ready", edition: "2026-10-22" },
    ]);
    const edition = await su.query("select * from app.edition where org_id = $1 and desk_key = $2", [a.orgId, ED]);
    expect(edition.rows[0]).toMatchObject({ pages: 4, volume: "वर्ष १", issue: "अंक २", produced_in: "desk" });

    const photo = await su.query(
      `select a.desk_key, a.width_px, a.height_px, a.mime, a.status, sp.caption, sp.credit
       from app.story_photo sp join app.asset a on a.id = sp.asset_id where sp.org_id = $1`,
      [a.orgId],
    );
    expect(photo.rows).toEqual([
      {
        desk_key: "p-0000000001",
        width_px: 40,
        height_px: 30,
        mime: "image/png",
        status: "received",
        caption: "नवा पूल",
        credit: "काल्पनिक छायाचित्रकार",
      },
    ]);
    const jobs = await su.query<{ task: string; key: string }>(
      `select t.identifier as task, j.key from queue._private_jobs j join queue._private_tasks t on t.id = j.task_id
       where j.payload->>'org_id' = $1 order by t.identifier`,
      [a.orgId],
    );
    expect(jobs.rows.map((job) => job.task)).toEqual(["media.ad", "media.ingest", "media.ingest"]);
    const slot = await su.query("select slot, w_mm, h_mm, state from app.ad_slot_artwork where org_id = $1", [a.orgId]);
    expect(slot.rows).toEqual([{ slot: "back-1", w_mm: "250.00", h_mm: "120.50", state: "preparing" }]);

    const layout = await su.query("select * from app.layout_run where org_id = $1", [a.orgId]);
    expect(layout.rows[0]).toMatchObject({
      desk_key: RUN,
      state: "done",
      profile_id: null,
      engine_version: "desk-engine/fictional",
      request_sha256: sha(readFileSync(join(scratch, "home/editions", ED, "runs", RUN, "request.json"))),
      not_placed: [{ article: "a-0000000002", reason: { text: "It did not fit.", code: null, params: null } }],
      timings: { measure_s: 10, plan_s: 2, layout_s: 500 },
      ad_rasters: { "back-1": sha("the run's ad raster") },
    });
    expect(layout.rows[0].request_version_id).toBeTruthy();
    expect(layout.rows[0].edition_pdf.key).toBe(
      `orgs/${a.orgId}/pubs/${a.pubId}/runs/${layout.rows[0].id}/edition.pdf`,
    );
    const pages = await su.query(
      "select page_no, role, state, articles, pdf, checked, warnings from app.run_page where org_id = $1 order by page_no",
      [a.orgId],
    );
    expect(pages.rows.map((p) => [p.page_no, p.role, p.state, p.articles])).toEqual([
      [1, "front", "done", ["a-0000000001"]],
      [2, "inside", "done", ["a-0000000003"]],
      [3, "inside", "done", []],
      [4, "back", "done", []],
    ]);
    expect(pages.rows[0].pdf.key).toMatch(/\/runs\/[0-9a-f-]{36}\/pages\/01\/page\.pdf$/);
    expect(pages.rows[0].checked).toEqual({ passed: true, fails: 0, warnings: 1 });
    expect(pages.rows[3].warnings).toEqual([{ text: "The page is not full.", code: "m.warn.notFill", params: {} }]);
    const checks = await su.query("select passed, warnings, report_key from app.pdf_check where org_id = $1", [
      a.orgId,
    ]);
    expect(checks.rows).toHaveLength(4);
    expect(checks.rows[0].report_key).toMatch(/pdfx-check\.txt$/);

    const audit = await su.query<{ action: string; actor_kind: string; actor_id: string }>(
      "select action, actor_kind, actor_id from app.audit_event where org_id = $1 and action like 'desk_import.%'",
      [a.orgId],
    );
    const actions = audit.rows.map((row) => row.action).sort();
    expect(actions.filter((x) => x === "desk_import.story")).toHaveLength(4);
    expect(actions).toEqual(
      expect.arrayContaining([
        "desk_import.edition",
        "desk_import.asset",
        "desk_import.ad_slot",
        "desk_import.run",
        "desk_import.done",
      ]),
    );
    expect(new Set(audit.rows.map((row) => `${row.actor_kind} ${row.actor_id}`))).toEqual(
      new Set([`import ${ownerA}`]),
    );
  });

  it("a second import changes nothing and says so", async () => {
    const before = await rowsOf(a);
    const report = await run(a);
    for (const kind of ["editions", "stories", "ads", "runs"] as const) expect(report.counts[kind].added).toBe(0);
    expect(report.counts.editions.existing).toBe(2);
    expect(report.counts.stories.existing).toBe(4);
    expect(report.files).toEqual([]);
    expect(await rowsOf(a)).toEqual(before);
  });

  it("--all-runs adds the earlier, failed run (without pages)", async () => {
    const report = await run(a, { allRuns: true });
    expect(report.counts.runs).toEqual({ found: 2, added: 1, existing: 1, skipped: 0 });
    const old = await su.query(
      "select state, error, ad_rasters from app.layout_run where org_id = $1 and desk_key = $2",
      [a.orgId, OLD_RUN],
    );
    // a run without its own ads folder keeps no record of what its pages print
    expect(old.rows[0]).toMatchObject({
      state: "failed",
      error: { text: "The layout engine stopped." },
      ad_rasters: null,
    });
  });

  it("takes the sample articles when asked", async () => {
    const pub = await n.addPublication(a, "Second fictional paper");
    await su.query("update app.publication set languages = '{mr,en}', primary_language = 'mr' where id = $1", [pub]);
    const report = await run({ ...a, pubId: pub }, { includeSamples: true });
    expect(report.counts.stories).toEqual({ found: 5, added: 5, existing: 0, skipped: 0 });
    // no profile in that publication: the ad's picture is imported, its slot is not
    expect(report.counts.ads).toEqual({ found: 1, added: 0, existing: 0, skipped: 1 });
  });

  it("refuses a bundle whose file does not match the manifest, and writes nothing", async () => {
    const files = unzipSync(readFileSync(bundle));
    files[`editions/${ED}/articles.json`] = strToU8('{"articles": []}');
    const tampered = join(scratch, "tampered.zip");
    writeFileSync(tampered, zipSync(files));
    const before = await rowsOf(b);
    await expect(run(b, { source: source(tampered), actorId: await n.userId(b.owner) })).rejects.toThrow(
      /articles\.json: its SHA-256 differs/,
    );
    const extra = { ...unzipSync(readFileSync(bundle)), "editions/2026-10-21/extra.txt": strToU8("x") };
    writeFileSync(tampered, zipSync(extra));
    await expect(run(b, { source: source(tampered), actorId: await n.userId(b.owner) })).rejects.toThrow(
      /extra\.txt: not in the manifest/,
    );
    await expect(
      run(b, { source: source(join(scratch, "home/config.json")), actorId: await n.userId(b.owner) }),
    ).rejects.toBeInstanceOf(ImportRefused);
    expect(await rowsOf(b)).toEqual(before);
  });

  it("cannot import into another organisation's publication", async () => {
    const before = await rowsOf(b);
    await expect(run(a, { pubId: b.pubId })).rejects.toThrow(/not one of this organisation's/);
    // nor as a person of another organisation
    await expect(run(b, { actorId: ownerA })).rejects.toThrow(/not an active person/);
    expect(await rowsOf(b)).toEqual(before);
  });

  it("the command prints the counts of a dry run", () => {
    const run_ = inject("database");
    const storage = inject("storage");
    const made = spawnSync(
      process.execPath,
      ["scripts/import-desk.ts", "--org", b.orgId, "--pub", b.pubId, "--bundle", bundle, "--dry-run"],
      {
        cwd: API,
        encoding: "utf8",
        env: {
          PATH: process.env["PATH"],
          PGN_LOG_LEVEL: "silent",
          PGN_ALLOWED_ORIGINS: ORIGIN,
          PGN_DB_HOST: run_.host,
          PGN_DB_PORT: String(run_.port),
          PGN_DB_NAME: db.name,
          PGN_APP_PASSWORD: run_.passwords.app,
          PGN_AUTH_PASSWORD: run_.passwords.auth,
          PGN_LISTEN_PASSWORD: run_.passwords.listen,
          PGN_AUTH_SECRET: SECRET,
          PGN_S3_ENDPOINT: storage.endpoint,
          PGN_S3_ACCESS_KEY_ID: storage.accessKeyId,
          PGN_S3_SECRET_ACCESS_KEY: storage.secretAccessKey,
          PGN_S3_WORK_BUCKET: storage.bucket,
        },
      },
    );
    expect(made.status, made.stderr).toBe(0);
    expect(made.stdout).toContain(`Bundle SHA-256 ${sha(readFileSync(bundle))} (dry run: nothing was written)`);
    expect(made.stdout).toMatch(/stories\s+4\s+4\s+0\s+0/);
    expect(made.stdout).toContain("Sample articles left out: 1");
  });
});
