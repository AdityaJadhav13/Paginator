// Photo uploads (src/modules/media; docs/product/10-l2-newsroom-plan.md §5.2, §6) on a migrated clone and the run's
// own bucket on the development SeaweedFS, through the API's own routes and the store's presigned POSTs. Every
// picture is fictional, made byte by byte (test/support/pictures.ts).
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  GetBucketLifecycleConfigurationCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { freshDatabase } from "./helpers.ts";
import { FROM_APP, type IdentityApp, identityApp } from "./identity-app.ts";
import { type Org, type Person, newsroom } from "./newsroom.ts";
import { type StorageConfig, s3Store } from "../../src/storage/s3.ts";
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

/** The run's store as the API's own adapter, on the run's bucket. */
function storageConfig(bucketName = bucket()): StorageConfig {
  const storage = inject("storage");
  return {
    endpoint: storage.endpoint,
    region: "ap-south-1",
    accessKeyId: storage.accessKeyId,
    secretAccessKey: storage.secretAccessKey,
    forcePathStyle: true,
    workBucket: bucketName,
    archiveBucket: bucketName,
  };
}

/** Every version and delete marker of exactly this key. */
async function versionsOf(key: string): Promise<number> {
  const listed = await s3.send(new ListObjectVersionsCommand({ Bucket: bucket(), Prefix: key }));
  return [...(listed.Versions ?? []), ...(listed.DeleteMarkers ?? [])].filter((v) => v.Key === key).length;
}

/** The POST policy's conditions, as the store reads them. */
function conditions(policy: { fields: Record<string, string> }): unknown[] {
  return JSON.parse(Buffer.from(policy.fields.Policy ?? "", "base64").toString("utf8")).conditions;
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
    expect(rows[0]).toMatchObject({ user_id: photo.id, status: "presigned", declared_bytes: "1234" }); // bigint (a dataset bundle may be 4 GiB)
    expect(rows[0].key).toBe(`uploads/orgs/${a.orgId}/pubs/${a.pubId}/${body.uploadId}`);
    expect(body.fields).toMatchObject({
      key: rows[0].key,
      "Content-Type": "image/jpeg",
      "x-amz-meta-upload-id": body.uploadId,
    });
    // exactly the declared size, the size the quota counts (F1)
    expect(conditions(body)).toContainEqual(["content-length-range", 1234, 1234]);
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

  it("counts 60 an hour exactly, however many come at once (F3)", async () => {
    const busy = await n.member(a, [{ publicationId: a.pubId, roles: ["reporter"], grants: [] }], "member", "many");
    const answers = await Promise.all(Array.from({ length: 90 }, () => presign(busy.cookie, 10)));
    const counts = answers.reduce<Record<number, number>>((tally, res) => {
      tally[res.statusCode] = (tally[res.statusCode] ?? 0) + 1;
      return tally;
    }, {});
    expect(counts).toEqual({ 201: 60, 429: 30 });
    const { rows } = await su.query("select count(*)::int as n from app.upload where user_id = $1", [busy.id]);
    expect(rows).toEqual([{ n: 60 }]);
  }, 60_000);

  it("stops the organisation at 2 GB a day, counted across its publications", async () => {
    const org = await n.organisation();
    const second = await n.addPublication(org, "Kalpaniknagar Evening (fictional)");
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
    // the second publication shares the organisation's day
    const over = await change("POST", `/api/v1/orgs/${org.orgId}/pubs/${second}/uploads`, org.ownerCookie, {
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
  it("refuses another size than declared, another key, another type and other metadata", async () => {
    const file = jpeg(10, 10);
    const policy = (await presign(photo.cookie, file.length)).json();
    const other = { ...policy, fields: { ...policy.fields, key: `${policy.fields.key}-elsewhere` } };
    expect((await send(other, file)).status).toBe(403);
    const typed = { ...policy, fields: { ...policy.fields, "Content-Type": "text/html" } };
    expect((await send(typed, file)).status).toBe(403);
    const tagged = { ...policy, fields: { ...policy.fields, "x-amz-meta-upload-id": "someone-else" } };
    expect((await send(tagged, file)).status).toBe(403);
    const untagged = { ...policy.fields };
    delete untagged["x-amz-meta-upload-id"];
    expect((await send({ ...policy, fields: untagged }, file)).status).toBe(403);
    const longer = await send(policy, Uint8Array.from([...file, 0]));
    expect([longer.status, longer.text.includes("EntityTooLarge")]).toEqual([400, true]);
    const shorter = await send(policy, file.slice(0, -1));
    expect([shorter.status, shorter.text.includes("EntityTooSmall")]).toEqual([400, true]);
    const big = await send(policy, new Uint8Array(41_943_041));
    expect(big.status).toBe(400);
    expect(await exists(policy.fields.key)).toBe(false);
    expect(await exists(`${policy.fields.key}-elsewhere`)).toBe(false);
    expect((await send(policy, file)).status).toBe(204); // the policy itself still works
  });

  it("refuses a policy once it has expired", async () => {
    const store = s3Store(storageConfig());
    const key = `uploads/expiry-${Date.now()}`;
    const file = jpeg(10, 10);
    const policy = await store.presignPost({
      key,
      contentType: "image/jpeg",
      bytes: file.length,
      expiresSeconds: 1,
      metadata: { "upload-id": "expiry" },
    });
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const late = await send(policy, file);
    expect(late.status).toBe(403);
    expect(await exists(key)).toBe(false);
  });

  it("keeps the uploads/ rules: expiry after a day, old versions and lone delete markers removed (F2)", async () => {
    const rules = (await s3.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket() }))).Rules ?? [];
    expect(rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ID: "uploads-one-day",
          Expiration: expect.objectContaining({ Days: 1 }),
          NoncurrentVersionExpiration: expect.objectContaining({ NoncurrentDays: 1 }),
        }),
        expect.objectContaining({
          ID: "uploads-delete-markers",
          Expiration: expect.objectContaining({ ExpiredObjectDeleteMarker: true }),
        }),
      ]),
    );
  });

  it("is ready only when the bucket keeps versions (F5)", async () => {
    expect(await s3Store(storageConfig()).ready()).toBe(true);
    const plain = `${bucket()}-plain`;
    await s3.send(new CreateBucketCommand({ Bucket: plain }));
    try {
      expect(await s3Store(storageConfig(plain)).ready()).toBe(false);
    } finally {
      await s3.send(new DeleteBucketCommand({ Bucket: plain }));
    }
    expect(await s3Store(storageConfig(`${bucket()}-missing`)).ready()).toBe(false);
  });
});

