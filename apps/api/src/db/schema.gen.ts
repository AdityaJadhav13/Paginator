// Generated from the migrated schema app by `pnpm --filter @pageinator/api db:codegen` (src/db/codegen.ts): do not
// edit it. The database tests (pnpm test:db) fail while it differs from the migrations.
import type { ColumnType } from "kysely";

export type Generated<T> =
  T extends ColumnType<infer S, infer I, infer U> ? ColumnType<S, I | undefined, U> : ColumnType<T, T | undefined, T>;
export type Json = ColumnType<JsonValue, string, string>;
export type JsonValue = JsonValue[] | { [key: string]: JsonValue } | boolean | number | string | null;
export type Timestamp = ColumnType<Date, Date | string, Date | string>;
/** A column the database computes (generated always): read only. */
export type GeneratedAlways<T> = ColumnType<T, never, never>;

export interface AppAsset {
  bytes: number;
  caption: Generated<string>;
  created_at: Generated<Timestamp>;
  credit: Generated<string>;
  deleted_at: Timestamp | null;
  desk_key: string;
  height_px: number;
  id: Generated<string>;
  kind: Generated<string>;
  mime: string;
  org_id: string;
  original_key: GeneratedAlways<string>;
  photographer: Generated<string>;
  problem: string | null;
  publication_id: string;
  revision: Generated<number>;
  sha256: string;
  status: Generated<string>;
  updated_at: Generated<Timestamp>;
  uploaded_by: string;
  version_id: string | null;
  width_px: number;
}

export interface AppAuditEvent {
  action: string;
  actor_id: string | null;
  actor_kind: string;
  at: Generated<Timestamp>;
  data: Generated<Json>;
  id: Generated<string>;
  ip: string | null;
  org_id: string;
  publication_id: string | null;
  request_id: string | null;
  target_id: string | null;
  target_type: string;
  user_agent: string | null;
}

export interface AppComment {
  author_id: string;
  body: string;
  created_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
  id: Generated<string>;
  mentions: Generated<string[]>;
  org_id: string;
  parent_id: string | null;
  publication_id: string;
  resolved_at: Timestamp | null;
  resolved_by: string | null;
  target_id: string;
  target_type: Generated<string>;
  updated_at: Generated<Timestamp>;
}

export interface AppDeskBundle {
  created_at: Generated<Timestamp>;
  created_by: string;
  edition_id: string;
  id: Generated<string>;
  key: string | null;
  org_id: string;
  publication_id: string;
  sha256: string | null;
}

export interface AppDeskBundleRevision {
  bundle_id: string;
  org_id: string;
  publication_id: string;
  rev: number;
  story_id: string;
  version: number;
}

export interface AppEdition {
  back_page_ads: Generated<boolean>;
  created_at: Generated<Timestamp>;
  desk_key: string;
  edition_date: string;
  id: Generated<string>;
  issue: Generated<string>;
  org_id: string;
  pages: number;
  price: Generated<string>;
  produced_in: Generated<string>;
  publication_id: string;
  status: Generated<string>;
  updated_at: Generated<Timestamp>;
  volume: Generated<string>;
}

export interface AppEngineEvent {
  asset_id: string;
  created_at: Generated<Timestamp>;
  id: Generated<string>;
  job_id: string;
  kind: string;
  org_id: string;
  outcome: string | null;
  payload: Json;
  processed_at: Timestamp | null;
  retry_at: Timestamp | null;
  tries: Generated<number>;
}

export interface AppIdempotencyKey {
  created_at: Generated<Timestamp>;
  expires_at: Generated<Timestamp>;
  key: string;
  org_id: string;
  request_sha256: string;
  response: Json | null;
  response_status: number | null;
  route: string;
  status: Generated<string>;
  user_id: string;
}

export interface AppImportJob {
  bytes: number;
  created: Generated<Json>;
  created_at: Generated<Timestamp>;
  edition_id: string | null;
  id: Generated<string>;
  kind: Generated<string>;
  message: string | null;
  notes: Generated<Json>;
  org_id: string;
  original_key: GeneratedAlways<string>;
  problem: string | null;
  publication_id: string;
  sha256: string;
  skipped: Generated<number>;
  state: Generated<string>;
  updated_at: Generated<Timestamp>;
  upload_id: string;
  user_id: string;
  version_id: string | null;
}

export interface AppInvitationGrant {
  applied_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  grants: Generated<string[]>;
  invitation_id: string;
  org_id: string;
  publication_id: string;
  roles: string[];
}

export interface AppNotification {
  created_at: Generated<Timestamp>;
  data: Generated<Json>;
  emailed_at: Timestamp | null;
  id: Generated<string>;
  kind: string;
  org_id: string;
  read_at: Timestamp | null;
  target_id: string;
  target_type: string;
  user_id: string;
}

