-- Roles and database rights for local development: those of docs/product/10-l2-newsroom-plan.md §3.1, plus
-- pgn_listen (ADR-025, plan §10 row 5). The Postgres image runs this file once, when the db volume is new;
-- `pnpm dev:reset` starts over. The passwords come from .env.dev.
-- The schemas (app, identity, queue), their USAGE grants, and every table, grant and RLS policy come from the
-- migrations (apps/api/src/db/migrations), which act as pgn_owner. Nobody may use the public schema, so the migration
-- runner records the migrations in a schema of its own ("migrations"). The database tests give the databases they
-- make the same rights as this file (apps/api/test/db/settings.ts), and compare them with this database's.
\getenv database POSTGRES_DB
\getenv migrator_password PGN_MIGRATOR_PASSWORD
\getenv app_password PGN_APP_PASSWORD
\getenv auth_password PGN_AUTH_PASSWORD
\getenv engine_password PGN_ENGINE_PASSWORD
\getenv listen_password PGN_LISTEN_PASSWORD

-- Every password must be set and contain more than white space (Postgres would store an empty one as "no password").
select :{?migrator_password} and :{?app_password} and :{?auth_password} and :{?engine_password}
  and :{?listen_password} as passwords_ok \gset
\if :passwords_ok
  select :'migrator_password' ~ '\S' and :'app_password' ~ '\S' and :'auth_password' ~ '\S'
    and :'engine_password' ~ '\S' and :'listen_password' ~ '\S' as passwords_ok \gset
\endif
\if :passwords_ok
\else
  do $$ begin
    raise exception 'Set every PGN_*_PASSWORD in .env.dev (see .env.dev.example), then run pnpm dev:reset';
  end $$;
\endif

-- pgn_owner will own every schema and table, and nobody signs in as it: migrations act as it through SET ROLE.
create role pgn_owner nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role pgn_migrator login nosuperuser nocreatedb nocreaterole noreplication nobypassrls
  password :'migrator_password';
grant pgn_owner to pgn_migrator with inherit false, set true;

-- The application (app.*), Better Auth (identity.*) and the engine worker (queue.*, plus the event inbox).
create role pgn_app login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password :'app_password';
create role pgn_auth login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password :'auth_password';
create role pgn_engine login nosuperuser nocreatedb nocreaterole noreplication nobypassrls
  password :'engine_password';
-- The API's LISTEN connection: LISTEN needs no table rights, so this role gets none.
create role pgn_listen login nosuperuser nocreatedb nocreaterole noreplication nobypassrls
  password :'listen_password';

-- Only the login roles may connect, only to this database, and nobody may make temporary tables.
revoke all on database :"database" from public;
grant connect on database :"database" to pgn_migrator, pgn_app, pgn_auth, pgn_engine, pgn_listen;
revoke all on database postgres, template1 from public;
-- The migrations, as pgn_owner, make the schemas (and trusted extensions such as pg_trgm).
grant create on database :"database" to pgn_owner;
-- Everything lives in app, identity or queue; nothing in public.
revoke all on schema public from public;
