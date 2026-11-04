// The API's settings, read from the environment and checked with Zod, and those of the migration command. No secret
// has a default: every password must come from the environment, and no message ever shows one.
import { z } from "zod";
import { PLAIN_ADDRESS } from "./modules/notifications/mailer.ts";

const ADDRESS = z.union([z.ipv4(), z.ipv6(), z.cidrv4(), z.cidrv6()]);
const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

function wholeNumber(min: number, max: number) {
  return z
    .string()
    .refine((text) => /^[0-9]{1,6}$/.test(text) && Number(text) >= min && Number(text) <= max, {
      error: `must be a whole number from ${min} to ${max}`,
    })
    .transform(Number);
}

/** A comma-separated list whose every entry passes `ok`; the message names the entries that do not. */
function list(ok: (entry: string) => boolean, explain: string) {
  return z
    .string()
    .transform((text) =>
      text
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== ""),
    )
    .refine((entries) => entries.every(ok), {
      error: (issue) => `${explain}; not ${(issue.input as string[]).filter((entry) => !ok(entry)).join(", ")}`,
    });
}

/** The 128 bits of an IPv6 address, written with "::" or with an IPv4 tail (already checked to be an address). */
function ipv6Bits(address: string): bigint {
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(address);
  const text = tail
    ? `${address.slice(0, tail.index)}${((Number(tail[1]) << 8) | Number(tail[2])).toString(16)}:${((Number(tail[3]) << 8) | Number(tail[4])).toString(16)}`
    : address;
  const [head = "", rest] = text.split("::");
  const left = head === "" ? [] : head.split(":");
  const right = rest === undefined || rest === "" ? [] : rest.split(":");
  const groups =
    rest === undefined ? left : [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right];
  return groups.reduce((bits, group) => (bits << 16n) | BigInt(Number.parseInt(group, 16)), 0n);
}

const MAPPED = ipv6Bits("::ffff:0:0"); // ::ffff:0:0/96 holds every IPv4 address, as IPv6 sees them

/**
 * A proxy range that trusts too much: an IPv4 range wider than /8 (also when written as an IPv4-mapped IPv6 range,
 * ::ffff:a.b.c.d/104 or wider), an IPv6 range wider than /16, or any range that holds ::ffff:0:0/96. Trusting it would
 * let a client name its own address, and so its request budget. The last rule is cautious: Fastify's proxy-addr maps
 * an IPv4 client to IPv4 before it compares, so a range such as ::/80 would not in fact expose IPv4 clients.
 */
function tooWide(entry: string): boolean {
  const [address = "", prefix] = entry.split("/");
  // one address, or not valid at all (the other check reports that)
  if (prefix === undefined || !ADDRESS.safeParse(entry).success) return false;
  const bits = Number(prefix);
  if (!address.includes(":")) return bits < 8;
  if (bits < 16) return true;
  const value = ipv6Bits(address);
  if (bits <= 96) return value >> BigInt(128 - bits) === MAPPED >> BigInt(128 - bits); // holds the mapped range
  return value >> 32n === MAPPED >> 32n && bits < 96 + 8; // inside it: an IPv4 range wider than /8
}

/** A password: it must be set, and be more than white space (Postgres would store an empty one as no password). */
function password() {
  return z
    .string({ error: "must be set: it is a password, so it has no default" })
    .refine((text) => /\S/.test(text), { error: "must not be empty or only white space" });
}

/** Where the database is (plan §7.1: the development compose's port by default). */
const DATABASE = {
  PGN_DB_HOST: z.string().min(1, { error: "must not be empty" }).default("127.0.0.1"),
  PGN_DB_PORT: wholeNumber(1, 65535).default(55432),
  PGN_DB_NAME: z.string().min(1, { error: "must not be empty" }).default("pageinator"),
  // node-postgres and libpq read PGSSLMODE themselves; it is here so that production can insist on it
  PGSSLMODE: z.string().optional(),
  NODE_ENV: z.string().optional(),
};

/** In production (NODE_ENV=production, which the images set), the connection to the database is TLS with the server's
 * certificate and name checked: PGSSLMODE verify-full or verify-ca. Anything else (disable, no-verify, require, none)
 * would send the passwords in clear, or to whoever answers. A database on this machine, and pilot-local's scratch one
 * (db-local, on Docker's own network), are exempt. */
