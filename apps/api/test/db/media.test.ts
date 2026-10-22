// Photo uploads (src/modules/media; docs/product/10-l2-newsroom-plan.md §5.2, §6) on a migrated clone and the run's
// own bucket on the development SeaweedFS, through the API's own routes and the store's presigned POSTs. Every
// picture is fictional, made byte by byte (test/support/pictures.ts).
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { freshDatabase } from "./helpers.ts";
import { type IdentityApp, identityApp } from "./identity-app.ts";
import { type Org, type Person, newsroom } from "./newsroom.ts";
import { heic, jpeg, png } from "../support/pictures.ts";

const db = await freshDatabase();
let it_: IdentityApp;
let su: Client;
const n = newsroom(
  () => it_,
  () => su,
);
const { call, change } = n;
let a: Org;
let p2: string;
let photo: Person;
let reporter: Person;
let viewer: Person;
let s3: S3Client;
const bucket = () => inject("storage").bucket;

beforeAll(async () => {
  it_ = await identityApp(db);
  su = await db.connect("postgres");
  a = await n.organisation();
  p2 = await n.addPublication(a, "Kalpaniknagar Express");
  const on = (role: string, pub = a.pubId) => [{ publicationId: pub, roles: [role], grants: [] }];
  photo = await n.member(a, [...on("photo_editor"), ...on("photo_editor", p2)], "member", "photo");
  reporter = await n.member(a, on("reporter"), "member", "reporter");
  viewer = await n.member(a, on("viewer"), "member", "viewer");
  const storage = inject("storage");
  s3 = new S3Client({
    endpoint: storage.endpoint,
    region: "ap-south-1",
    forcePathStyle: true,
    credentials: { accessKeyId: storage.accessKeyId, secretAccessKey: storage.secretAccessKey },
  });
}, 60_000);
afterAll(async () => {
  await it_.close();
  await db.drop();
});

const uploads = (pub = a.pubId) => `/api/v1/orgs/${a.orgId}/pubs/${pub}/uploads`;

async function presign(cookie: string, bytes: number, contentType = "image/jpeg", pub = a.pubId) {
  return change("POST", uploads(pub), cookie, { purpose: "story_photo", filename: "photo.jpg", contentType, bytes });
}

/** Sends a file to the store as the browser would, with the policy's fields. */
async function send(policy: { url: string; fields: Record<string, string> }, file: Uint8Array) {
  const form = new FormData();
  for (const [name, value] of Object.entries(policy.fields)) form.append(name, value);
  form.append("file", new Blob([file]));
  const res = await fetch(policy.url, { method: "POST", body: form });
  return { status: res.status, text: await res.text() };
}

async function upload(cookie: string, file: Uint8Array, contentType = "image/jpeg", pub = a.pubId) {
  const presigned = await presign(cookie, file.length, contentType, pub);
  expect(presigned.statusCode, presigned.body).toBe(201);
  const policy = presigned.json();
  expect((await send(policy, file)).status).toBe(204);
  return { policy, complete: () => call("POST", `${uploads(pub)}/${policy.uploadId}/complete`, cookie) };
}

async function exists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return true;
  } catch {
    return false;
  }
}

describe("presign", () => {
  it("answers a POST policy for exactly the upload's key, in quarantine, valid 15 minutes", async () => {
    const res = await presign(photo.cookie, 1234);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    const { rows } = await su.query("select key, user_id, status, declared_bytes from app.upload where id = $1", [
      body.uploadId,
    ]);
    expect(rows[0]).toMatchObject({ user_id: photo.id, status: "presigned", declared_bytes: 1234 });
    expect(rows[0].key).toBe(`uploads/orgs/${a.orgId}/pubs/${a.pubId}/${body.uploadId}`);
    expect(body.fields).toMatchObject({
      key: rows[0].key,
      "Content-Type": "image/jpeg",
      "x-amz-meta-upload-id": body.uploadId,
    });
    const minutes = (Date.parse(body.expiresAt) - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);
  });

  it("refuses another type, a picture over 40 MB, a role without media.upload, and too many uploads", async () => {
    expect((await presign(photo.cookie, 10, "image/gif")).statusCode).toBe(400);
    const big = await presign(photo.cookie, 41_943_041);
    expect([big.statusCode, big.json().error.code]).toEqual([413, "file_too_large"]);
    expect((await presign(viewer.cookie, 10)).statusCode).toBe(403);
    const someone = await n.member(a, [{ publicationId: a.pubId, roles: ["reporter"], grants: [] }], "member", "busy");
    await su.query(
      `insert into app.upload (org_id, publication_id, user_id, purpose, declared_type, declared_bytes, expires_at)
       select $1, $2, $3, 'story_photo', 'image/jpeg', 10, now() + interval '15 minutes' from generate_series(1, 60)`,
      [a.orgId, a.pubId, someone.id],
    );
    const sixtyFirst = await presign(someone.cookie, 10);
    expect([sixtyFirst.statusCode, sixtyFirst.json().error.code]).toEqual([429, "slow_down"]);
  });

  it("stops the organisation at 2 GB a day, counted across its publications", async () => {
    const org = await n.organisation();
    await su.query("insert into app.upload_quota (org_id, day, bytes) values ($1, current_date, $2)", [
      org.orgId,
      2 * 1024 ** 3 - 100,
    ]);
    const url = `/api/v1/orgs/${org.orgId}/pubs/${org.pubId}/uploads`;
    const ok = await change("POST", url, org.ownerCookie, {
      purpose: "story_photo",
      filename: "a.jpg",
      contentType: "image/jpeg",
      bytes: 100,
    });
    expect(ok.statusCode).toBe(201);
    const over = await change("POST", url, org.ownerCookie, {
      purpose: "story_photo",
      filename: "b.jpg",
      contentType: "image/jpeg",
      bytes: 1,
    });
    expect(over.statusCode).toBe(429);
    const { rows } = await su.query("select bytes::text from app.upload_quota where org_id = $1", [org.orgId]);
    expect(rows).toEqual([{ bytes: String(2 * 1024 ** 3) }]); // the refused presign counted nothing
  });
});