describe("complete", () => {
  it("reads the picture, makes an asset copied out of quarantine with its SHA-256, and deletes every version of the upload", async () => {
    const file = jpeg(4000, 3000, 0, 1);
    const { policy, complete } = await upload(photo.cookie, file);
    expect((await send(policy, file)).status).toBe(204); // sent again under the same policy: a second version
    expect(await versionsOf(policy.fields.key)).toBe(2);
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
    expect(await versionsOf(policy.fields.key)).toBe(0); // no version, and no delete marker over one (F2)
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

  it("refuses a file that is not a picture, HEIC by name, and deletes every version of it", async () => {
    const fake = await upload(photo.cookie, new TextEncoder().encode("<html>not a photo</html>"));
    const refused = await fake.complete();
    expect([refused.statusCode, refused.json().error.code]).toEqual([422, "not_a_picture"]);
    expect(await versionsOf(fake.policy.fields.key)).toBe(0);
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

  it("refuses a file of another size than declared, whatever put it there (F1)", async () => {
    const policy = (await presign(photo.cookie, 100)).json();
    const file = jpeg(640, 480, 0, 50);
    // written past the policy (as only the store's own keys could): the API still checks the size it counted
    await s3.send(
      new PutObjectCommand({ Bucket: bucket(), Key: policy.fields.key, Body: file, ContentType: "image/jpeg" }),
    );
    const refused = await call("POST", `${uploads()}/${policy.uploadId}/complete`, photo.cookie);
    expect([refused.statusCode, refused.json().error.code]).toEqual([422, "not_a_picture"]);
    expect(refused.json().error.details[0].message).toContain(`${file.length} bytes, not the 100`);
    const { rows } = await su.query("select status from app.upload where id = $1", [policy.uploadId]);
    expect(rows).toEqual([{ status: "rejected" }]);
    expect(await versionsOf(policy.fields.key)).toBe(0);
  });

  it("refuses a side over 100000 pixels, and the upload is done with (F7)", async () => {
    const long = await upload(photo.cookie, png(200_000, 1), "image/png");
    const refused = await long.complete();
    expect([refused.statusCode, refused.json().error.details[0].message]).toEqual([
      422,
      "The file was refused: a side is over 100000 pixels.",
    ]);
    expect((await long.complete()).statusCode).toBe(422); // not read again: it is rejected
  });

  it("finds a JPEG's size after several MB of EXIF (F7)", async () => {
    const file = jpeg(2400, 1600, 3 * 1024 * 1024, 51);
    const done = await (await upload(photo.cookie, file)).complete();
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json().asset).toMatchObject({ widthPx: 2400, heightPx: 1600, bytes: file.length });
  }, 30_000);

  it("makes one asset when the same new bytes are completed twice at once, and a new one after a rejected one (F7)", async () => {
    const file = jpeg(900, 600, 0, 52);
    const [first, second] = [await upload(photo.cookie, file), await upload(photo.cookie, file)];
    const [one, two] = await Promise.all([first.complete(), second.complete()]);
    expect([one.statusCode, two.statusCode]).toEqual([200, 200]);
    expect(two.json().asset.id).toBe(one.json().asset.id);
    await su.query("update app.asset set status = 'rejected' where id = $1", [one.json().asset.id]);
    const again = await (await upload(photo.cookie, file)).complete();
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json().asset.id).not.toBe(one.json().asset.id);
  });

  it("answers 400 before the file has arrived", async () => {
    const policy = (await presign(photo.cookie, 100)).json();
    const early = await call("POST", `${uploads()}/${policy.uploadId}/complete`, photo.cookie);
    expect(early.statusCode).toBe(400);
  });
});

const stories = (pub = a.pubId) => `/api/v1/orgs/${a.orgId}/pubs/${pub}/stories`;
const fileOf = (assetId: string, pub = a.pubId, variant = "original") =>
  `/api/v1/orgs/${a.orgId}/pubs/${pub}/assets/${assetId}/file?variant=${variant}`;

async function asset(cookie: string, seed: number, pub = a.pubId) {
  const done = await (await upload(cookie, jpeg(1200, 800, 0, seed), "image/jpeg", pub)).complete();
  expect(done.statusCode, done.body).toBe(200);
  return done.json().asset as { id: string; sha256: string; bytes: number };
}

async function story(cookie: string, pub = a.pubId) {
  const made = await change("POST", stories(pub), cookie, {
    headline: "A story with a photo (fictional)",
    body: "Short.",
  });
  expect(made.statusCode, made.body).toBe(201);
  return made.json();
}

describe("a story's photo", () => {
  it("is set, captioned and taken off by whoever edits the story, each a change of its version", async () => {
    const mine = await story(reporter.cookie);
    const picture = await asset(reporter.cookie, 10);
    const url = `${stories()}/${mine.id}/photo`;
    const set = await call("PUT", url, reporter.cookie, {
      baseRevision: mine.revision,
      assetId: picture.id,
      caption: "  Rain on the ghats\u0007 ",
      credit: "Photo (fictional)",
    });
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json()).toMatchObject({
      revision: mine.revision + 1,
      isBrief: false,
      photo: {
        assetId: picture.id,
        caption: "Rain on the ghats",
        credit: "Photo (fictional)",
        status: "received",
        widthPx: 1200,
        heightPx: 800,
        previewUrl: null,
      },
    });
    expect(
      (await call("PUT", url, reporter.cookie, { baseRevision: mine.revision, assetId: picture.id })).statusCode,
    ).toBe(409);
    const captioned = await call("PATCH", url, reporter.cookie, {
      baseRevision: mine.revision + 1,
      caption: "Ghats in the rain",
    });
    expect(captioned.json().photo.caption).toBe("Ghats in the rain");
    const off = await call("DELETE", `${url}?baseRevision=${mine.revision + 2}`, reporter.cookie);
    expect([off.statusCode, off.json().photo]).toEqual([200, null]);
    expect((await call("DELETE", `${url}?baseRevision=${mine.revision + 3}`, reporter.cookie)).statusCode).toBe(404);
  });

  it("is a Photo Editor's to set on any story they see but a spiked one; never a picture of another publication", async () => {
    const theirs = await story(reporter.cookie);
    const picture = await asset(photo.cookie, 11);
    const url = `${stories()}/${theirs.id}/photo`;
    const set = await call("PUT", url, photo.cookie, { baseRevision: theirs.revision, assetId: picture.id });
    expect(set.statusCode).toBe(200);
    const other = await asset(photo.cookie, 12, p2);
    const wrong = await call("PUT", url, photo.cookie, { baseRevision: set.json().revision, assetId: other.id });
    expect([wrong.statusCode, wrong.json().error.details[0].field]).toEqual([400, "body.assetId"]);
    expect(
      (await call("PUT", url, viewer.cookie, { baseRevision: set.json().revision, assetId: picture.id })).statusCode,
    ).toBe(403);
    const owner = a.ownerCookie;
    const spiked = await change("POST", `${stories()}/${theirs.id}/transitions`, owner, {
      to: "spiked",
      baseRevision: set.json().revision,
    });
    expect(spiked.statusCode).toBe(200);
    expect(
      (await call("PUT", url, photo.cookie, { baseRevision: spiked.json().revision, assetId: picture.id })).statusCode,
    ).toBe(403);
  });
});

describe("a Reporter and someone else's picture (F4)", () => {
  it("cannot attach a picture they may not download: 404, as if there were none", async () => {
    const mine = await story(reporter.cookie);
    const someoneElses = await asset(photo.cookie, 60);
    const res = await call("PUT", `${stories()}/${mine.id}/photo`, reporter.cookie, {
      baseRevision: mine.revision,
      assetId: someoneElses.id,
    });
    expect([res.statusCode, res.json().error.code]).toEqual([404, "not_found"]);
    const { rows } = await su.query("select count(*)::int as n from app.story_photo where story_id = $1", [mine.id]);
    expect(rows).toEqual([{ n: 0 }]);
  });

  it("has a picture they uploaded again (the same bytes, one asset): they download and attach it", async () => {
    const file = jpeg(1000, 700, 0, 61);
    const first = (await (await upload(photo.cookie, file)).complete()).json().asset;
    const theirs = await (await upload(reporter.cookie, file)).complete();
    expect(theirs.json().asset.id).toBe(first.id);
    expect((await call("GET", fileOf(first.id), reporter.cookie)).statusCode).toBe(302);
    const mine = await story(reporter.cookie);
    const set = await call("PUT", `${stories()}/${mine.id}/photo`, reporter.cookie, {
      baseRevision: mine.revision,
      assetId: first.id,
    });
    expect(set.statusCode, set.body).toBe(200);
  });
});

describe("a store that gives no version (F5)", () => {
  it("refuses to complete before reading or copying anything: no asset, and the upload stays as it was", async () => {
    const used: string[] = [];
    const versionless = await identityApp(db, {}, (store) => ({
      ...store,
      head: async (key) => {
        const head = await store.head(key);
        return head && { ...head, versionId: undefined };
      },
      read: (key, version) => (used.push("read"), store.read(key, version)),
      copy: (input) => (used.push("copy"), store.copy(input)),
    }));
    try {
      const file = jpeg(300, 200, 0, 70);
      const policy = (await presign(photo.cookie, file.length)).json();
      expect((await send(policy, file)).status).toBe(204);
      const res = await versionless.app.inject({
        method: "POST",
        url: `${uploads()}/${policy.uploadId}/complete`,
        headers: { cookie: photo.cookie, ...FROM_APP },
        payload: {},
      });
      expect(res.statusCode).toBe(500);
      const { rows } = await su.query("select status, asset_id from app.upload where id = $1", [policy.uploadId]);
      expect(rows).toEqual([{ status: "presigned", asset_id: null }]);
      expect(used).toEqual([]);
    } finally {
      await versionless.close();
    }
  });
});

describe("downloads", () => {
  it("redirect to a 5-minute link of the picture's own version, with its type and a Desk file name", async () => {
    const picture = await asset(photo.cookie, 20);
    const res = await call("GET", fileOf(picture.id), a.ownerCookie);
    expect(res.statusCode).toBe(302);
    expect(res.headers["cache-control"]).toBe("no-store");
    const link = new URL(String(res.headers.location));
    expect(link.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(link.searchParams.get("versionId")).not.toBeNull();
    const got = await fetch(link);
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("image/jpeg");
    expect(got.headers.get("content-disposition")).toMatch(/^attachment; filename="p-[0-9a-f]{10}\.jpg"$/);
    const bytes = new Uint8Array(await got.arrayBuffer());
    expect(bytes.length).toBe(picture.bytes);
    expect((await call("GET", fileOf(picture.id, a.pubId, "preview"), a.ownerCookie)).statusCode).toBe(404);
  });

  it("let a Reporter download only the pictures they uploaded or that are their stories' photos", async () => {
    const theirs = await asset(reporter.cookie, 21);
    const someoneElses = await asset(photo.cookie, 22);
    expect((await call("GET", fileOf(theirs.id), reporter.cookie)).statusCode).toBe(302);
    expect((await call("GET", fileOf(someoneElses.id), reporter.cookie)).statusCode).toBe(404);
    const mine = await story(reporter.cookie);
    await call("PUT", `${stories()}/${mine.id}/photo`, photo.cookie, {
      baseRevision: mine.revision,
      assetId: someoneElses.id,
    });
    expect((await call("GET", fileOf(someoneElses.id), reporter.cookie)).statusCode).toBe(302);
    expect((await call("GET", fileOf(someoneElses.id), viewer.cookie)).statusCode).toBe(302);
    const ads = await n.member(a, [{ publicationId: a.pubId, roles: ["advertising"], grants: [] }], "member", "ads");
    expect((await call("GET", fileOf(someoneElses.id), ads.cookie)).statusCode).toBe(403);
  });
});

describe("storage tenancy (d): every media route with another tenant's ids answers 404", () => {
  it("walks the route table: another organisation, another publication, another publication's ids", async () => {
    // the news finder's found-photo route has its own walls' test (news-finder.test.ts)
    const routes = it_.app.apiRoutes.filter(
      (route) =>
        /\/(uploads|assets|photo)\b/.test(route.url) && !route.url.includes("/news/") && route.method !== "HEAD",
    );
    expect(routes.length).toBeGreaterThanOrEqual(6);
    const b = await n.organisation();
    const bUrl = (path: string) => `/api/v1/orgs/${b.orgId}/pubs/${b.pubId}${path}`;
    const bUpload = (
      await change("POST", bUrl("/uploads"), b.ownerCookie, {
        purpose: "story_photo",
        filename: "b.jpg",
        contentType: "image/jpeg",
        bytes: 100,
      })
    ).json();
    const bStory = (await change("POST", bUrl("/stories"), b.ownerCookie, { headline: "B's story" })).json();
    const p2Asset = await asset(photo.cookie, 30, p2);
    const p2Story = await story(a.ownerCookie, p2);
    const p2Upload = (await presign(a.ownerCookie, 100, "image/jpeg", p2)).json();
    const cases = [
      { label: "B's organisation", o: b.orgId, p: b.pubId, u: bUpload.uploadId, a: p2Asset.id, s: bStory.id },
      { label: "B's publication under A", o: a.orgId, p: b.pubId, u: bUpload.uploadId, a: p2Asset.id, s: bStory.id },
      {
        label: "B's ids under A's publication",
        o: a.orgId,
        p: a.pubId,
        u: bUpload.uploadId,
        a: p2Asset.id,
        s: bStory.id,
      },
      {
        label: "A's second publication's ids under the first",
        o: a.orgId,
        p: a.pubId,
        u: p2Upload.uploadId,
        a: p2Asset.id,
        s: p2Story.id,
      },
    ];
    const failures: string[] = [];
    for (const route of routes) {
      for (const c of cases) {
        const params: Record<string, string> = { o: c.o, p: c.p, u: c.u, a: c.a, s: c.s };
        let url = route.url.replace(/:([a-z]+)/g, (_, name: string) => {
          if (!(name in params)) failures.push(`${route.url} has a parameter :${name} with no fixture`);
          return params[name] ?? "";
        });
        if (route.method === "DELETE") url += "?baseRevision=1";
        const payload =
          route.method === "PUT"
            ? { baseRevision: 1, assetId: c.a }
            : route.method === "PATCH"
              ? { baseRevision: 1, caption: "x" }
              : url.endsWith("/uploads")
                ? { purpose: "story_photo", filename: "x.jpg", contentType: "image/jpeg", bytes: 10 }
                : route.method === "POST"
                  ? {}
                  : undefined;
        const res = await change(route.method as "GET", url, a.ownerCookie, payload);
        if (url.endsWith("/uploads") && c.o === a.orgId && c.p === a.pubId) continue; // A's own collection
        if (res.statusCode !== 404) failures.push(`${route.method} ${route.url} with ${c.label}: ${res.statusCode}`);
      }
    }
    expect(failures).toEqual([]);
    const { rows } = await su.query("select status from app.upload where id = any($1) order by id", [
      [bUpload.uploadId, p2Upload.uploadId].sort(),
    ]);
    expect(rows).toEqual([{ status: "presigned" }, { status: "presigned" }]);
  });
});

describe("every role against the media routes (07 §12)", () => {
  it("matches the expected table", async () => {
    const on = (role: string) => [{ publicationId: a.pubId, roles: [role], grants: [] }];
    const people: Record<string, Person> = {
      chief: await n.member(a, on("chief_editor"), "member", "chief"),
      editor: await n.member(a, on("editor"), "member", "editor"),
      sub: await n.member(a, on("sub_editor"), "member", "sub"),
      reporter,
      designer: await n.member(a, on("page_designer"), "member", "designer"),
      photo,
      ads: await n.member(a, on("advertising"), "member", "advertising"),
      prepress: await n.member(a, on("prepress"), "member", "prepress"),
      viewer,
    };
    const shared = await asset(photo.cookie, 40);
    const EXPECT: Record<string, Record<string, number>> = {
      // presign: media.upload (Reporter ◐ own); download: media.view (a Reporter: not a picture of theirs, 404);
      // attach, on the Owner's story: whoever edits it, or a Photo Editor (a Reporter does not see it: 404)
      presign: {
        chief: 201,
        editor: 201,
        sub: 201,
        reporter: 201,
        designer: 403,
        photo: 201,
        ads: 403,
        prepress: 403,
        viewer: 403,
      },
      download: {
        chief: 302,
        editor: 302,
        sub: 302,
        reporter: 404,
        designer: 302,
        photo: 302,
        ads: 403,
        prepress: 302,
        viewer: 302,
      },
      attach: {
        chief: 200,
        editor: 200,
        sub: 200,
        reporter: 404,
        designer: 403,
        photo: 200,
        ads: 403,
        prepress: 403,
        viewer: 403,
      },
    };
    const mismatches: string[] = [];
    for (const [who, person] of Object.entries(people)) {
      const target = await story(a.ownerCookie);
      const answers: Record<string, number> = {
        presign: (await presign(person.cookie, 10)).statusCode,
        download: (await call("GET", fileOf(shared.id), person.cookie)).statusCode,
        attach: (
          await call("PUT", `${stories()}/${target.id}/photo`, person.cookie, {
            baseRevision: target.revision,
            assetId: shared.id,
          })
        ).statusCode,
      };
      for (const [what, status] of Object.entries(answers)) {
        if (status !== EXPECT[what]?.[who])
          mismatches.push(`${who} ${what}: ${status}, expected ${EXPECT[what]?.[who]}`);
      }
    }
    expect(mismatches).toEqual([]);
  }, 120_000);
});
