-- Better Auth 1.7.8 schema additions for apps/api/src/modules/identity/auth.ts: the organization and twoFactor plugins,
-- the user fields locale and uiDigits, and the session field twoStepAt. Printed by scripts/identity-schema.ts on
-- 2026-10-22 from a database migrated to 2026_11_20_0002. The statements below are as Better Auth printed them: never
-- edit them; the next change goes in a new file and a new migration.

create schema if not exists "identity";

alter table "identity"."user" add column "twoFactorEnabled" boolean default false;

alter table "identity"."user" add column "locale" text default 'en';

alter table "identity"."user" add column "uiDigits" text default 'latin';

alter table "identity"."session" add column "activeOrganizationId" text;

alter table "identity"."session" add column "twoStepAt" timestamptz;

create table "identity"."organization" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "name" text not null, "slug" text not null unique, "logo" text, "createdAt" timestamptz not null, "metadata" text);

create table "identity"."member" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "organizationId" uuid not null references "identity"."organization" ("id") on delete cascade, "userId" uuid not null references "identity"."user" ("id") on delete cascade, "role" text not null, "createdAt" timestamptz not null);

create table "identity"."invitation" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "organizationId" uuid not null references "identity"."organization" ("id") on delete cascade, "email" text not null, "role" text, "status" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "inviterId" uuid not null references "identity"."user" ("id") on delete cascade);

create table "identity"."twoFactor" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "secret" text not null, "backupCodes" text not null, "userId" uuid not null references "identity"."user" ("id") on delete cascade, "verified" boolean, "failedVerificationCount" integer, "lockedUntil" timestamptz);

create index "member_organizationId_idx" on "identity"."member" ("organizationId");

create index "member_userId_idx" on "identity"."member" ("userId");

create index "invitation_organizationId_idx" on "identity"."invitation" ("organizationId");

create index "invitation_email_idx" on "identity"."invitation" ("email");

create index "twoFactor_secret_idx" on "identity"."twoFactor" ("secret");

create index "twoFactor_userId_idx" on "identity"."twoFactor" ("userId");
