// robots.txt for article fetches (feeds are offered to readers by their sites, so they are not checked): the groups
// naming our product token (pageinator-newsfinder), else the groups for "*"; within them the longest matching Allow
// or Disallow wins, a tie to Allow. A robots.txt that is missing or forbidden (4xx) allows everything; one that
// cannot be read (5xx, a timeout, the network) allows nothing, as the robots.txt standard (RFC 9309) asks.
import { FetchRefused, safeFetch, type Fetcher } from "./fetch.ts";

const TOKEN = "pageinator-newsfinder";

type Rule = { allow: boolean; path: string };

/** Each site's rules (by origin), fetched once per job. */
export type RobotsCache = Map<string, Promise<Rule[] | "none">>;

export async function robotsAllow(url: string, cache: RobotsCache, fetcher: Fetcher = safeFetch): Promise<boolean> {
  const u = new URL(url);
  let rules = cache.get(u.origin);
  if (!rules) {
    rules = load(u.origin, fetcher);
    cache.set(u.origin, rules);
  }
  const found = await rules;
  return found !== "none" && allowedBy(found, u.pathname + u.search);
}

async function load(origin: string, fetcher: Fetcher): Promise<Rule[] | "none"> {
  try {
    const { body } = await fetcher(`${origin}/robots.txt`, { maxBytes: 512 * 1024, timeoutMs: 10_000 });
    return rulesFor(body.toString("utf8"));
  } catch (error) {
    if (error instanceof FetchRefused && error.status !== null && error.status >= 400 && error.status < 500) return [];
    return "none";
  }
}

/** The rules of the groups that name us, else of the groups for "*". */
export function rulesFor(text: string): Rule[] {
  type Group = { agents: string[]; rules: Rule[]; sealed: boolean };
  const groups: Group[] = [];
  let group: Group | null = null;
  for (const raw of text.split(/\r?\n|\r/)) {
    const line = raw.replace(/#.*$/, "");
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === "user-agent") {
      if (!group || group.sealed) groups.push((group = { agents: [], rules: [], sealed: false }));
      group.agents.push(value.toLowerCase());
    } else if ((field === "allow" || field === "disallow") && group) {
      group.sealed = true;
      if (value) group.rules.push({ allow: field === "allow", path: value }); // "Disallow:" alone: no rule
    }
  }
  const ours = groups.filter((g) => g.agents.some((a) => a === TOKEN || a.startsWith(`${TOKEN}/`)));
  return (ours.length > 0 ? ours : groups.filter((g) => g.agents.includes("*"))).flatMap((g) => g.rules);
}

export function allowedBy(rules: readonly Rule[], path: string): boolean {
  let best: Rule | null = null;
  for (const rule of rules) {
    if (!matches(rule.path, path)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow))
      best = rule;
  }
  return best?.allow ?? true;
}

/** A robots.txt path pattern: a prefix, with * for any run of characters and $ for the end. */
function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = decodeSafe(anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`).test(decodeSafe(path));
}

function decodeSafe(path: string): string {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}