function databaseTls(
  env: { NODE_ENV?: string | undefined; PGSSLMODE?: string | undefined; PGN_DB_HOST: string },
  context: z.core.$RefinementCtx,
): void {
  if (env.NODE_ENV !== "production" || LOOPBACK.has(env.PGN_DB_HOST) || env.PGN_DB_HOST === "db-local") return;
  if (env.PGSSLMODE !== "verify-full" && env.PGSSLMODE !== "verify-ca") {
    context.addIssue({
      code: "custom",
      path: ["PGSSLMODE"],
      message: `must be verify-full or verify-ca in production, not ${env.PGSSLMODE ?? "unset"}`,
    });
  }
}

/** An origin as browsers send it in the Origin header: scheme, host and port, nothing more. */
function isOrigin(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (url.protocol === "https:" || url.protocol === "http:") && url.origin === value;
}

/** A sender: a plain address, or a short name and a plain address in angle brackets. */
function isSender(value: string): boolean {
  const named = /^([^<>"\r\n]{1,64}) <([^<>]+)>$/.exec(value);
  return named ? PLAIN_ADDRESS.test(named[2] ?? "") : PLAIN_ADDRESS.test(value);
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
const SMTP_TLS = ["starttls", "implicit", "none"] as const;

/** The object store's settings, shared by the API and scripts/dev-buckets.ts. */
const STORAGE = {
  // Files (plan §6): the object store, SeaweedFS on this machine in development (§6.5), S3 in the pilot. Photo
  // uploads and downloads are on only when the key pair is set. Plain http only for a store on this machine.
  PGN_S3_ENDPOINT: z
    .string()
    .refine(isOrigin, { error: "must be an origin such as https://s3.ap-south-1.amazonaws.com (no path)" })
    .default("http://127.0.0.1:58333"),
  PGN_S3_REGION: z
    .string()
    .regex(/^[a-z]{2}(-[a-z]+)+-[0-9]$/, { error: "must be a region such as ap-south-1" })
    .default("ap-south-1"),
  PGN_S3_ACCESS_KEY_ID: z.string().min(1, { error: "must not be empty" }).optional(),
  PGN_S3_SECRET_ACCESS_KEY: password().optional(),
  PGN_S3_WORK_BUCKET: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, { error: "must be a bucket name" })
    .default("pgn-dev-work"),
  PGN_S3_ARCHIVE_BUCKET: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, { error: "must be a bucket name" })
    .default("pgn-dev-archive"),
};

const Env = z
  .object({
    PGN_API_HOST: z.string().min(1, { error: "must not be empty" }).default("127.0.0.1"),
    PGN_API_PORT: wholeNumber(1, 65535).default(8780),
    // The proxy whose X-Forwarded-For is believed (§4.7). Required behind any proxy (Caddy in the pilot): without
    // it the API sees every client as the proxy's address. None by default.
    PGN_TRUST_PROXY: list((entry) => ADDRESS.safeParse(entry).success, "must be IP addresses or CIDR ranges")
      .refine((entries) => !entries.some(tooWide), {
        error: (issue) =>
          "must not trust a range wider than /8 for IPv4 (or ::ffff:…/104 written as IPv6) or /16 for IPv6, nor one " +
          `holding ::ffff:0:0/96: ranges this wide are refused; not ${(issue.input as string[]).filter(tooWide).join(", ")}`,
      })
      .default([]),
    // seconds a stop (SIGTERM, SIGINT) waits for requests in flight before closing their connections
    PGN_SHUTDOWN_GRACE_S: wholeNumber(0, 600).default(10),
    // The engine sweep (src/modules/media/engine-inbox.ts), overridable for an operator's check: how long a spent job
    // stays locked before its worker counts as dead (at least the hour the database's policy waits), and how long an
    // asset waits with no job and no event before it is called lost.
    PGN_ENGINE_STALE_S: wholeNumber(3600, 86_400).default(7200),
    PGN_ENGINE_DEADLINE_S: wholeNumber(60, 86_400).default(1800),
    // The news finder's AI spend allowed a day per publication, in rupees (docs/product/13-news-finder.md): the queue
    // refuses a Claude call once it is spent.
    PGN_AI_DAILY_CAP_INR: wholeNumber(0, 1_000_000).default(300),
    // Whether the engine queue has a Claude key (on when ANTHROPIC_API_KEY is set there; empty is off): with it off the
    // Sources screen says so from the start and a pick is refused (ai_off) instead of queued to fail.
    PGN_NEWS_AI: z.enum(["on", "off", ""], { error: "must be on or off" }).default("off"),
    PGN_LOG_LEVEL: z.enum(LOG_LEVELS, { error: `must be one of ${LOG_LEVELS.join(", ")}` }).default("info"),
    // The security baseline (§4.5–4.6). The web app's origins: in production exactly the app's own origin; in
    // development Vite on 127.0.0.1:5180 (§7.1).
    PGN_ALLOWED_ORIGINS: list(isOrigin, "must be origins such as https://app.example.test (no path)")
      .refine((origins) => origins.length > 0, { error: "must name at least one origin" })
      .default(["http://127.0.0.1:5180"]),
    // Request limits (src/http/rate-limit.ts): per client address for signed-out requests; per person for signed-in
    // /api/v1 requests (autosave every 1.5 s is 40 a minute, plus the lists and live-update fetches); and a ceiling
    // per address on requests that carry a session cookie (a newsroom of twenty behind one address fits under it).
    PGN_RATE_LIMIT_PER_MINUTE: wholeNumber(1, 100_000).default(60),
    PGN_RATE_LIMIT_PER_PERSON_PER_MINUTE: wholeNumber(1, 100_000).default(300),
    PGN_RATE_LIMIT_SIGNED_IN_PER_ADDRESS_PER_MINUTE: wholeNumber(1, 100_000).default(6000),
    // The database (plan §3.1): one login role per connection pool, each with its own password (.env.dev in
    // development).
    ...DATABASE,
    PGN_APP_PASSWORD: password(),
    PGN_AUTH_PASSWORD: password(),
    PGN_LISTEN_PASSWORD: password(),
    // Sign-in (plan §4.1): the origin people use, which emailed links name (one of PGN_ALLOWED_ORIGINS; by default
    // the first), and the secret that signs sessions and emailed tokens.
    PGN_PUBLIC_ORIGIN: z
      .string()
      .refine(isOrigin, { error: "must be an origin such as https://app.example.test (no path)" })
      .optional(),
    PGN_AUTH_SECRET: z
      .string({ error: "must be set: it is a secret, so it has no default" })
      .refine((text) => text.length >= 32 && /\S/.test(text), { error: "must be at least 32 characters" }),
    // Email: Mailpit in development (plan §7.1). TLS is STARTTLS unless the server is on this machine.
    PGN_SMTP_HOST: z.string().min(1, { error: "must not be empty" }).default("127.0.0.1"),
    PGN_SMTP_PORT: wholeNumber(1, 65535).default(51025),
    PGN_SMTP_TLS: z.enum(SMTP_TLS, { error: `must be one of ${SMTP_TLS.join(", ")}` }).optional(),
    PGN_SMTP_USER: z.string().min(1, { error: "must not be empty" }).optional(),
    PGN_SMTP_PASSWORD: password().optional(),
    PGN_MAIL_FROM: z
      .string()
      .refine(isSender, { error: "must be an address, or a name and <address>" })
      .default("Pageinator <no-reply@example.test>"),
    // The public website's contact form (POST /api/v1/contact): the one address its messages go to, chosen by the
    // owner at deploy and never committed. Unset, the form answers 503 contact_unavailable.
    PGN_CONTACT_TO: z
      .string()
      .refine((text) => text.length <= 254 && PLAIN_ADDRESS.test(text), { error: "must be one plain address" })
      .optional(),
    ...STORAGE,
    // Better Auth reads these from the environment itself, whatever our settings say: the first two can turn its
    // telemetry on, BETTER_AUTH_SECRETS replaces PGN_AUTH_SECRET, and BETTER_AUTH_TRUSTED_ORIGINS widens the
    // origins and redirect targets it accepts. The API refuses to start with any of them.
    BETTER_AUTH_TELEMETRY: z.undefined({ error: "must not be set: the API sends no telemetry" }).optional(),
    BETTER_AUTH_TELEMETRY_ENDPOINT: z.undefined({ error: "must not be set: the API sends no telemetry" }).optional(),
    BETTER_AUTH_SECRETS: z.undefined({ error: "must not be set: the sign-in secret is PGN_AUTH_SECRET" }).optional(),
    BETTER_AUTH_TRUSTED_ORIGINS: z
      .undefined({ error: "must not be set: the allowed origins are PGN_ALLOWED_ORIGINS" })
      .optional(),
  })
  .superRefine((env, context) => {
    databaseTls(env, context);
    if (env.PGN_PUBLIC_ORIGIN !== undefined && !env.PGN_ALLOWED_ORIGINS.includes(env.PGN_PUBLIC_ORIGIN)) {
      context.addIssue({ code: "custom", path: ["PGN_PUBLIC_ORIGIN"], message: "must be one of PGN_ALLOWED_ORIGINS" });
    }
    if (env.PGN_SMTP_TLS === "none" && !LOOPBACK.has(env.PGN_SMTP_HOST)) {
      context.addIssue({
        code: "custom",
        path: ["PGN_SMTP_TLS"],
        message: "may be none only for a server on this machine",
      });
    }
    if ((env.PGN_SMTP_USER === undefined) !== (env.PGN_SMTP_PASSWORD === undefined)) {
      context.addIssue({ code: "custom", path: ["PGN_SMTP_USER"], message: "and PGN_SMTP_PASSWORD go together" });
    }
    if ((env.PGN_S3_ACCESS_KEY_ID === undefined) !== (env.PGN_S3_SECRET_ACCESS_KEY === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["PGN_S3_ACCESS_KEY_ID"],
        message: "and PGN_S3_SECRET_ACCESS_KEY go together",
      });
    }
    const store = new URL(env.PGN_S3_ENDPOINT);
    if (store.protocol === "http:" && !LOOPBACK.has(store.hostname.replace(/^\[|\]$/g, ""))) {
      context.addIssue({
        code: "custom",
        path: ["PGN_S3_ENDPOINT"],
        message: "may be http only for a store on this machine",
      });
    }
  })
  .transform((env) => ({
    host: env.PGN_API_HOST,
    port: env.PGN_API_PORT,
    trustProxy: env.PGN_TRUST_PROXY,
    shutdownGraceSeconds: env.PGN_SHUTDOWN_GRACE_S,
    engineSweep: { staleMs: env.PGN_ENGINE_STALE_S * 1000, deadlineMs: env.PGN_ENGINE_DEADLINE_S * 1000 },
    aiDailyCapInr: env.PGN_AI_DAILY_CAP_INR,
    newsAi: env.PGN_NEWS_AI === "on",
    logLevel: env.PGN_LOG_LEVEL,
    allowedOrigins: env.PGN_ALLOWED_ORIGINS,
    rateLimitPerMinute: env.PGN_RATE_LIMIT_PER_MINUTE,
    rateLimitPerPersonPerMinute: env.PGN_RATE_LIMIT_PER_PERSON_PER_MINUTE,
    rateLimitSignedInPerAddressPerMinute: env.PGN_RATE_LIMIT_SIGNED_IN_PER_ADDRESS_PER_MINUTE,
    database: {
      host: env.PGN_DB_HOST,
      port: env.PGN_DB_PORT,
      name: env.PGN_DB_NAME,
      passwords: { app: env.PGN_APP_PASSWORD, auth: env.PGN_AUTH_PASSWORD, listen: env.PGN_LISTEN_PASSWORD },
    },
    publicOrigin: env.PGN_PUBLIC_ORIGIN ?? env.PGN_ALLOWED_ORIGINS[0] ?? "",
    authSecret: env.PGN_AUTH_SECRET,
    storage: storageOf(env),
    mail: {
      host: env.PGN_SMTP_HOST,
      port: env.PGN_SMTP_PORT,
      tls: env.PGN_SMTP_TLS ?? (LOOPBACK.has(env.PGN_SMTP_HOST) ? "none" : "starttls"),
      from: env.PGN_MAIL_FROM,
      ...(env.PGN_SMTP_USER !== undefined && env.PGN_SMTP_PASSWORD !== undefined
        ? { auth: { user: env.PGN_SMTP_USER, pass: env.PGN_SMTP_PASSWORD } }
        : {}),
    },
    contactTo: env.PGN_CONTACT_TO,
  }));

