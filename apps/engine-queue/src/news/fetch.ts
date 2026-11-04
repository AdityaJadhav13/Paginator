// The news finder's one way onto the internet (feeds, articles, robots.txt, photo searches, and the API's download of a
// chosen photo): http(s) only, a product User-Agent, a time limit over the whole request, a byte limit counted as the
// body streams in, at most a few redirects, each checked again. The SSRF guard checks the addresses actually
// connected to (a lookup of our own on every request), so a name that answers with a private address, at first or
// on a later lookup (DNS rebinding), is refused.
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";
import type { Readable } from "node:stream";

export const NEWS_USER_AGENT = "Pageinator-NewsFinder/1.0 (newspaper production software; feeds and press photos)";

export type FetchCode =
  | "fetch.scheme"
  | "fetch.private_address"
  | "fetch.too_large"
  | "fetch.timeout"
  | "fetch.redirects"
  | "fetch.status"
  | "fetch.type"
  | "fetch.network"
  | "fetch.robots";

/** A fetch refused or failed, in plain words (never the body). `status` is the server's answer for fetch.status. */
export class FetchRefused extends Error {
  readonly code: FetchCode;
  readonly status: number | null;
  constructor(code: FetchCode, message: string, status: number | null = null) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export type SafeFetchOptions = {
  maxBytes: number;
  timeoutMs: number;
  maxRedirects?: number;
  accept?: string;
  /** allowed content-type prefixes (lower case); any other type is refused */
  types?: readonly string[];
  userAgent?: string;
  signal?: AbortSignal;
};

export type Fetched = { url: string; status: number; contentType: string; body: Buffer };
export type Fetcher = (url: string, options: SafeFetchOptions) => Promise<Fetched>;

type Lookup = (
  host: string,
  options: dns.LookupAllOptions,
  callback: (error: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void,
) => void;
/** For tests only: the name lookup, and which addresses count as public. */
export type FetchSeams = { lookup?: Lookup; isPublic?: (ip: string) => boolean };

const BLOCKED = new net.BlockList();
for (const [net4, bits] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local (cloud metadata)
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, and broadcast
] as const)
  BLOCKED.addSubnet(net4, bits, "ipv4");
for (const [net6, bits] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96], // NAT64: another network's address inside
  ["64:ff9b:1::", 48],
  ["100::", 64], // discard
  ["2001::", 23], // IETF protocol assignments (Teredo among them)
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4: another network's address inside
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local
  ["ff00::", 8], // multicast
] as const)
  BLOCKED.addSubnet(net6, bits, "ipv6");

/** True for an address on the public internet; false for private, loopback, link-local, CGNAT, multicast, reserved,
 * unique-local and documentation addresses, the same inside an IPv4-mapped IPv6 address, and anything not an IP. */
export function isPublicAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return !BLOCKED.check(ip, "ipv4");
  if (family !== 6) return false;
  const v4 = mappedV4(ip);
  if (v4 !== undefined) return isPublicAddress(v4);
  return !BLOCKED.check(ip, "ipv6");
}

/** The IPv4 address an IPv4-mapped (::ffff:a.b.c.d, in either spelling) or IPv4-compatible (::a.b.c.d) IPv6 address
 * carries, or undefined. `ip` is a valid IPv6 address (net.isIP). */
