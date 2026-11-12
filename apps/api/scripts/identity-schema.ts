// Prints the SQL that Better Auth 1.x needs, for our configuration (src/modules/identity/auth.ts), to bring schema
// identity of the database these settings name up to date: everything, on a database whose identity schema is still
// empty. Better Auth's own getMigrations writes it; review it, keep it as written in src/db/identity/, and run it from a
// new migration. The database tests fail while Better Auth expects tables or columns no migration made.
// Settings: PGN_DB_HOST, PGN_DB_PORT, PGN_DB_NAME and PGN_AUTH_PASSWORD (.env.dev in development).
import { getMigrations } from "better-auth/db/migration";
import { ConfigError, loadConfig } from "../src/config.ts";
import { openDatabase } from "../src/db/pools.ts";
import { authOptions } from "../src/modules/identity/auth.ts";
import { openMailer } from "../src/modules/notifications/mailer.ts";

try {
  // only the database settings matter here; the API's other secrets are not needed to read a schema
  const config = loadConfig({
    PGN_APP_PASSWORD: "unused",
    PGN_LISTEN_PASSWORD: "unused",
    PGN_AUTH_SECRET: "unused-for-reading-the-schema-0123456789",
    ...process.env,
  });
  const database = openDatabase(config.database);
  const mailer = openMailer(
    { from: config.mail.from },
    { sendMail: async () => undefined, close: () => undefined },
    () => undefined,
  );
  const quiet = { warn: () => undefined, error: (_: object, message: string) => console.error(message) };
  try {
    const { compileMigrations, toBeCreated, toBeAdded } = await getMigrations(
      authOptions({ config, database, mailer, log: quiet }),
    );
    if (toBeCreated.length === 0 && toBeAdded.length === 0) console.error("The identity schema is up to date.");
    else process.stdout.write(`${await compileMigrations()}\n`);
  } finally {
    await database.close();
  }
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(error.message);
  process.exitCode = 1;
}
