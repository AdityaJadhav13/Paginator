// The API's settings, read from the environment and checked with Zod. No secret has a default here: the settings
// that will hold one (database passwords, PR 5) must come from the environment.
import { z } from "zod";

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

/** An origin as browsers send it in the Origin header: scheme, host and port, nothing more. */
function isOrigin(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (url.protocol === "https:" || url.protocol === "http:") && url.origin === value;
}

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
    PGN_LOG_LEVEL: z.enum(LOG_LEVELS, { error: `must be one of ${LOG_LEVELS.join(", ")}` }).default("info"),
    // The security baseline (§4.5–4.6). The web app's origins: in production exactly the app's own origin; in
    // development Vite on 127.0.0.1:5180 (§7.1).
    PGN_ALLOWED_ORIGINS: list(isOrigin, "must be origins such as https://app.example.test (no path)")
      .refine((origins) => origins.length > 0, { error: "must name at least one origin" })
      .default(["http://127.0.0.1:5180"]),
    PGN_RATE_LIMIT_PER_MINUTE: wholeNumber(1, 100_000).default(60),
  })
  .transform((env) => ({
    host: env.PGN_API_HOST,
    port: env.PGN_API_PORT,
    trustProxy: env.PGN_TRUST_PROXY,
    shutdownGraceSeconds: env.PGN_SHUTDOWN_GRACE_S,
    logLevel: env.PGN_LOG_LEVEL,
    allowedOrigins: env.PGN_ALLOWED_ORIGINS,
    rateLimitPerMinute: env.PGN_RATE_LIMIT_PER_MINUTE,
  }));

export type Config = z.output<typeof Env>;

/** The settings are not right; the message lists every problem, one per line. */
export class ConfigError extends Error {}

export function loadConfig(env: Readonly<Record<string, string | undefined>>): Config {
  const result = Env.safeParse(env);
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) => `  - ${String(issue.path[0])} ${issue.message}`);
  throw new ConfigError(["The API's settings are not right:", ...problems].join("\n"));
}