export interface AppOrgSettings {
  created_at: Generated<Timestamp>;
  data_region: Generated<string>;
  mfa_required_roles: Generated<string[]>;
  org_id: string;
  session_absolute_days: Generated<number>;
}

export interface AppPerson {
  display_name: string;
  email: string | null;
  joined_at: Generated<Timestamp>;
  org_id: string;
  removed_at: Timestamp | null;
  status: Generated<string>;
  user_id: string;
}

export interface AppPublication {
  created_at: Generated<Timestamp>;
  digit_style: string;
  id: Generated<string>;
  languages: string[];
  name: string;
  org_id: string;
  primary_language: string;
  slug: string;
  timezone: Generated<string>;
}

export interface AppPublicationGrant {
  grants: Generated<string[]>;
  org_id: string;
  publication_id: string;
  roles: string[];
  updated_at: Generated<Timestamp>;
  user_id: string;
}

export interface AppRendition {
  asset_id: string;
  bytes: number;
  created_at: Generated<Timestamp>;
  height_px: number;
  key: string;
  mime: string;
  org_id: string;
  params_hash: string;
  publication_id: string;
  purpose: string;
  sha256: string;
  version_id: string;
  width_px: number;
}

export interface AppSection {
  archived_at: Timestamp | null;
  color_tag: string | null;
  created_at: Generated<Timestamp>;
  id: Generated<string>;
  name: string;
  org_id: string;
  position: Generated<number>;
  publication_id: string;
}

export interface AppStory {
  assignee_id: string | null;
  created_at: Generated<Timestamp>;
  current_rev: Generated<number>;
  deleted_at: Timestamp | null;
  desk_key: string;
  desk_note: Generated<string>;
  due_at: Timestamp | null;
  edition_id: string | null;
  id: Generated<string>;
  language: string;
  org_id: string;
  origin: Generated<string>;
  page_pin: number | null;
  priority: Generated<number>;
  publication_id: string;
  reporter_id: string;
  section_id: string | null;
  status: Generated<string>;
  updated_at: Generated<Timestamp>;
  updated_by: string;
  version: Generated<number>;
}

export interface AppStoryPhoto {
  asset_id: string;
  caption: Generated<string>;
  created_at: Generated<Timestamp>;
  credit: Generated<string>;
  org_id: string;
  publication_id: string;
  story_id: string;
  updated_at: Generated<Timestamp>;
}

export interface AppStoryRevision {
  author_id: string;
  body: Generated<string>;
  body_format: Generated<string>;
  byline: Generated<string>;
  closed_at: Timestamp | null;
  deck: Generated<string>;
  headline: Generated<string>;
  kicker: Generated<string>;
  opened_at: Generated<Timestamp>;
  org_id: string;
  publication_id: string;
  rev: number;
  story_id: string;
  words: Generated<number>;
}

export interface AppStoryStatusChange {
  changed_at: Generated<Timestamp>;
  changed_by: string | null;
  comment_id: string | null;
  from_status: string;
  id: Generated<string>;
  org_id: string;
  publication_id: string;
  story_id: string;
  to_status: string;
}

export interface AppUpload {
  asset_id: string | null;
  completed_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  declared_bytes: number;
  declared_type: string;
  expires_at: Timestamp;
  id: Generated<string>;
  import_id: string | null;
  key: GeneratedAlways<string>;
  org_id: string;
  publication_id: string;
  purpose: string;
  status: Generated<string>;
  user_id: string;
}

export interface AppUploadQuota {
  bytes: Generated<string>;
  day: string;
  org_id: string;
}

export interface DB {
  "app.asset": AppAsset;
  "app.audit_event": AppAuditEvent;
  "app.comment": AppComment;
  "app.desk_bundle": AppDeskBundle;
  "app.desk_bundle_revision": AppDeskBundleRevision;
  "app.edition": AppEdition;
  "app.engine_event": AppEngineEvent;
  "app.idempotency_key": AppIdempotencyKey;
  "app.import_job": AppImportJob;
  "app.invitation_grant": AppInvitationGrant;
  "app.notification": AppNotification;
  "app.org_settings": AppOrgSettings;
  "app.person": AppPerson;
  "app.publication": AppPublication;
  "app.publication_grant": AppPublicationGrant;
  "app.rendition": AppRendition;
  "app.section": AppSection;
  "app.story": AppStory;
  "app.story_photo": AppStoryPhoto;
  "app.story_revision": AppStoryRevision;
  "app.story_status_change": AppStoryStatusChange;
  "app.upload": AppUpload;
  "app.upload_quota": AppUploadQuota;
}