function mappedV4(ip: string): string | undefined {
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  const text = tail
    ? ip.slice(0, tail.index) + [1, 3].map((i) => ((Number(tail[i]) << 8) | Number(tail[i + 1])).toString(16)).join(":")
    : ip;
  const [head = "", rest] = text.split("::");
  const left = head ? head.split(":") : [];
  const right = rest ? rest.split(":") : [];
  const groups = [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right].map((g) =>
    parseInt(g, 16),
  );
  // ::ffff:0:a.b.c.d (IPv4-translated) carries an IPv4 address as well
  if (groups[4] === 0xffff && groups[5] === 0 && groups.slice(0, 4).every((g) => g === 0))
    [groups[4], groups[5]] = [0, 0xffff];
  if (groups.slice(0, 5).some((g) => g !== 0)) return undefined;
  const [hi = 0, lo = 0] = groups.slice(6);
  // ::ffff:x (mapped), or ::x (compatible) but not :: and ::1, which the block list names
  if (groups[5] !== 0xffff && (groups[5] !== 0 || hi === 0)) return undefined;
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** GETs `url` within the options' limits; refuses (FetchRefused) anything outside them. */
export async function safeFetch(url: string, options: SafeFetchOptions, seams: FetchSeams = {}): Promise<Fetched> {
  const allowed = seams.isPublic ?? isPublicAddress;
  const lookup: Lookup = seams.lookup ?? ((host, o, cb) => dns.lookup(host, o, cb));
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new FetchRefused("fetch.timeout", `no full answer within ${options.timeoutMs} ms`)),
    options.timeoutMs,
  );
  const cancel = () =>
    controller.abort(new FetchRefused("fetch.network", "the request was cancelled (the queue is stopping)"));
  if (options.signal?.aborted) cancel();
  options.signal?.addEventListener("abort", cancel, { once: true });
  try {
    let current = parse(url);
    for (let hop = 0; ; hop++) {
      const res = await request(current, options, controller.signal, lookup, allowed);
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (REDIRECTS.has(status) && location) {
        res.destroy();
        if (hop >= (options.maxRedirects ?? 3)) throw new FetchRefused("fetch.redirects", "too many redirects");
        current = parse(new URL(location, current).href);
        continue;
      }
      if (status < 200 || status > 299) {
        res.destroy();
        throw new FetchRefused("fetch.status", `the server answered ${status}`, status);
      }
      const contentType = (res.headers["content-type"] ?? "").toLowerCase();
      if (options.types && !options.types.some((t) => contentType.startsWith(t))) {
        res.destroy();
        throw new FetchRefused("fetch.type", `not an accepted type (${contentType.slice(0, 80) || "none given"})`);
      }
      if (Number(res.headers["content-length"] ?? 0) > options.maxBytes) {
        res.destroy();
        throw tooLarge(options.maxBytes);
      }
      const body = await read(decoded(res), options.maxBytes, controller.signal);
      return { url: current.href, status, contentType, body };
    }
  } catch (error) {
    const reason: unknown = controller.signal.reason;
    if (reason instanceof FetchRefused) throw reason;
    if (error instanceof FetchRefused) throw error;
    throw new FetchRefused("fetch.network", "the site could not be reached");
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  }
}

function parse(url: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new FetchRefused("fetch.scheme", "not a web address");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:")
    throw new FetchRefused("fetch.scheme", "only http and https addresses are fetched");
  if (u.username || u.password) throw new FetchRefused("fetch.scheme", "an address with a password is not fetched");
  return u;
}

const privateAddress = () => new FetchRefused("fetch.private_address", "the address is not on the public internet");
const tooLarge = (max: number) => new FetchRefused("fetch.too_large", `larger than ${max} bytes`);

function request(
  url: URL,
  options: SafeFetchOptions,
  signal: AbortSignal,
  lookup: Lookup,
  allowed: (ip: string) => boolean,
): Promise<http.IncomingMessage> {
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
  // an address written as an IP is connected to without any lookup: checked here
  if (net.isIP(host) && !allowed(host)) return Promise.reject(privateAddress());
  const guarded = (
    name: string,
    o: dns.LookupOptions,
    cb: (e: NodeJS.ErrnoException | null, a: string | dns.LookupAddress[], f?: number) => void,
  ) =>
    lookup(name, { ...o, all: true }, (error, addresses) => {
      if (error) return cb(error, []);
      const first = addresses[0];
      if (!first || addresses.some((a) => !allowed(a.address))) return cb(privateAddress(), []);
      if (o.all) cb(null, addresses);
      else cb(null, first.address, first.family);
    });
  return new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? https : http).request(url, {
      method: "GET",
      headers: {
        "user-agent": options.userAgent ?? NEWS_USER_AGENT,
        accept: options.accept ?? "*/*",
        "accept-encoding": "gzip, deflate, br",
      },
      lookup: guarded as unknown as net.LookupFunction,
      agent: false, // a fresh connection, so every request goes through the guard
      signal,
    });
    req.on("response", resolve);
    req.on("error", reject);
    req.end();
  });
}

function decoded(res: http.IncomingMessage): Readable {
  switch ((res.headers["content-encoding"] ?? "").trim().toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return res.pipe(zlib.createGunzip());
    case "deflate":
      return res.pipe(zlib.createInflate());
    case "br":
      return res.pipe(zlib.createBrotliDecompress());
    default:
      return res;
  }
}

/** The body, decoded, refused as soon as it passes `max` bytes (a compressed bomb included). */
async function read(body: Readable, max: number, signal: AbortSignal): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  const stop = () => body.destroy();
  signal.addEventListener("abort", stop, { once: true });
  try {
    for await (const chunk of body as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > max) {
        body.destroy();
        throw tooLarge(max);
      }
      chunks.push(chunk);
    }
  } finally {
    signal.removeEventListener("abort", stop);
  }
  return Buffer.concat(chunks);
}
