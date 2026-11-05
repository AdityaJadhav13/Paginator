// buildApp(deps): the Fastify instance with its plugins and routes, not yet listening (tests drive it with inject).
// Every /api/v1 and /api/auth answer says Cache-Control: no-store (story text must not stay in a shared PC's browser
// cache). Every error answer is an envelope with a request id and the baseline headers, except three that are written
// raw:
//   - Fastify's 503 while the server is closing (return503OnClosing);
//   - Node's 400 for an HTTP/1.1 request without a Host header, and its 417 for an Expect other than 100-continue.
// Browsers never send either of the last two.
import { createServer } from "node:http";
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
import { auditRoutes } from "./modules/audit/routes.ts";
import type { Auth } from "./modules/identity/auth.ts";
import { registerIdentity } from "./modules/identity/plugin.ts";
import { type Mailer, type Transport, openMailer, smtpTransport } from "./modules/notifications/mailer.ts";
import { notifier, type Outbox, sendAll } from "./modules/notifications/notify.ts";
import { notificationRoutes, startLive } from "./modules/notifications/routes.ts";
import { commentRoutes } from "./modules/stories/comments.ts";
import { deskBundleRoutes } from "./modules/stories/desk-bundle.ts";
import { editionRoutes } from "./modules/stories/editions.ts";
import { peopleRoutes } from "./modules/people/plugin.ts";
import { sectionRoutes } from "./modules/sections/routes.ts";
import { brandRoutes } from "./modules/brand/routes.ts";
import { settingsRoutes } from "./modules/settings/routes.ts";
import { storyRoutes } from "./modules/stories/routes.ts";
import { photoRoutes } from "./modules/media/photos.ts";
import { startEngineInbox } from "./modules/media/engine-inbox.ts";
import { libraryRoutes } from "./modules/media/library.ts";
import { uploadRoutes } from "./modules/media/uploads.ts";
import { importRoutes } from "./modules/media/imports.ts";
import { startMeasureSchedule } from "./modules/layout/measure.ts";
import { gatewayClient } from "./modules/editor/gateway.ts";
import { editorRoutes } from "./modules/editor/routes.ts";
import { adsRoutes } from "./modules/ads/routes.ts";
import { layoutRoutes } from "./modules/layout/routes.ts";
import { onboardingRoutes } from "./modules/onboarding/routes.ts";
import { releaseRoutes } from "./modules/release/routes.ts";
import { type PhotoFetch, newsRoutes } from "./modules/news/routes.ts";
import { startNewsSchedule } from "./modules/news/schedule.ts";
import { adSettingsRoutes, startAdCutoffSchedule } from "./modules/ads/cutoff.ts";
import { contactRoutes } from "./modules/contact/routes.ts";
import { type SignupOptions, signupRoutes } from "./modules/signup/routes.ts";
import { closeWhenStopping } from "./shutdown.ts";
import type { ObjectStore } from "./storage/object-store.ts";
import { s3Store } from "./storage/s3.ts";

const REQUEST_TIMEOUT_MS = 120_000;

