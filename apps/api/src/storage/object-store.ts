// The object store (docs/product/10-l2-newsroom-plan.md §6): S3 in the pilot, SeaweedFS in development, an in-memory
// fake in unit tests. The API only ever names keys it built itself from ids (src/storage/keys.ts): a client never
// sends one.
export type PresignedPost = { url: string; fields: Record<string, string> };
export type ObjectHead = { bytes: number; contentType: string | undefined; versionId: string | undefined };

export interface ObjectStore {
  /** A browser upload straight to the store (plan §6.2): the exact key, 1 byte to maxBytes, the Content-Type and the
   * metadata pinned by the policy, valid for expiresSeconds. */
  presignPost(input: {
    key: string;
    contentType: string;
    maxBytes: number;
    expiresSeconds: number;
    metadata: Record<string, string>;
  }): Promise<PresignedPost>;
  /** The object's size, type and version, or null when there is none. */
  head(key: string): Promise<ObjectHead | null>;
  /** The object's bytes (of this version, when one is named), as they arrive. */
  read(key: string, versionId?: string): Promise<AsyncIterable<Uint8Array>>;
  /** Copies one version of an object (server side), with this type and metadata; returns the copy's version. */
  copy(input: {
    from: string;
    fromVersion: string | undefined;
    to: string;
    contentType: string;
    metadata: Record<string, string>;
  }): Promise<{ versionId: string | undefined }>;
  remove(key: string): Promise<void>;
  /** A download link valid for expiresSeconds, tied to one version of the object (plan §6.4). */
  presignGet(input: {
    key: string;
    versionId: string | undefined;
    contentType: string;
    disposition: string;
    expiresSeconds: number;
  }): Promise<string>;
  /** True when the work bucket answers. */
  ready(): Promise<boolean>;
}