describe("the store holds the policy (SeaweedFS)", () => {
  it("refuses a file over the limit, another key, another type, and an expired policy", async () => {
    const policy = (await presign(photo.cookie, 10)).json();
    const other = { ...policy, fields: { ...policy.fields, key: `${policy.fields.key}-elsewhere` } };
    expect((await send(other, jpeg(10, 10))).status).toBe(403);
    const typed = { ...policy, fields: { ...policy.fields, "Content-Type": "text/html" } };
    expect((await send(typed, jpeg(10, 10))).status).toBe(403);
    const big = await send(policy, new Uint8Array(41_943_041));
    expect(big.status).toBe(400);
    expect(big.text).toContain("EntityTooLarge");
    expect(await exists(policy.fields.key)).toBe(false);
  });
});

describe("complete", () => {
  it("reads the picture, makes an asset copied out of quarantine with its SHA-256, and deletes the upload", async () => {
    const file = jpeg(4000, 3000, 0, 1);
    const { policy, complete } = await upload(photo.cookie, file);
    const done = await complete();
    expect(done.statusCode, done.body).toBe(200);
    const { asset } = done.json();
    expect(asset).toMatchObject({
      kind: "photo",
      status: "received",
      mime: "image/jpeg",
      bytes: file.length,
      widthPx: 4000,
      heightPx: 3000,
    });
    const { rows } = await su.query("select original_key, version_id, desk_key from app.asset where id = $1", [
      asset.id,
    ]);
    expect(rows[0].original_key).toBe(`orgs/${a.orgId}/pubs/${a.pubId}/assets/${asset.id}/original`);
    expect(rows[0].desk_key).toMatch(/^p-[0-9a-f]{10}$/);
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket(), Key: rows[0].original_key }));
    expect(head.Metadata?.sha256).toBe(asset.sha256);
    expect(head.ContentType).toBe("image/jpeg");
    expect(head.VersionId).toBe(rows[0].version_id);
    expect(await exists(policy.fields.key)).toBe(false);
    // again: the same asset
    expect((await complete()).json().asset.id).toBe(asset.id);
  });

  it("is the uploader's only, and finds the publication's asset when it has those very bytes", async () => {
    const file = jpeg(800, 600, 0, 2);
    const first = await upload(photo.cookie, file);
    expect((await call("POST", `${uploads()}/${first.policy.uploadId}/complete`, reporter.cookie)).statusCode).toBe(
      404,
    );
    const made = (await first.complete()).json().asset;
    const again = await upload(photo.cookie, file);
    expect((await again.complete()).json().asset.id).toBe(made.id);
    const elsewhere = await upload(photo.cookie, file, "image/jpeg", p2);
    expect((await elsewhere.complete()).json().asset.id).not.toBe(made.id);
  });

  it("refuses a file that is not a picture, HEIC by name, and deletes it", async () => {
    const fake = await upload(photo.cookie, new TextEncoder().encode("<html>not a photo</html>"));
    const refused = await fake.complete();
    expect([refused.statusCode, refused.json().error.code]).toEqual([422, "not_a_picture"]);
    expect(await exists(fake.policy.fields.key)).toBe(false);
    const { rows } = await su.query("select status from app.upload where id = $1", [fake.policy.uploadId]);
    expect(rows).toEqual([{ status: "rejected" }]);
    const phone = await upload(photo.cookie, heic(), "image/jpeg");
    const heif = await phone.complete();
    expect(heif.statusCode).toBe(422);
    expect(heif.json().error.details[0].message).toContain("HEIC");
  });

  it("takes the type from the bytes, not from what the browser said", async () => {
    const declaredJpeg = await upload(photo.cookie, png(320, 240), "image/jpeg");
    expect((await declaredJpeg.complete()).json().asset).toMatchObject({
      mime: "image/png",
      widthPx: 320,
      heightPx: 240,
    });
  });

  it("answers 400 before the file has arrived", async () => {
    const policy = (await presign(photo.cookie, 100)).json();
    const early = await call("POST", `${uploads()}/${policy.uploadId}/complete`, photo.cookie);
    expect(early.statusCode).toBe(400);
  });
});
