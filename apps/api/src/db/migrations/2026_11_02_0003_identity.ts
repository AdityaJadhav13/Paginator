// The identity zone (docs/product/10-l2-newsroom-plan.md §3.1, §3.3, §3.6): Better Auth's tables, and ours beside them,
// in schema identity, which only pgn_auth may use. Better Auth's part is its own SQL for our configuration, kept as
// generated in src/db/identity/better-auth-1.7.8.sql (scripts/identity-schema.ts prints it; it is never edited: the next
// version's changes come in a new migration). The database tests fail while Better Auth expects a table or a column
// that no migration made.
import { readFile } from "node:fs/promises";
import { type Kysely, sql } from "kysely";

const BETTER_AUTH = new URL("../identity/better-auth-1.7.8.sql", import.meta.url);

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(await readFile(BETTER_AUTH, "utf8")).execute(db);
  await sql`
    -- Better Auth reads and writes its own tables as it needs; nobody else may.
    grant select, insert, update, delete
      on identity."user", identity.session, identity.account, identity.verification, identity."rateLimit"
      to pgn_auth;

    -- Sign-in events (plan §3.4): append-only, shown in Account → Security (PR 14). No foreign key to the user, so the
    -- log stays whole; ids only, an address and a browser string.
    create table identity.auth_event (
      id uuid primary key default uuidv7(),
      user_id uuid,
      kind text not null check (kind in ('sign_in', 'sign_in_failed', 'sign_in_locked', 'sign_out', 'email_verified',
        'password_reset', 'password_changed', 'session_revoked', 'session_expired')),
      session_id uuid,
      ip inet,
      user_agent text check (length(user_agent) <= 512),
      at timestamptz not null default now()
    );
    create index auth_event_by_user on identity.auth_event (user_id, at desc);
    create function identity.refuse_change() returns trigger
      language plpgsql set search_path = pg_catalog
      as $$
      begin
        raise exception 'identity.% is append-only: % is not allowed', tg_table_name, tg_op
          using errcode = 'restrict_violation';
      end
      $$;
    create trigger append_only before update or delete on identity.auth_event
      for each row execute function identity.refuse_change();
    create trigger append_only_truncate before truncate on identity.auth_event
      for each statement execute function identity.refuse_change();
    grant select, insert on identity.auth_event to pgn_auth;

    -- Wrong passwords per email (plan §4.6), the email kept only as an HMAC under the sign-in secret.
    create table identity.sign_in_failure (
      email_key text primary key check (length(email_key) between 16 and 64),
      failures integer not null check (failures >= 0),
      window_started_at timestamptz not null,
      locked_until timestamptz
    );
    grant select, insert, update, delete on identity.sign_in_failure to pgn_auth;
  `.execute(db);
}
