// Applies the pending migrations (docs/product/10-l2-newsroom-plan.md §3.6) as pgn_migrator: before each deploy, and
// in development after `pnpm dev:up`. Settings: PGN_DB_HOST, PGN_DB_PORT, PGN_DB_NAME and PGN_MIGRATOR_PASSWORD (from
// .env.dev in development: the package script reads it when it exists, and the environment wins over it).
import { ConfigError, loadMigratorConfig } from "../src/config.ts";
import { MigrationError, migrate } from "../src/db/migrate.ts";

try {
  const applied = await migrate(loadMigratorConfig(process.env));
  console.log(
    applied.length === 0
      ? "The database is up to date: there was no migration to apply."
      : `Applied ${applied.length} migration${applied.length === 1 ? "" : "s"}: ${applied.join(", ")}.`,
  );
} catch (error) {
  if (!(error instanceof ConfigError || error instanceof MigrationError)) throw error;
  console.error(error.message);
  process.exitCode = 1;
}
