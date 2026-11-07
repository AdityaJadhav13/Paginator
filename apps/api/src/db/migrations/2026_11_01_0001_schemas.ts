// The schemas, the tenancy context functions and the append-only trigger function (docs/product/10-l2-newsroom-plan.md
// §3.1–3.2). Migrations act as pgn_owner, which owns everything they make; each login role gets only what the plan
// gives it, and later migrations add the rest when its tables arrive.
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    -- Postgres lets everyone execute a new function unless told otherwise: functions made from here on are
    -- executable only by the roles granted it.
    alter default privileges revoke execute on functions from public;

    create schema app; -- the application's tables: pgn_app, through withTenant
    create schema identity; -- Better Auth's tables: pgn_auth (PR 7)
    create schema queue; -- Procrastinate's tables: pgn_engine (L2.2)
    grant usage on schema app to pgn_app;
    grant usage on schema identity to pgn_auth;
    grant usage on schema queue to pgn_engine;

    -- The context withTenant sets for one transaction (src/db/tenant.ts). Unset or empty means NULL, which no row's
    -- org_id equals: a query outside withTenant sees no rows.
    create function app.current_org() returns uuid
      language sql stable parallel safe set search_path = pg_catalog
      return nullif(current_setting('app.org_id', true), '')::uuid;
    create function app.current_user() returns uuid
      language sql stable parallel safe set search_path = pg_catalog
      return nullif(current_setting('app.user_id', true), '')::uuid;
    create function app.current_pubs() returns uuid[]
      language sql stable parallel safe set search_path = pg_catalog
      return coalesce(nullif(current_setting('app.pub_ids', true), '')::uuid[], '{}');
    grant execute on function app.current_org(), app.current_user(), app.current_pubs() to pgn_app;

    -- For tables whose rows never change once written (audit_event here; closed revisions later). A trigger needs no
    -- EXECUTE grant to fire.
    create function app.refuse_change() returns trigger
      language plpgsql set search_path = pg_catalog
      as $$
      begin
        raise exception 'app.% is append-only: % is not allowed', tg_table_name, tg_op
          using errcode = 'restrict_violation';
      end
      $$;
  `.execute(db);
}
