// An API app with sign-in on, on a migrated clone of its own: the emails it sends are caught, not sent. Also a Better
// Auth instance on the same database for calls from the server itself (sign-up is closed over HTTP).
import { inject } from "vitest";
import { type App, buildApp } from "../../src/app.ts";
// the route config (access, permission) and request.access that src/modules/access/access.ts declares
import type {} from "../../src/modules/access/access.ts";
import { type Config, loadConfig } from "../../src/config.ts";
import { type Database, openDatabase } from "../../src/db/pools.ts";
import { type Auth, createAuth } from "../../src/modules/identity/auth.ts";
import type { PhotoFetch } from "../../src/modules/news/routes.ts";
import { type Transport, openMailer } from "../../src/modules/notifications/mailer.ts";
import type { ObjectStore } from "../../src/storage/object-store.ts";
import { s3Store } from "../../src/storage/s3.ts";
import type { TestDatabase } from "./helpers.ts";

export const ORIGIN = "https://app.example.test";
/** What the web app sends with every request that changes something. */
export const FROM_APP = { origin: ORIGIN, "x-pageinator": "1", "content-type": "application/json" } as const;
export const SECRET = "test-only-sign-in-secret-0123456789abcdef";

export type Sent = Parameters<Transport["sendMail"]>[0];

export type IdentityApp = {
  app: App;
  config: Config;
  database: Database;
  /** Better Auth for calls from the server itself (its emails are caught too) */
  server: Auth;
  sent: Sent[];
  close(): Promise<void>;
};

export async function identityApp(
  db: TestDatabase,
  env: Record<string, string> = {},
  /** Changes what the run's object store answers (a store that misbehaves) */
  storeOf?: (store: ObjectStore) => ObjectStore,
  /** How often live-update streams re-check their person (25 s by default) */
  liveHeartbeatMs?: number,
  /** How the news finder downloads a chosen photo (a fake: no test reaches the network) */
  fetchPhoto?: PhotoFetch,
): Promise<IdentityApp> {
  const run = inject("database");
  const storage = inject("storage");
  const config = loadConfig({
    PGN_LOG_LEVEL: "silent",
    PGN_ALLOWED_ORIGINS: ORIGIN,
    PGN_DB_HOST: run.host,
    PGN_DB_PORT: String(run.port),
    PGN_DB_NAME: db.name,
    PGN_APP_PASSWORD: run.passwords.app,
    PGN_AUTH_PASSWORD: run.passwords.auth,
    PGN_LISTEN_PASSWORD: run.passwords.listen,
    PGN_AUTH_SECRET: SECRET,
    PGN_S3_ENDPOINT: storage.endpoint,
    PGN_S3_ACCESS_KEY_ID: storage.accessKeyId,
    PGN_S3_SECRET_ACCESS_KEY: storage.secretAccessKey,
    PGN_S3_WORK_BUCKET: storage.bucket,
    // the tests sign in a few people who make many requests; test/db/rate-limit.test.ts sets its own budgets
    PGN_RATE_LIMIT_PER_PERSON_PER_MINUTE: "100000",
    PGN_RATE_LIMIT_SIGNED_IN_PER_ADDRESS_PER_MINUTE: "100000",
    // the news finder's AI part on (its queue is never run here); test/db/news-finder.test.ts turns it off once
    PGN_NEWS_AI: "on",
    ...env,
  });
  const sent: Sent[] = [];
  const transport: Transport = {
    sendMail: async (message) => void sent.push(message),
    close: () => undefined,
  };
  const database = openDatabase(config.database);
  const store = storeOf && config.storage ? storeOf(s3Store(config.storage)) : undefined;
  const app = await buildApp({
    config,
    database,
    mailTransport: transport,
    checks: {},
    ...(store ? { store } : {}),
    ...(liveHeartbeatMs ? { liveHeartbeatMs } : {}),
    ...(fetchPhoto ? { fetchPhoto } : {}),
  });
  const quiet = { warn: () => undefined, error: () => undefined };
  const mailer = openMailer(config.mail, transport, () => undefined);
  const serverDatabase = openDatabase(config.database);
  const server = createAuth({ config, database: serverDatabase, mailer, log: quiet });
  return {
    app,
    config,
    database,
    server,
    sent,
    async close() {
      await app.close();
      await serverDatabase.close();
    },
  };
}

/** The link of the last email sent to this address, as a path on the app. */
export function lastLink(sent: readonly Sent[], to: string): string {
  const mail = sent.filter((m) => m.to === to).at(-1);
  const link = mail?.text.match(new RegExp(`${ORIGIN.replace(/\./g, "\\.")}(/\\S+)`))?.[1];
  if (!link) throw new Error(`no email with a link was sent to ${to}`);
  return link;
}
