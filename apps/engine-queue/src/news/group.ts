// news.collect (docs/product/13-news-finder.md, flow step 2): each of the publication's feeds fetched and read, the
// items already stored or seen twice dropped (by the SHA-256 of their link), then one Claude call groups the new items
// into topics (an open topic by its id, or a new one) unless the AI part is off, the day's budget is spent, or
// nothing is new. The feeds' items are reported whatever Claude does: collection works without the AI part.
import { createHash } from "node:crypto";
import type { NewsCollected, NewsCollectPayload } from "@pageinator/contracts";
import { AiStop, Budget, retryable, type AiClient, type AiStopCode } from "./ai.ts";
import { FetchRefused, safeFetch, type Fetcher } from "./fetch.ts";
import { parseFeed } from "./feeds.ts";

export type NewsDeps = { ai: AiClient | null; fetcher?: Fetcher; signal?: AbortSignal };

const FEED = {
  maxBytes: 5 * 1024 * 1024,
  timeoutMs: 20_000,
  accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.1",
  types: ["application/rss+xml", "application/atom+xml", "application/rdf+xml", "application/xml", "text/xml"],
} as const;
const PER_FEED = 200;
const MAX_ITEMS = 5000;
/** The most characters of item text one run reports: the inbox takes 16 MiB of JSON per event, and the groups repeat
 * the links. */
const MAX_EVENT_TEXT = 8 * 1024 * 1024;
const SUMMARY_FOR_AI = 300; // characters of each summary Claude reads: enough to tell events apart

export const linkHash = (link: string) => createHash("sha256").update(link).digest("hex");

/** Runs `fn` over `list`, at most `n` at a time, keeping the order. */
export async function limited<T, R>(list: readonly T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(list.length);
  let next = 0;
  const lane = async () => {
    for (let i = next++; i < list.length; i = next++) out[i] = await fn(list[i] as T);
  };
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, lane));
  return out;
}

const aiState = (stop: AiStopCode | null): NewsCollected["ai"] =>
  stop === null ? "on" : stop === "ai.off" ? "off" : stop === "ai.cap" ? "cap" : "failed";

/** The run's event. `final`: the job's last attempt, when a failure the queue would retry is settled instead. */
export async function collect(p: NewsCollectPayload, deps: NewsDeps, final: boolean): Promise<NewsCollected> {
  const fetcher = deps.fetcher ?? safeFetch;
  const seen = new Set(p.known);
  const items: NewsCollected["items"] = [];
  const languages: ("mr" | "en")[] = [];
  const read = await limited(p.sources, 4, async (source) => {
    try {
      const { body, url } = await fetcher(source.url, { ...FEED, ...(deps.signal ? { signal: deps.signal } : {}) });
      // shortcut: read as UTF-8 (every feed checked is); a feed in another encoding needs its declared charset
      const xml = body.toString("utf8");
      const found = parseFeed(xml, url);
      if (found.length === 0 && !/<(?:rss|feed|rdf:RDF)\b/.test(xml.slice(0, 2000)))
        return { source, found, error: "feed.not_a_feed" };
      return { source, found, error: null };
    } catch (error) {
      // the code only (NEWS_FETCH_ERRORS): the web words it in the reader's language
      if (error instanceof FetchRefused) return { source, found: [], error: error.code };
      throw error;
    }
  });
  let bytes = 0;
  for (const { source, found } of read)
    for (const item of found.slice(0, PER_FEED)) {
      const hash = linkHash(item.link);
      if (seen.has(hash) || items.length >= MAX_ITEMS || bytes > MAX_EVENT_TEXT) continue;
      seen.add(hash);
      bytes += item.title.length + item.summary.length + 2 * item.link.length;
      items.push({
        source_id: source.id,
        title: item.title,
        summary: item.summary,
        link: item.link,
        published_at: item.published,
        hash,
      });
      languages.push(source.language);
    }
  const budget = new Budget(deps.ai, p.ai_budget_inr);
  let groups: NewsCollected["groups"] = [];
  let ai = aiState(budget.stop);
  if (items.length > 0 && ai === "on") {
    try {
      const out = await budget.run((client) =>
        client.group(
          {
            items: items.map((it, n) => ({
              title: it.title,
              summary: it.summary.slice(0, SUMMARY_FOR_AI),
              language: languages[n] ?? "en",
            })),
            topics: p.topics,
          },
          deps.signal,
        ),
      );
      const open = new Set(p.topics.map((t) => t.id));
      const placed = new Set<number>();
      groups = out.groups
        .map((g) => ({
          topic_id: g.topic_id !== null && open.has(g.topic_id) ? g.topic_id : null,
          title_mr: g.title_mr.trim().slice(0, 500),
          title_en: g.title_en.trim().slice(0, 500),
          importance: g.importance,
          // each item in one group only (the first that names it), and only items of this run
          links: g.items
            .filter((n) => n < items.length && !placed.has(n) && placed.add(n))
            .slice(0, 200)
            .map((n) => items[n]?.link ?? ""),
        }))
        .filter((g) => g.links.length > 0 && (g.title_mr || g.title_en))
        .map((g) => ({ ...g, title_mr: g.title_mr || g.title_en, title_en: g.title_en || g.title_mr }))
        .slice(0, 1000);
    } catch (error) {
      if (error instanceof AiStop) ai = aiState(error.code);
      else if (retryable(error) && !final) throw error;
      else ai = "failed";
    }
  }
  return {
    kind: "news.collected",
    org_id: p.org_id,
    pub_id: p.pub_id,
    run_id: p.run_id,
    sources: read.map(({ source, error }) => ({ id: source.id, ok: error === null, error })),
    items,
    groups,
    ai,
    usage: budget.usage.slice(0, 10),
  };
}