/** An /api/v1 or /api/auth path, with or without its slash, a query or doubled slashes in front. */
export function isApiPath(url: string | undefined): boolean {
  return /^\/+api\/+(?:v1|auth)(?:[/?#]|$)/.test(url ?? "");
}

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
  /** How often a live-update stream re-checks its person (25 s; tests make it short). */
  liveHeartbeatMs?: number;
  /** Where the log lines go: standard output by default; tests read them. */
  logStream?: { write(line: string): void };
  /** The contact form's limits (src/modules/contact/routes.ts); tests make them small. */
  contactLimits?: { perHour: number; perDay: number; perDayAll: number };
  /** The pause before a dropped contact message's answer (ms); tests make it 0. */
  contactDropPause?: () => number;
  /** The paper sign-up's limits and drop pause (src/modules/signup/routes.ts); tests make them small. */
  signup?: Pick<SignupOptions, "limits" | "dropPause">;
  /** Runs the engine inbox's consumer and the queue's sweep (src/modules/media/engine-inbox.ts) while the app is open:
   * main.ts does; tests that do not drive them leave it out. */
  engineInbox?: boolean;
  /** How the news finder downloads a chosen photo: by default through the engine queue's guard (safeFetch); tests give
   * a fake, so none reaches the network. */
  fetchPhoto?: PhotoFetch;
};

export async function buildApp(deps: AppDeps) {
  const { config } = deps;
  const fastify = Fastify({
    // no tokens in the logs
    logger: {
      level: config.logLevel,
      serializers: { req: requestSerializer },
      ...(deps.logStream ? { stream: deps.logStream } : {}),
    },
    genReqId: requestId,
    childLoggerFactory,
    frameworkErrors: frameworkErrorHandler,
    clientErrorHandler,
    trustProxy: config.trustProxy.length > 0 ? config.trustProxy : false,
    bodyLimit: 1_048_576, // 1 MiB of JSON; a story's 200,000 characters of Devanagari are about 600 KB
    // A slow sender cannot hold a connection for ever. At 120 s a full 1 MiB body needs about 9 KB/s (a 600 KB story
    // about 5 KB/s); a phone on a poor link may manage less, so the story editor's autosave (PR 22) sends small bodies.
    requestTimeout: REQUEST_TIMEOUT_MS,
    // Fastify's own server, but an API path's answer says no-store from the first byte, so even the answers written
    // before any hook runs (the 503 while closing, a malformed URL) carry it
    // (with Fastify's settings: keep-alive 72 s, the request timeout above, no socket timeout)
    serverFactory: (handler) => {
      const server = createServer((request, response) => {
        if (isApiPath(request.url)) response.setHeader("cache-control", "no-store");
        handler(request, response);
      });
      server.keepAliveTimeout = 72_000;
      server.requestTimeout = REQUEST_TIMEOUT_MS;
      server.setTimeout(0);
      return server;
    },
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
  // no API answer is kept in a browser's HTTP cache, a refusal or a 404 included (and, through serverFactory and
  // BASELINE_HEADERS, those that Fastify or Node write without the hooks)
  fastify.addHook("onSend", async (request, reply) => {
    const kept = reply.statusCode === 200 && request.routeOptions.config.immutable === true;
    if (isApiPath(request.url) && !kept) reply.header("cache-control", "no-store");
  });
  const { afterSession } = await registerSecurity(fastify, config);
  fastify.setNotFoundHandler(async () => {
    throw new ApiError("not_found");
  });

  let people:
    | {
        auth: Auth;
        mailer: Mailer;
        database: Database;
        notify: ReturnType<typeof notifier>;
        mail: (outbox: Outbox) => void;
      }
    | undefined;
  let live: ReturnType<typeof startLive> | undefined;
  // Email, for sign-in and the newsroom (with the database) and for the website's contact form (with PGN_CONTACT_TO).
  // A mail server's message may name the recipient, so only its codes are logged.
  const mailer =
    database || config.contactTo !== undefined
      ? openMailer(config.mail, deps.mailTransport ?? smtpTransport(config.mail), (kind, error) => {
          const { code, responseCode } = error as { code?: string; responseCode?: number };
          fastify.log.warn({ kind, code, responseCode }, "an email was not sent");
        })
      : undefined;
  if (mailer) fastify.addHook("onClose", () => mailer.close());
  if (database && mailer) {
    const auth = await registerIdentity(fastify, { config, database, mailer });
    fastify.addHook("preValidation", afterSession); // the signed-in budget, once identity's hook read the session
    registerAccess(fastify, database); // after identity's hook, which reads the session
    const notify = notifier({ identity: database.identity, origin: config.publicOrigin });
    const mail = (outbox: Outbox) =>
      sendAll(mailer, outbox, (kind) => fastify.log.warn({ kind }, "an email was not sent: its address is refused"));
    people = { auth, mailer, database, notify, mail };
    live = startLive(fastify, database);
  }
  const store = deps.store ?? (config.storage ? s3Store(config.storage) : undefined);
  if (database && people && deps.engineInbox) {
    const inbox = startEngineInbox(database, fastify.log, store, config.engineSweep);
    fastify.addHook("preClose", () => inbox.close()); // before the database closes (onClose)
    // the news finder's collections, on their schedule (as the inbox, in the process that runs it)
    const schedule = startNewsSchedule(database, fastify.log, config.aiDailyCapInr);
    fastify.addHook("preClose", () => schedule.close());
    // the ads' missing-artwork alert at each date's cut-off (every minute)
    const cutoff = startAdCutoffSchedule(database, fastify.log, {
      identity: database.identity,
      mailer: people.mailer,
      origin: config.publicOrigin,
    });
    fastify.addHook("preClose", () => cutoff.close());
    // hosted layout's background measuring (it writes measure.json: only with the object store)
    if (store) {
      const measuring = startMeasureSchedule(database, store, fastify.log);
      fastify.addHook("preClose", () => measuring.close());
    }
  }

  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(health, {
    checks: { ...(store ? { storage: () => store.ready() } : {}), ...deps.checks },
  });
  // open to anyone, with or without the database: it keeps nothing
  await app.register(contactRoutes, {
    mailer,
    to: config.contactTo,
    ...(deps.contactLimits ? { limits: deps.contactLimits } : {}),
    ...(deps.contactDropPause ? { dropPause: deps.contactDropPause } : {}),
  });
  if (people) {
    await app.register(peopleRoutes, { ...people, config });
    await app.register(signupRoutes, { ...people, origin: config.publicOrigin, ...deps.signup });
    await app.register(storyRoutes, { database: people.database, notify: people.notify, mail: people.mail });
    await app.register(commentRoutes, { database: people.database, notify: people.notify });
    await app.register(editionRoutes, { database: people.database });
    await app.register(adSettingsRoutes, { database: people.database });
    await app.register(sectionRoutes, { database: people.database });
    await app.register(brandRoutes, { database: people.database });
    await app.register(settingsRoutes, { auth: people.auth, database: people.database });
    await app.register(auditRoutes, { database: people.database });
    // the page editor: through the edit gateway (without its settings, its routes answer 503 editor_unavailable)
    await app.register(editorRoutes, {
      database: people.database,
      gateway: config.gateway ? gatewayClient(config.gateway.url, config.gateway.secret) : undefined,
    });
    if (live) {
      await app.register(notificationRoutes, {
        database: people.database,
        hub: live,
        ...(deps.liveHeartbeatMs ? { heartbeatMs: deps.liveHeartbeatMs } : {}),
      });
    }
    // photos need the object store as well: without its settings their routes are not there
    if (store) {
      await app.register(uploadRoutes, { database: people.database, store });
      await app.register(photoRoutes, { database: people.database, store });
      await app.register(libraryRoutes, { database: people.database, store });
      await app.register(deskBundleRoutes, { database: people.database, store });
      await app.register(importRoutes, { database: people.database, store });
      await app.register(layoutRoutes, { database: people.database, store });
      await app.register(onboardingRoutes, { database: people.database, store });
      await app.register(adsRoutes, { database: people.database });
      await app.register(releaseRoutes, {
        database: people.database,
        store,
        retainDays: config.archiveRetainDays,
      });
      await app.register(newsRoutes, {
        database: people.database,
        store,
        capInr: config.aiDailyCapInr,
        aiOn: config.newsAi,
        ...(deps.fetchPhoto ? { fetchPhoto: deps.fetchPhoto } : {}),
      });
    }
  }
  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
