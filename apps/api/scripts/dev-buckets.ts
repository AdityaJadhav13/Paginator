// Makes the development buckets on SeaweedFS (docs/product/10-l2-newsroom-plan.md §6.1, §6.5) when they are missing,
// and sets the work bucket's versioning and rules each time:
//   - the work bucket, with versioning, and a lifecycle rule for uploads/ (quarantine): a day after a file arrives it
//     expires (a delete marker over it), a day later that old version is removed, and so is a delete marker left
//     alone. The API deletes every version of a completed or refused upload itself (src/modules/media/uploads.ts);
//     the rule takes what is left: uploads never completed, and files sent again under a policy after that.
//     SeaweedFS 4.48 accepts the rule; whether it deletes was not observed (11-fix-before-launch);
//   - the archive bucket, with Object Lock enabled at creation (SeaweedFS needs it then; releases use it from L2.5);
//   - when PGN_S3_CORS_ORIGIN names the app's origin (the pilot-local stack, infra/docker/compose.pilot.yml): the work
//     bucket's CORS rule for that origin (uploadsCors in src/storage/s3.ts), so the browser may upload to it;
//   - when PGN_S3_BACKUPS_BUCKET is set: the backups bucket, with Object Lock (apps/api/scripts/db-backup.ts).
// It prints what it did and what the store refused (SeaweedFS may not support every setting: see its output).
import {
  BucketAlreadyOwnedByYou,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutBucketLifecycleConfigurationCommand,
  PutBucketVersioningCommand,
} from "@aws-sdk/client-s3";
import { ConfigError, loadStorageConfig } from "../src/config.ts";
import { UPLOADS_LIFECYCLE, s3Client, uploadsCors } from "../src/storage/s3.ts";

let storage;
try {
  storage = loadStorageConfig(process.env);
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(error.message);
  process.exit(1);
}
if (!storage) {
  console.error("Set PGN_S3_ACCESS_KEY_ID and PGN_S3_SECRET_ACCESS_KEY (.env.dev) first.");
  process.exit(1);
}
const client = s3Client(storage);
const corsOrigin = process.env["PGN_S3_CORS_ORIGIN"] || undefined;
if (corsOrigin !== undefined && !(URL.canParse(corsOrigin) && new URL(corsOrigin).origin === corsOrigin)) {
  console.error("PGN_S3_CORS_ORIGIN must be an origin such as https://app.localhost:59443 (no path).");
  process.exit(1);
}
const backupsBucket = process.env["PGN_S3_BACKUPS_BUCKET"] || undefined;

async function make(bucket: string, objectLock: boolean): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log(`${bucket}: exists`);
    return;
  } catch {
    // make it
  }
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket, ObjectLockEnabledForBucket: objectLock }));
    console.log(`${bucket}: made${objectLock ? ", Object Lock enabled" : ""}`);
  } catch (error) {
    if (!(error instanceof BucketAlreadyOwnedByYou)) throw error;
  }
}

async function setting(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
    console.log(`  ${what}: on`);
  } catch (error) {
    console.log(`  ${what}: refused by the store (${(error as Error).name}: ${(error as Error).message})`);
  }
}

const { workBucket, archiveBucket } = storage;
await make(workBucket, false);
await setting("versioning", () =>
  client.send(new PutBucketVersioningCommand({ Bucket: workBucket, VersioningConfiguration: { Status: "Enabled" } })),
);
await setting("uploads/ expired after a day, old versions and lone delete markers removed", () =>
  client.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: workBucket,
      LifecycleConfiguration: {
        Rules: UPLOADS_LIFECYCLE,
      },
    }),
  ),
);
await make(archiveBucket, true);
if (corsOrigin !== undefined) {
  await setting(`CORS for ${corsOrigin}`, () =>
    client.send(
      new PutBucketCorsCommand({ Bucket: workBucket, CORSConfiguration: { CORSRules: uploadsCors(corsOrigin) } }),
    ),
  );
}
if (backupsBucket !== undefined) await make(backupsBucket, true);
