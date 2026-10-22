// Makes the development buckets on SeaweedFS (docs/product/10-l2-newsroom-plan.md §6.1, §6.5), and leaves them as
// they are when they exist:
//   - the work bucket, with versioning, and a lifecycle rule that deletes uploads/ after a day (uploads never
//     completed; completed ones are copied out to their asset key);
//   - the archive bucket, with Object Lock enabled at creation (SeaweedFS needs it then; releases use it from L2.5).
// It prints what it did and what the store refused (SeaweedFS may not support every setting: see its output).
import {
  BucketAlreadyOwnedByYou,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketLifecycleConfigurationCommand,
  PutBucketVersioningCommand,
} from "@aws-sdk/client-s3";
import { ConfigError, loadStorageConfig } from "../src/config.ts";
import { s3Client } from "../src/storage/s3.ts";

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
await setting("uploads/ deleted after a day", () =>
  client.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: workBucket,
      LifecycleConfiguration: {
        Rules: [
          {
            ID: "uploads-one-day",
            Status: "Enabled",
            Filter: { Prefix: "uploads/" },
            Expiration: { Days: 1 },
          },
        ],
      },
    }),
  ),
);
await make(archiveBucket, true);
