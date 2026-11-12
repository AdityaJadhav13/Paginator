// A person at Pageinator approves or refuses each new paper's application (src/modules/signup/review.ts), on the server:
//   pnpm --filter @pageinator/api review-paper -- list [--all]
//   pnpm --filter @pageinator/api review-paper -- approve <id> [--slug <slug>] --by "Operator name"
//   pnpm --filter @pageinator/api review-paper -- refuse <id> [reason] --by "Operator name"
// (or PGN_OPERATOR for --by). It reads the API's own settings, like bootstrap-org, and sends its emails through the
// configured mail server. It prints ids and the details the applicant gave, never a secret.
import { ConfigError, loadConfig } from "../src/config.ts";
import { openDatabase } from "../src/db/pools.ts";
import { createAuth } from "../src/modules/identity/auth.ts";
import { openMailer, smtpTransport } from "../src/modules/notifications/mailer.ts";
import { BootstrapError } from "../src/modules/people/bootstrap.ts";
import { ReviewError, parseReview, reviewer } from "../src/modules/signup/review.ts";

const command = parseReview(
  process.argv.slice(2).filter((arg) => arg !== "--"),
  process.env,
);
if (typeof command === "string") {
  console.error(command);
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
    const auth = createAuth({ config, database, mailer, log });
    const review = reviewer({ auth, database, mailer, origin: config.publicOrigin });
    if (command.command === "list") {
      const found = await review.list(command.all);
      if (found.length === 0) console.log(command.all ? "No applications." : "No application is waiting.");
      for (const a of found) {
        const decided = a.decidedAt ? ` · ${a.state} by ${a.decidedBy} at ${a.decidedAt.toISOString()}` : "";
        console.log(
          `${a.id}  ${a.state}  ${a.createdAt.toISOString()}  ${JSON.stringify(a.paperName)}  ` +
            `${JSON.stringify(a.ownerName)} <${a.email}>  ${a.language}${decided}`,
        );
      }
    } else if (command.command === "approve") {
      const made = await review.approve(command.id, command.by, command.slug);
      console.log(
        `Approved. Organisation ${made.orgId}, publication ${made.publicationId ?? "(made earlier)"}, owner ${made.ownerId}.`,
      );
    } else {
      await review.refuse(command.id, command.by, command.reason);
      console.log("Refused. The applicant gets an email.");
    }
    await mailer.idle();
  } finally {
    await mailer.close();
    await database.close();
  }
} catch (error) {
  if (!(error instanceof ConfigError || error instanceof BootstrapError || error instanceof ReviewError)) throw error;
  console.error(error.message);
  process.exitCode = 1;
}