type StorageEnv = {
  PGN_S3_ENDPOINT: string;
  PGN_S3_REGION: string;
  PGN_S3_ACCESS_KEY_ID?: string | undefined;
  PGN_S3_SECRET_ACCESS_KEY?: string | undefined;
  PGN_S3_WORK_BUCKET: string;
  PGN_S3_ARCHIVE_BUCKET: string;
};

function storageOf(env: StorageEnv) {
  if (env.PGN_S3_ACCESS_KEY_ID === undefined || env.PGN_S3_SECRET_ACCESS_KEY === undefined) return undefined;
  return {
    endpoint: env.PGN_S3_ENDPOINT,
    region: env.PGN_S3_REGION,
    accessKeyId: env.PGN_S3_ACCESS_KEY_ID,
    secretAccessKey: env.PGN_S3_SECRET_ACCESS_KEY,
    // SeaweedFS (and any store on this machine) answers by path; S3 itself by bucket host name
    forcePathStyle: LOOPBACK.has(new URL(env.PGN_S3_ENDPOINT).hostname.replace(/^\[|\]$/g, "")),
    workBucket: env.PGN_S3_WORK_BUCKET,
    archiveBucket: env.PGN_S3_ARCHIVE_BUCKET,
  };
}

/** scripts/dev-buckets.ts's settings: the object store's only. */
const StorageOnlyEnv = z.object(STORAGE).transform((env) => storageOf(env));

