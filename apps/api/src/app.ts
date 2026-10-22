// buildApp(deps): the Fastify instance with its plugins and routes, not yet listening (tests drive it with inject).
// Every error answer is an envelope with a request id and the baseline headers, except three that are written raw:
//   - Fastify's 503 while the server is closing (return503OnClosing);
//   - Node's 400 for an HTTP/1.1 request without a Host header, and its 417 for an Expect other than 100-continue.
// Browsers never send either of the last two.
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import type { Config } from "./config.ts";
import type { Database } from "./db/pools.ts";
import { REQUEST_ID_HEADER, childLoggerFactory, requestId } from "./http/context.ts";
import { ApiError, clientErrorHandler, errorHandler, frameworkErrorHandler } from "./http/errors.ts";
import { health, type Checks } from "./http/health.ts";
import { requestSerializer } from "./http/log.ts";
import { registerSecurity } from "./http/security.ts";
import { registerAccess } from "./modules/access/access.ts";
import type { Auth } from "./modules/identity/auth.ts";
import { registerIdentity } from "./modules/identity/plugin.ts";
import { type Mailer, type Transport, openMailer, smtpTransport } from "./modules/notifications/mailer.ts";
import { peopleRoutes } from "./modules/people/plugin.ts";
import { storyRoutes } from "./modules/stories/routes.ts";
import { uploadRoutes } from "./modules/media/uploads.ts";
import { closeWhenStopping } from "./shutdown.ts";
import type { ObjectStore } from "./storage/object-store.ts";
import { s3Store } from "./storage/s3.ts";

export type AppDeps = {
  config: Config;
  /** The database, opened by main.ts (src/db/pools.ts): the app logs its connections' errors and closes it when the
   * app closes. With it, sign-in is on (/api/auth/*). Tests that need no database leave it out. */
  database?: Database;
  /** The object store: by default the one of the settings (PGN_S3_*), when they name a key pair. */
  store?: ObjectStore;
  /** Where email goes: by default the SMTP server of the settings (Mailpit in development); tests catch it. */
  mailTransport?: Transport;
  /** Dependency checks for /readyz; a dependency without one is reported as not configured. */
  checks: Checks;
};

export async function buildApp(deps: AppDeps) {
  const { config } = deps;
  const fastify = Fastify({
    logger: { level: config.logLevel, serializers: { req: requestSerializer } }, // no tokens in the logs
    genReqId: requestId,
    childLoggerFactory,
    frameworkErrors: frameworkErrorHandler,
    clientErrorHandler,
    trustProxy: config.trustProxy.length > 0 ? config.trustProxy : false,
    bodyLimit: 1_048_576, // 1 MiB of JSON; a story's 200,000 characters of Devanagari are about 600 KB
    // A slow sender cannot hold a connection for ever. At 120 s a full 1 MiB body needs about 9 KB/s (a 600 KB story
    // about 5 KB/s); a phone on a poor link may manage less, so the story editor's autosave (PR 22) sends small bodies.
    requestTimeout: 120_000,
  });
  fastify.setErrorHandler(errorHandler);
  fastify.removeContentTypeParser("text/plain"); // bodies are JSON only
  const { database } = deps;
  if (database) {
    database.onConnectionError((role, error) => {
      fastify.log.warn(
        { role, code: (error as NodeJS.ErrnoException).code },
        `a database connection failed: ${error.message}`,
      );
    });
    fastify.addHook("onClose", () => database.close());
  }

  // first, so that every answer carries the request id, including a refusal by a later hook
  fastify.addHook("onRequest", async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id);
  });
  fastify.addHook("onSend", closeWhenStopping);
  await registerSecurity(fastify, config);
  fastify.setNotFoundHandler(async () => {
    throw new ApiError("not_found");
  });

  let people: { auth: Auth; mailer: Mailer; database: Database } | undefined;
  if (database) {
    // a mail server's message may name the recipient, so only its codes are logged
    const mailer = openMailer(config.mail, deps.mailTransport ?? smtpTransport(config.mail), (kind, error) => {
      const { code, responseCode } = error as { code?: string; responseCode?: number };
      fastify.log.warn({ kind, code, responseCode }, "an email was not sent");
    });
    const auth = await registerIdentity(fastify, { config, database, mailer });
    registerAccess(fastify, database); // after identity's hook, which reads the session
    people = { auth, mailer, database };
  }

  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  const store = deps.store ?? (config.storage ? s3Store(config.storage) : undefined);
  await app.register(health, {
    checks: { ...(store ? { storage: () => store.ready() } : {}), ...deps.checks },
  });
  if (people) {
    await app.register(peopleRoutes, { ...people, config });
    await app.register(storyRoutes, { database: people.database });
    // photos need the object store as well: without its settings their routes are not there
    if (store) await app.register(uploadRoutes, { database: people.database, store });
  }
  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
