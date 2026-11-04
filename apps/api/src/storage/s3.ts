// The object store on S3's API (@aws-sdk 3.1152.0; plan §6): SeaweedFS 4.48 in development (path-style, on this
// machine), S3 in Mumbai in the pilot. One bucket for work (uploads, assets).
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  type CORSRule,
  type LifecycleRule,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Config } from "../config.ts";
import type { ObjectStore } from "./object-store.ts";

export type StorageConfig = NonNullable<Config["storage"]>;

/** The work bucket's rules for uploads/ (quarantine; scripts/dev-buckets.ts): a file expires a day after it arrives,
 * its old version is removed a day later, and a delete marker left alone is removed (S3 takes that only in a rule of
 * its own, without Days). */
export const UPLOADS_LIFECYCLE: LifecycleRule[] = [
  {
    ID: "uploads-one-day",
    Status: "Enabled",
    Filter: { Prefix: "uploads/" },
    Expiration: { Days: 1 },
    NoncurrentVersionExpiration: { NoncurrentDays: 1 },
  },
  {
    ID: "uploads-delete-markers",
    Status: "Enabled",
    Filter: { Prefix: "uploads/" },
    Expiration: { ExpiredObjectDeleteMarker: true },
  },
];

/** The work bucket's CORS rule (infra/aws/s3-cors.json is the same rule, for the AWS CLI; a test compares them). The
 * app's origin, and no other, may:
 *   - POST a presigned upload (plan §6.2): the web sends it by XMLHttpRequest with a progress listener, so the browser
 *     asks first (a preflight), and the request carries no header outside the safelisted ones;
 *   - GET an original through the 302 of GET …/assets/{a}/file (plan §6.4): the web follows it with fetch, sending
 *     no header of its own to the store (a simple request, answered with the CORS headers).
 * Nothing else: no PUT or DELETE, no request header beyond the safelisted ones, and no response header exposed (no
 * x-amz-meta-*: the web reads the status and the body only). A browser keeps a preflight's answer for 10 minutes. The
 * archive and backups buckets have no CORS rule. */
export function uploadsCors(appOrigin: string): CORSRule[] {
  return [
    {
      ID: "app-uploads-and-originals",
      AllowedOrigins: [appOrigin],
      AllowedMethods: ["POST", "GET"],
      MaxAgeSeconds: 600,
    },
  ];
}

export function s3Client(config: StorageConfig): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
}

const missing = (error: unknown) =>
  error instanceof NotFound || (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404);

export function s3Store(config: StorageConfig, client: S3Client = s3Client(config)): ObjectStore {
  const Bucket = config.workBucket;
  return {
    async presignPost({ key, contentType, bytes, expiresSeconds, metadata }) {
      const meta = Object.fromEntries(Object.entries(metadata).map(([k, v]) => [`x-amz-meta-${k}`, v]));
      return createPresignedPost(client, {
        Bucket,
        Key: key,
        Expires: expiresSeconds,
        Fields: { "Content-Type": contentType, ...meta },
        Conditions: [
          ["content-length-range", bytes, bytes], // exactly the size the upload declared (and the quota counted)
          ["eq", "$Content-Type", contentType],
          ...Object.entries(meta).map(([k, v]) => ["eq", `$${k}`, v] as ["eq", string, string]),
        ],
      });
    },
    async head(key) {
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { bytes: head.ContentLength ?? 0, contentType: head.ContentType, versionId: head.VersionId };
      } catch (error) {
        if (missing(error)) return null;
        throw error;
      }
    },
    async read(key, versionId) {
      const object = await client.send(new GetObjectCommand({ Bucket, Key: key, VersionId: versionId }));
      if (!object.Body) throw new Error(`The object ${key} has no body.`);
      return object.Body as AsyncIterable<Uint8Array>;
    },
    async copy({ from, fromVersion, to, contentType, metadata }) {
      const copied = await client.send(
        new CopyObjectCommand({
          Bucket,
          Key: to,
          CopySource: `${Bucket}/${from}?versionId=${encodeURIComponent(fromVersion)}`,
          MetadataDirective: "REPLACE",
          ContentType: contentType,
          Metadata: metadata,
        }),
      );
      if (!copied.VersionId) throw new Error(`The store gave no version for ${to}: is the bucket versioned?`);
      return { versionId: copied.VersionId };
    },
    async put({ key, body, contentType, metadata }) {
      const put = await client.send(
        new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType, Metadata: metadata }),
      );
      if (!put.VersionId) throw new Error(`The store gave no version for ${key}: is the bucket versioned?`);
      return { versionId: put.VersionId };
    },
    async removeAll(key) {
      let removed = 0;
      // one key's versions are few (one upload, or a few sent again under the same policy); list again until none
      for (let round = 0; round < 10; round += 1) {
        const listed = await client.send(new ListObjectVersionsCommand({ Bucket, Prefix: key }));
        const versions = [...(listed.Versions ?? []), ...(listed.DeleteMarkers ?? [])].filter(
          (version) => version.Key === key && version.VersionId,
        );
        if (versions.length === 0) return removed;
        for (const version of versions) {
          await client.send(new DeleteObjectCommand({ Bucket, Key: key, VersionId: version.VersionId }));
          removed += 1;
        }
      }
      throw new Error(`The versions of ${key} were not all deleted.`);
    },
    async presignGet({ key, versionId, contentType, disposition, expiresSeconds }) {
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket,
          Key: key,
          VersionId: versionId,
          ResponseContentType: contentType,
          ResponseContentDisposition: disposition,
        }),
        { expiresIn: expiresSeconds },
      );
    },
    async ready() {
      try {
        // a bucket without versioning would lose the version every asset is pinned to (plan §6.2)
        const versioning = await client.send(new GetBucketVersioningCommand({ Bucket }));
        return versioning.Status === "Enabled";
      } catch {
        return false;
      }
    },
  };
}
