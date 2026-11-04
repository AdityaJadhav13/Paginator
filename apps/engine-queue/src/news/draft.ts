// news.draft (docs/product/13-news-finder.md, flow step 5): each source article fetched where its site's robots.txt
// allows (else its feed summary stands in), its text read; one Claude call drafts the story in the paper's language,
// length and house style; the copy check (copycheck.ts) looks for sentences too close to a source, one rewrite call
// asks for those again, and what is still too close is listed for the editor (`flagged`), never passed silently.
// Photos only when the editor asked for them; finding none never fails the draft.
import type { NewsDrafted, NewsDraftFailed, NewsDraftPayload } from "@pageinator/contracts";
import { AiStop, Budget, retryable, type AiStopCode, type DraftOut } from "./ai.ts";
import { copied, words } from "./copycheck.ts";
import { extractArticle } from "./extract.ts";
import { safeFetch } from "./fetch.ts";
import { limited, type NewsDeps } from "./group.ts";
import { findPhotos, type SourceImage } from "./photos.ts";
import { robotsAllow, type RobotsCache } from "./robots.ts";

export const BYLINE = "Pageinator desk";
const PAGE = {
  maxBytes: 3 * 1024 * 1024,
  timeoutMs: 20_000,
  accept: "text/html, application/xhtml+xml;q=0.9",
  types: ["text/html", "application/xhtml+xml"],
} as const;
const MAX_SOURCE_TEXT = 6_000; // characters of each article Claude reads
/** Fewer words than this across all the sources is not enough to write from. */
const MIN_WORDS = 40;

const MESSAGES: Record<AiStopCode, string> = {
  "ai.off": "Claude is not set up on this worker, so no draft can be written.",
  "ai.cap": "Today's AI spend cap is reached; try again tomorrow or raise the cap.",
  "ai.refused": "Claude declined to write this story.",
  "ai.max_tokens": "Claude's draft was cut short.",
  "ai.error": "The Claude call failed.",
};

/** The draft's event. `final`: the job's last attempt, when a failure the queue would retry is settled instead. */
export async function draft(
  p: NewsDraftPayload,
  deps: NewsDeps,
  final: boolean,
): Promise<NewsDrafted | NewsDraftFailed> {
  const base = { org_id: p.org_id, pub_id: p.pub_id, draft_id: p.draft_id };
  const budget = new Budget(deps.ai, p.ai_budget_inr);
  const fail = (code: string, message: string): NewsDraftFailed => ({
    kind: "news.draft_failed",
    ...base,
    code,
    message,
    usage: budget.usage.slice(0, 10),
  });
  const early = budget.stop;
  if (early) return fail(early, MESSAGES[early]);

  const fetcher = deps.fetcher ?? safeFetch;
  const robots: RobotsCache = new Map();
  const signal = deps.signal ? { signal: deps.signal } : {};
  const read = await limited(p.articles, 4, async (article) => {
    try {
      if (!(await robotsAllow(article.url, robots, fetcher))) return null;
      const page = await fetcher(article.url, { ...PAGE, ...signal });
      return { ...extractArticle(page.body.toString("utf8"), page.url), pageUrl: page.url };
    } catch {
      return null; // the feed's summary stands in
    }
  });
  const sources = p.articles.map((a, i) => ({
    site: a.site,
    title: a.title,
    text: (read[i]?.text || a.summary).slice(0, MAX_SOURCE_TEXT),
  }));
  if (words(sources.map((s) => `${s.title} ${s.text}`).join(" ")).length < MIN_WORDS)
    return fail("news.no_text", "The source articles could not be read, so there is nothing to write from.");
  // the copy check compares with everything Claude was given
  const given = sources.flatMap((s) => [s.title, s.text]);
  const tooClose = (d: { headline: string; body: string }) => copied(`${d.headline}\n${d.body}`, given);

  let story: DraftOut;
  try {
    story = await budget.run((ai) =>
      ai.draft(
        { title: p.title, language: p.language, length: p.length, houseStyle: p.house_style, sources },
        deps.signal,
      ),
    );
  } catch (error) {
    if (error instanceof AiStop) return fail(error.code, MESSAGES[error.code]);
    if (retryable(error) && !final) throw error;
    return fail("ai.error", MESSAGES["ai.error"]);
  }
  let flagged = tooClose(story);
  if (flagged.length > 0) {
    try {
      const again = await budget.run((ai) =>
        ai.rewrite({ draft: story, flagged, language: p.language, houseStyle: p.house_style }, deps.signal),
      );
      story = again;
      flagged = tooClose(again);
    } catch (error) {
      // the first draft stands, its close sentences listed for the editor
      if (!(error instanceof AiStop) && retryable(error) && !final) throw error;
    }
  }

  const images: SourceImage[] = read.flatMap((r, i) =>
    r?.image ? [{ ...r.image, pageUrl: r.pageUrl, site: r.site ?? p.articles[i]?.site ?? "" }] : [],
  );
  const photos = p.find_photo ? await findPhotos(p.title, images, budget, { fetcher, ...signal }) : [];
  return {
    kind: "news.drafted",
    ...base,
    headline: story.headline.trim().slice(0, 2000),
    byline: BYLINE,
    body: story.body.trim().slice(0, 200_000),
    sources: p.articles.map((a) => ({ title: a.title, url: a.url, site: a.site })),
    flagged: flagged.slice(0, 100).map((s) => s.slice(0, 2000)),
    photos,
    usage: budget.usage.slice(0, 10),
  };
}
