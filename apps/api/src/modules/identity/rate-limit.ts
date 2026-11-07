// Better Auth's per-address rate limits (auth.ts, rateLimit), kept in identity."rateLimit" by our own statements
// instead of Better Auth's database storage. Better Auth keys a limit by "<address>|<path>", and a path can carry a
// secret: /reset-password/<token> would put an opened, unused reset token in plain text in the table, beside the
// hashed copy (verification.storeIdentifier). Here every path segment that is not a route name becomes ":param"
// before the key is stored, so no key holds a token, and a guessed path cannot make a row of its own. Rows whose last
// request is older than the longest window are deleted now and then, as Better Auth's storage does.
import type { IdentityStore } from "../../db/identity.ts";

const ROUTE_NAME = /^[a-z]+(?:-[a-z]+)*$/;
const PRUNE_EVERY = 500;
const KEEP_MS = 2 * 3600_000; // twice the longest window (1 h)

/** The key to store for Better Auth's "<address>|<path>": the path with every segment that is not a route name, and
 * whatever follows /reset-password/ or /callback/, replaced. */
export function storedKey(key: string): string {
  const bar = key.indexOf("|"); // an address never holds one
  const address = bar < 0 ? "" : key.slice(0, bar);
  const segments = (bar < 0 ? key : key.slice(bar + 1)).split("/");
  const path = segments
    .map((segment, i) => {
      if (i === 0) return segment;
      if (i >= 2 && (segments[1] === "reset-password" || segments[1] === "callback")) return ":param";
      return ROUTE_NAME.test(segment) && segment.length <= 40 ? segment : ":param";
    })
    .join("/");
  return `${address}|${path}`;
}

export function rateLimitStorage(store: IdentityStore) {
  let calls = 0;
  return {
    async consume(key: string, rule: { window: number; max: number }) {
      calls += 1;
      if (calls % PRUNE_EVERY === 0) await store.pruneRateLimits(KEEP_MS);
      return store.consumeRateLimit(storedKey(key), rule.max, rule.window * 1000);
    },
  };
}
