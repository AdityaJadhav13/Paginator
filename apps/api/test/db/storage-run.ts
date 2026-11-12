// The database tests' object store (no Vitest imports here: the global setup runs outside the tests): one bucket per
// run on the development SeaweedFS (pnpm dev:up), versioned and with the uploads/ rules like the work bucket, and an
// archive bucket with Object Lock (made at creation, as scripts/dev-buckets.ts makes it); both emptied and deleted at
// the end (the archive's locked versions with the governance bypass, which only the development key holds).
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectVersionsCommand,
  PutBucketLifecycleConfigurationCommand,
  PutBucketVersioningCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { loadStorageConfig } from "../../src/config.ts";
import { UPLOADS_LIFECYCLE, s3Client } from "../../src/storage/s3.ts";

export type TestStorage = {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  archiveBucket: string;
};

export async function makeRunBucket(run: string): Promise<{ storage: TestStorage; drop: () => Promise<void> }> {
  const config = loadStorageConfig(process.env);
  if (!config) {
    throw new Error(
      "The database tests need the object store: set PGN_S3_ACCESS_KEY_ID and PGN_S3_SECRET_ACCESS_KEY in .env.dev.",
    );
  }
  const bucket = run.replaceAll("_", "-");
  const client = s3Client(config);
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  await client.send(new PutBucketVersioningCommand({ Bucket: bucket, VersioningConfiguration: { Status: "Enabled" } }));
  await client.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: bucket,
      LifecycleConfiguration: { Rules: UPLOADS_LIFECYCLE },
    }),
  );
  const archiveBucket = `${bucket}-archive`;
  await client.send(new CreateBucketCommand({ Bucket: archiveBucket, ObjectLockEnabledForBucket: true }));
  return {
    storage: {
      endpoint: config.endpoint,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      bucket,
      archiveBucket,
    },
    drop: async () => {
      await dropBucket(client, bucket);
      await dropBucket(client, archiveBucket, true);
    },
  };
}

async function dropBucket(client: S3Client, bucket: string, locked = false): Promise<void> {
  for (;;) {
    const listed = await client.send(new ListObjectVersionsCommand({ Bucket: bucket }));
    const objects = [...(listed.Versions ?? []), ...(listed.DeleteMarkers ?? [])].map((v) => ({
      Key: v.Key ?? "",
      VersionId: v.VersionId,
    }));
    if (objects.length === 0) break;
    if (!locked) await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects } }));
    // a locked version goes only one at a time, with the governance bypass
    for (const object of locked ? objects : []) {
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: object.Key,
          VersionId: object.VersionId,
          BypassGovernanceRetention: true,
        }),
      );
    }
  }
  await client.send(new DeleteBucketCommand({ Bucket: bucket }));
}
