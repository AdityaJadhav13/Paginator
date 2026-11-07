// Organisations, invitations and two-step sign-in (docs/product/10-l2-newsroom-plan.md §3.3, §4.2–4.4, PRs 9–11).
// - In identity: the tables and columns Better Auth's organization and twoFactor plugins need, two user fields (locale,
//   uiDigits) and when a session was made with two-step (session.twoStepAt), as Better Auth printed them
//   (src/db/identity/better-auth-1.7.8-orgs-two-step.sql, never edited); pgn_auth's rights on them; one membership per
//   person and organisation; the values the user fields take; the TOTP codes already used (identity.totp_used).
// - In app: who holds which roles and grants on each publication (publication_grant), and what each invitation will
//   grant (invitation_grant). Both carry the organisation wall only: they are read to work out which publications a
//   person reaches, so the publication wall cannot apply to them (test/tenancy/checks.ts ORG_ONLY).
// The organisation's id is Better Auth's organization id, used as org_id in app, with no foreign key across the zones.
import { readFile } from "node:fs/promises";
import { type Kysely, sql } from "kysely";

const BETTER_AUTH = new URL("../identity/better-auth-1.7.8-orgs-two-step.sql", import.meta.url);

const PUBLICATION_ROLES = `array['chief_editor', 'editor', 'sub_editor', 'reporter', 'page_designer', 'photo_editor',
  'advertising', 'prepress', 'viewer']::text[]`;
const GRANTS = `array['page_approve', 'release_approve']::text[]`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(await readFile(BETTER_AUTH, "utf8")).execute(db);
  await sql`
    grant select, insert, update, delete
      on identity.organization, identity.member, identity.invitation, identity."twoFactor"
      to pgn_auth;

    -- One membership per person and organisation: two accepts at the same moment, or a repair running beside an
    -- accept (src/modules/people/grants.ts), cannot make two.
    create unique index member_one_per_org on identity.member ("organizationId", "userId");

    -- TOTP codes already used, so that none is accepted twice within its window (RFC 6238 §5.2)
    create table identity.totp_used (
      user_id uuid not null,
      code text not null check (length(code) between 1 and 16),
      used_at timestamptz not null,
      primary key (user_id, code)
    );
    grant select, insert, update, delete on identity.totp_used to pgn_auth;

    alter table identity."user" add constraint user_locale check (locale in ('en', 'mr'));
    alter table identity."user" add constraint user_ui_digits check ("uiDigits" in ('latin', 'devanagari'));
  `.execute(db);
  await sql
    .raw(
      `
    create table app.publication_grant (
      org_id uuid not null references app.org_settings (org_id),
      publication_id uuid not null,
      user_id uuid not null,
      roles text[] not null check (cardinality(roles) between 1 and 9 and roles <@ ${PUBLICATION_ROLES}),
      grants text[] not null default '{}' check (grants <@ ${GRANTS}),
      updated_at timestamptz not null default now(),
      primary key (org_id, publication_id, user_id),
      foreign key (org_id, publication_id) references app.publication (org_id, id),
      foreign key (org_id, user_id) references app.person (org_id, user_id)
    );
    create index publication_grant_by_user on app.publication_grant (org_id, user_id);

    -- invitation_id is Better Auth's invitation id (in identity); applied_at is set once the grant is made.
    create table app.invitation_grant (
      org_id uuid not null references app.org_settings (org_id),
      invitation_id uuid not null,
      publication_id uuid not null,
      roles text[] not null check (cardinality(roles) between 1 and 9 and roles <@ ${PUBLICATION_ROLES}),
      grants text[] not null default '{}' check (grants <@ ${GRANTS}),
      created_at timestamptz not null default now(),
      applied_at timestamptz,
      primary key (org_id, invitation_id, publication_id),
      foreign key (org_id, publication_id) references app.publication (org_id, id)
    );

    alter table app.publication_grant enable row level security;
    alter table app.publication_grant force row level security;
    create policy org_wall on app.publication_grant
      using (org_id = (select app.current_org())) with check (org_id = (select app.current_org()));
    alter table app.invitation_grant enable row level security;
    alter table app.invitation_grant force row level security;
    create policy org_wall on app.invitation_grant
      using (org_id = (select app.current_org())) with check (org_id = (select app.current_org()));

    -- a removed person's grants are deleted (their work stays); an invitation's are kept, as its record
    grant select, insert, update, delete on app.publication_grant to pgn_app;
    grant select, insert, update on app.invitation_grant to pgn_app;
  `,
    )
    .execute(db);
}
