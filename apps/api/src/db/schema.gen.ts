// Generated from the migrated schema app by `pnpm --filter @pageinator/api db:codegen` (src/db/codegen.ts): do not
// edit it. The database tests (pnpm test:db) fail while it differs from the migrations.
import type { ColumnType } from "kysely";

export type Generated<T> =
  T extends ColumnType<infer S, infer I, infer U> ? ColumnType<S, I | undefined, U> : ColumnType<T, T | undefined, T>;
export type Json = ColumnType<JsonValue, string, string>;
export type JsonValue = JsonValue[] | { [key: string]: JsonValue } | boolean | number | string | null;
export type Timestamp = ColumnType<Date, Date | string, Date | string>;

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

export interface DB {
  "app.audit_event": AppAuditEvent;
  "app.org_settings": AppOrgSettings;
  "app.person": AppPerson;
  "app.publication": AppPublication;
}
