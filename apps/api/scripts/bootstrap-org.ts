// Makes an organisation, its first publication and its Owner (src/modules/people/bootstrap.ts), on the server:
//   pnpm --filter @pageinator/api bootstrap-org -- --owner-name "…" --owner-email … --org-name "…" --org-slug … \
//     --pub-name "…" --pub-slug … --languages mr,en --primary mr --digits devanagari
// It reads the API's own settings (the environment, or .env.dev in development) and sends its two emails (verify the
// address, choose a password) through the configured mail server. It prints the new ids, never a secret.
import { parseArgs } from "node:util";
import { ConfigError, loadConfig } from "../src/config.ts";
import { openDatabase } from "../src/db/pools.ts";
import { createAuth } from "../src/modules/identity/auth.ts";
import { openMailer, smtpTransport } from "../src/modules/notifications/mailer.ts";
import { BootstrapError, bootstrapOrg } from "../src/modules/people/bootstrap.ts";

const { values } = parseArgs({
  options: {
    "owner-name": { type: "string" },
    "owner-email": { type: "string" },
    "org-name": { type: "string" },
    "org-slug": { type: "string" },
    "pub-name": { type: "string" },
    "pub-slug": { type: "string" },
    languages: { type: "string" },
    primary: { type: "string" },
    digits: { type: "string" },
  },
  strict: true,
});
const missing = Object.entries({
  "owner-name": values["owner-name"],
  "owner-email": values["owner-email"],
  "org-name": values["org-name"],
  "org-slug": values["org-slug"],
  "pub-name": values["pub-name"],
  "pub-slug": values["pub-slug"],
  languages: values.languages,
  primary: values.primary,
  digits: values.digits,
})
  .filter(([, value]) => !value)
  .map(([name]) => `--${name}`);
if (missing.length > 0) {
  console.error(`Missing: ${missing.join(", ")}.`);
  process.exit(2);
}

try {
  const config = loadConfig(process.env);
  const database = openDatabase(config.database);
  const mailer = openMailer(config.mail, smtpTransport(config.mail), (kind, error) => {
    console.error(`The ${kind} email was not sent (${(error as { code?: string }).code ?? "error"}).`);
  });
  const log = {
    warn: (_: object, message: string) => console.error(message),
    error: (_: object, m: string) => console.error(m),
  };
  try {
    const made = await bootstrapOrg(createAuth({ config, database, mailer, log }), mailer, database, {
      owner: { name: values["owner-name"] ?? "", email: values["owner-email"] ?? "" },
      organization: { name: values["org-name"] ?? "", slug: values["org-slug"] ?? "" },
      publication: {
        name: values["pub-name"] ?? "",
        slug: values["pub-slug"] ?? "",
        languages: (values.languages ?? "").split(",").map((language) => language.trim()),
        primaryLanguage: values.primary ?? "",
        digitStyle: values.digits ?? "",
      },
    });
    console.log(`Organisation ${made.orgId}, publication ${made.publicationId}, owner ${made.ownerId}.`);
    console.log("The owner gets two emails: confirm the address, and choose a password.");
    await mailer.idle();
  } finally {
    await mailer.close();
    await database.close();
  }
} catch (error) {
  if (!(error instanceof ConfigError || error instanceof BootstrapError)) throw error;
  console.error(error.message);
  process.exitCode = 1;
}
