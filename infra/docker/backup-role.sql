-- The backup role (docs/runbooks/restore.md): pgn_backup reads every table for pg_dump and changes nothing. It has
-- BYPASSRLS because the tables force row-level security, and pg_dump refuses to dump a table whose rows a policy would
-- hide. pg_read_all_data (PostgreSQL 14+) gives it SELECT on every table and USAGE on every schema, those the
-- migrations make later included. Run once, after infra/docker/postgres-init.sql, as a role that may give BYPASSRLS:
-- the superuser locally (infra/docker/compose.pilot.yml, pilot-local), the RDS master user in the pilot
-- (docs/runbooks/aws-setup.md; that RDS lets its master user give BYPASSRLS is to verify on the instance).
\getenv database POSTGRES_DB
\getenv backup_password PGN_BACKUP_PASSWORD

select :{?backup_password} as password_ok \gset
\if :password_ok
  select :'backup_password' ~ '\S' as password_ok \gset
\endif
\if :password_ok
\else
  do $$ begin
    raise exception 'Set PGN_BACKUP_PASSWORD';
  end $$;
\endif

-- two connections at most (the nightly dump uses one); every transaction read-only unless it asks otherwise, so a
-- stolen password changes nothing by mistake (pg_read_all_data gives no write right anyway)
create role pgn_backup login nosuperuser nocreatedb nocreaterole noreplication bypassrls connection limit 2
  password :'backup_password';
alter role pgn_backup set default_transaction_read_only = on;
grant pg_read_all_data to pgn_backup;
grant connect on database :"database" to pgn_backup;