/** The migration command's settings (pnpm --filter @pageinator/api db:migrate, and db:codegen): it signs in as
 * pgn_migrator. */
const MigratorEnv = z
  .object({ ...DATABASE, PGN_MIGRATOR_PASSWORD: password() })
  .superRefine(databaseTls)
  .transform((env) => ({
    host: env.PGN_DB_HOST,
    port: env.PGN_DB_PORT,
    name: env.PGN_DB_NAME,
    password: env.PGN_MIGRATOR_PASSWORD,
  }));

/** scripts/db-backup.ts's settings (docs/runbooks/restore.md): it signs in as pgn_backup (read-only, BYPASSRLS) and
 * writes to the backups bucket, each dump under Object Lock for PGN_BACKUP_RETAIN_DAYS. */
const BackupEnv = z
  .object({
    ...DATABASE,
    ...STORAGE,
    PGN_BACKUP_PASSWORD: password(),
    PGN_S3_BACKUPS_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, { error: "must be a bucket name" }),
    PGN_BACKUP_RETAIN_DAYS: wholeNumber(1, 3650).default(35),
  })
  .superRefine(databaseTls)
  .transform((env, context) => {
    const storage = storageOf(env);
    if (!storage) {
      context.addIssue({
        code: "custom",
        path: ["PGN_S3_ACCESS_KEY_ID"],
        message: "and PGN_S3_SECRET_ACCESS_KEY must be set",
      });
      return z.NEVER;
    }
    return {
      database: {
        host: env.PGN_DB_HOST,
        port: env.PGN_DB_PORT,
        name: env.PGN_DB_NAME,
        password: env.PGN_BACKUP_PASSWORD,
      },
      storage,
      bucket: env.PGN_S3_BACKUPS_BUCKET,
      retainDays: env.PGN_BACKUP_RETAIN_DAYS,
    };
  });

export type Config = z.output<typeof Env>;
export type MigratorConfig = z.output<typeof MigratorEnv>;
export type BackupConfig = z.output<typeof BackupEnv>;

/** The settings are not right; the message lists every problem, one per line. */
export class ConfigError extends Error {}

function parse<T>(schema: z.ZodType<T>, env: Readonly<Record<string, string | undefined>>, whose: string): T {
  const result = schema.safeParse(env);
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) => `  - ${String(issue.path[0])} ${issue.message}`);
  throw new ConfigError([`${whose} settings are not right:`, ...problems].join("\n"));
}

export function loadConfig(env: Readonly<Record<string, string | undefined>>): Config {
  return parse(Env, env, "The API's");
}

export function loadStorageConfig(env: Readonly<Record<string, string | undefined>>) {
  return parse(StorageOnlyEnv, env, "The object store's");
}

export function loadBackupConfig(env: Readonly<Record<string, string | undefined>>): BackupConfig {
  return parse(BackupEnv, env, "The backup command's");
}

export function loadMigratorConfig(env: Readonly<Record<string, string | undefined>>): MigratorConfig {
  return parse(MigratorEnv, env, "The migration command's");
}
