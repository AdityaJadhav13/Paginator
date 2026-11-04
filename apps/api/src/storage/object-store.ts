// The object store (docs/product/10-l2-newsroom-plan.md §6): S3 in the pilot, SeaweedFS in development and in the
// database tests (src/storage/s3.ts is the only implementation). The API only ever names keys the database built from
// ids (app.upload.key, app.asset.original_key): a client never sends one. The work bucket is versioned: every object
// the API keeps is named by its version too, and a store that gives no version is refused (plan §6.2).
export type PresignedPost = { url: string; fields: Record<string, string> };
/** What the store says of an object; versionId is undefined only when the bucket is not versioned. */
export type ObjectHead = { bytes: number; contentType: string | undefined; versionId: string | undefined };

export interface ObjectStore {
  /** A browser upload straight to the store (plan §6.2): the exact key, exactly `bytes` bytes, the Content-Type and
   * the metadata pinned by the policy, valid for expiresSeconds. */
  presignPost(input: {
    key: string;
    contentType: string;
    bytes: number;
    expiresSeconds: number;
    metadata: Record<string, string>;
  }): Promise<PresignedPost>;
  /** The object's size, type and version, or null when there is none. */
  head(key: string): Promise<ObjectHead | null>;
  /** The bytes of this version of the object, as they arrive. */
  read(key: string, versionId: string): Promise<AsyncIterable<Uint8Array>>;
  /** Copies one version of an object (server side), with this type and metadata; returns the copy's version (it
   * throws when the store gives none). */
  copy(input: {
    from: string;
    fromVersion: string;
    to: string;
    contentType: string;
    metadata: Record<string, string>;
  }): Promise<{ versionId: string }>;
  /** Writes bytes the API holds (a found photo the news finder downloaded) as a new version of the key, with this type
   * and metadata; returns its version (it throws when the store gives none). */
  put(input: {
    key: string;
    body: Uint8Array;
    contentType: string;
    metadata: Record<string, string>;
  }): Promise<{ versionId: string }>;
  /** Deletes every version and delete marker of exactly this key (not a delete marker over them); returns how many
   * there were. */
  removeAll(key: string): Promise<number>;
  /** A download link valid for expiresSeconds, tied to one version of the object (plan §6.4). */
  presignGet(input: {
    key: string;
    versionId: string;
    contentType: string;
    disposition: string;
    expiresSeconds: number;
  }): Promise<string>;
  /** True when the work bucket answers and its versioning is Enabled. */
  ready(): Promise<boolean>;
}
