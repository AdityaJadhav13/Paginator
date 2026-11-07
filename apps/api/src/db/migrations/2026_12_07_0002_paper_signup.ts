// A new paper's application (src/modules/signup): made by the public sign-up form, confirmed through the emailed link,
// then approved or refused by a person at Pageinator (scripts/review-paper.ts). It belongs to no organisation yet, so it
// lives in the identity zone beside the accounts: only pgn_auth may use the schema, so no organisation's people (pgn_app)
// can read it at all, and nothing reaches it without the server's own connection.
// - state: unconfirmed (a link was emailed: token_hash, the SHA-256 of the token, until token_expires_at), waiting (the
//   address was confirmed; the token is gone), approved (org_id: the organisation made) or refused (reason, optional).
//   decided_by and decided_at: the operator who decided, and when.
// - At most one open (unconfirmed or waiting) application an email address.
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table identity.paper_application (
      id uuid primary key default uuidv7(),
      paper_name text not null check (length(paper_name) between 1 and 120),
      owner_name text not null check (length(owner_name) between 1 and 200),
      email text not null check (length(email) between 3 and 254 and email = lower(email)),
      language text not null check (language in ('en', 'mr')),
      state text not null default 'unconfirmed' check (state in ('unconfirmed', 'waiting', 'approved', 'refused')),
      token_hash text check (token_hash ~ '^[0-9a-f]{64}$'),
      token_expires_at timestamptz not null,
      confirmed_at timestamptz,
      decided_by text check (length(decided_by) between 1 and 200),
      decided_at timestamptz,
      reason text check (length(reason) between 1 and 2000),
      org_id text,
      created_at timestamptz not null default now(),
      check ((state = 'unconfirmed') = (token_hash is not null)),
      check ((state = 'unconfirmed') = (confirmed_at is null)),
      check ((state in ('approved', 'refused')) = (decided_by is not null and decided_at is not null)),
      check ((state = 'approved') = (org_id is not null)),
      check (state = 'refused' or reason is null)
    );
    create unique index paper_application_token on identity.paper_application (token_hash) where token_hash is not null;
    create unique index paper_application_open on identity.paper_application (email)
      where state in ('unconfirmed', 'waiting');
    create index paper_application_by_state on identity.paper_application (state, created_at);
    -- changes state, never removed
    grant select, insert, update on identity.paper_application to pgn_auth;
  `.execute(db);
}
