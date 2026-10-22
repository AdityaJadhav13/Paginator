// The database tests' object store (no Vitest imports here: the global setup runs outside the tests): one bucket per
// run on the development SeaweedFS (pnpm dev:up), versioned and with the uploads/ rules like the work bucket, emptied
// and deleted at the end.
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectVersionsCommand,
  PutBucketLifecycleConfigurationCommand,
  PutBucketVersioningCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { loadStorageConfig } from "../../src/config.ts";
import { UPLOADS_LIFECYCLE, s3Client } from "../../src/storage/s3.ts";

export type TestStorage = { endpoint: string; accessKeyId: string; secretAccessKey: string; bucket: string };

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
  return {
    storage: {
      endpoint: config.endpoint,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      bucket,
    },
    drop: () => dropBucket(client, bucket),
  };
}

async function dropBucket(client: S3Client, bucket: string): Promise<void> {
  for (;;) {
    const listed = await client.send(new ListObjectVersionsCommand({ Bucket: bucket }));
    const objects = [...(listed.Versions ?? []), ...(listed.DeleteMarkers ?? [])].map((v) => ({
      Key: v.Key ?? "",
      VersionId: v.VersionId,
    }));
    if (objects.length === 0) break;
    await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects } }));
  }
  await client.send(new DeleteBucketCommand({ Bucket: bucket }));
}
