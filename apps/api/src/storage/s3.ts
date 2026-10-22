// The object store on S3's API (@aws-sdk 3.1152.0; plan §6): SeaweedFS 4.48 in development (path-style, on this
// machine), S3 in Mumbai in the pilot. One bucket for work (uploads, assets).
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  NotFound,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Config } from "../config.ts";
import type { ObjectStore } from "./object-store.ts";

export type StorageConfig = NonNullable<Config["storage"]>;

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
    async presignPost({ key, contentType, maxBytes, expiresSeconds, metadata }) {
      const meta = Object.fromEntries(Object.entries(metadata).map(([k, v]) => [`x-amz-meta-${k}`, v]));
      return createPresignedPost(client, {
        Bucket,
        Key: key,
        Expires: expiresSeconds,
        Fields: { "Content-Type": contentType, ...meta },
        Conditions: [
          ["content-length-range", 1, maxBytes],
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
      const object = await client.send(
        new GetObjectCommand({ Bucket, Key: key, ...(versionId ? { VersionId: versionId } : {}) }),
      );
      if (!object.Body) throw new Error(`The object ${key} has no body.`);
      return object.Body as AsyncIterable<Uint8Array>;
    },
    async copy({ from, fromVersion, to, contentType, metadata }) {
      const copied = await client.send(
        new CopyObjectCommand({
          Bucket,
          Key: to,
          CopySource: `${Bucket}/${from}${fromVersion ? `?versionId=${encodeURIComponent(fromVersion)}` : ""}`,
          MetadataDirective: "REPLACE",
          ContentType: contentType,
          Metadata: metadata,
        }),
      );
      return { versionId: copied.VersionId };
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
    async presignGet({ key, versionId, contentType, disposition, expiresSeconds }) {
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket,
          Key: key,
          ...(versionId ? { VersionId: versionId } : {}),
          ResponseContentType: contentType,
          ResponseContentDisposition: disposition,
        }),
        { expiresIn: expiresSeconds },
      );
    },
    async ready() {
      try {
        await client.send(new HeadBucketCommand({ Bucket }));
        return true;
      } catch {
        return false;
      }
    },
  };
}
