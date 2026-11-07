// The news finder's jobs on recorded fictional feeds and pages, with a fake Claude and a fake fetch (no network):
// news.collect (grouping, AI off / cap / refused / cut short), news.draft (the copy check's rewrite and what stays
// flagged), photos (filter, labels, ranking), and the Graphile tasks reporting contract-valid events.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EngineEvent,
  NewsCollected,
  NewsDrafted,
  NewsDraftFailed,
  type NewsCollectPayload,
  type NewsDraftPayload,
} from "@pageinator/contracts";
import Anthropic from "@anthropic-ai/sdk";
import type { JobHelpers } from "graphile-worker";
import { AiStop } from "../src/news/ai.ts";
import { draft } from "../src/news/draft.ts";
import { FetchRefused, type Fetcher } from "../src/news/fetch.ts";
import { collect, linkHash } from "../src/news/group.ts";
import { commons, findPhotos, openverse, printable } from "../src/news/photos.ts";
import { Budget } from "../src/news/ai.ts";
import { newsTask, RetryLater, targetOf, type Report } from "../src/tasks.ts";
import { FakeAiClient } from "./news/fake-ai.ts";

const fixture = (name: string) => readFileSync(new URL(`fixtures/news/${name}`, import.meta.url), "utf8");
const ORG = "01890a5d-ac96-7000-8000-000000000001";
const PUB = "01890a5d-ac96-7000-8000-000000000002";
const RUN = "01890a5d-ac96-7000-8000-000000000003";
const DRAFT = "01890a5d-ac96-7000-8000-000000000004";
const SRC_MR = "01890a5d-ac96-7000-8000-000000000005";
const SRC_EN = "01890a5d-ac96-7000-8000-000000000006";
const SRC_BAD = "01890a5d-ac96-7000-8000-000000000007";
const TOPIC = "01890a5d-ac96-7000-8000-000000000008";

/** A fetch that answers from a table (a string body, a JSON value, or a refusal), and records what was asked. */
function fetcher(table: Record<string, string | object | FetchRefused>) {
  const asked: string[] = [];
  const f: Fetcher = async (url) => {
    asked.push(url);
    const key = Object.keys(table).find((k) => url.startsWith(k));
    const found = key === undefined ? new FetchRefused("fetch.status", "404", 404) : table[key];
    if (found instanceof FetchRefused) throw found;
    const body = typeof found === "string" ? found : JSON.stringify(found);
    return { url, status: 200, contentType: "text/plain", body: Buffer.from(body) };
  };
  return { f, asked };
}

const FEEDS = {
  "https://kalpanik.example/rss": fixture("feed-mr.rss.xml"),
  "https://gazette.example/feed.atom": fixture("feed-en.atom.xml"),
  "https://broken.example/": "<html><body>not a feed</body></html>",
};
const collectPayload: NewsCollectPayload = {
  org_id: ORG,
  pub_id: PUB,
  run_id: RUN,
  sources: [
    { id: SRC_MR, url: "https://kalpanik.example/rss", language: "mr" },
    { id: SRC_EN, url: "https://gazette.example/feed.atom", language: "en" },
    { id: SRC_BAD, url: "https://broken.example/", language: "en" },
  ],
  known: [],
  topics: [{ id: TOPIC, title: "Navgaon onion prices" }],
  ai_budget_inr: 100,
};
const grouping = {
  groups: [
    { topic_id: null, title_mr: "सुंदरपूर धरण", title_en: "Sundarpur dam", importance: 4, items: [0, 2] },
    // an open topic; item 2 again (already placed) and an item that does not exist are dropped
    { topic_id: TOPIC, title_mr: "कांदा दर", title_en: "Onion prices", importance: 2, items: [1, 3, 2, 99] },
    // a topic id that is not open becomes a new topic
    { topic_id: "01890a5d-ac96-7000-8000-0000000000ff", title_mr: "", title_en: "Nothing", importance: 1, items: [] },
  ],
};

describe("news.collect", () => {
  it("reads every feed, drops repeats and known links, and groups the new items by link", async () => {
    const ai = new FakeAiClient({ group: grouping });
    const { f } = fetcher(FEEDS);
    const known = linkHash("https://gazette.example/news/navgaon-onions");
    const event = NewsCollected.parse(await collect({ ...collectPayload, known: [known] }, { ai, fetcher: f }, false));
    expect(event.items.map((i) => [i.source_id, i.link])).toEqual([
      [SRC_MR, "https://kalpanik.example/batmya/dharan-darwaje"],
      [SRC_MR, "https://kalpanik.example/batmya/kanda-bhav"],
      [SRC_EN, "https://gazette.example/news/sundarpur-dam"],
    ]);
    expect(event.items[0]?.hash).toBe(linkHash("https://kalpanik.example/batmya/dharan-darwaje"));
    expect(event.sources).toEqual([
      { id: SRC_MR, ok: true, error: null },
      { id: SRC_EN, ok: true, error: null },
      { id: SRC_BAD, ok: false, error: "feed.not_a_feed" },
    ]);
    expect(event.groups).toEqual([
      {
        topic_id: null,
        title_mr: "सुंदरपूर धरण",
        title_en: "Sundarpur dam",
        importance: 4,
        links: ["https://kalpanik.example/batmya/dharan-darwaje", "https://gazette.example/news/sundarpur-dam"],
      },
      {
        topic_id: TOPIC,
        title_mr: "कांदा दर",
        title_en: "Onion prices",
        importance: 2,
        links: ["https://kalpanik.example/batmya/kanda-bhav"],
      },
    ]);
    expect([event.ai, event.usage.map((u) => u.purpose)]).toEqual(["on", ["group"]]);
    // Claude reads numbered items with their language, and the open topics
    const asked = ai.asked[0]?.input as { items: { language: string }[]; topics: unknown[] };
    expect(asked.items.map((i) => i.language)).toEqual(["mr", "mr", "en"]);
    expect(asked.topics).toEqual(collectPayload.topics);
  });

  it("still reports the items with the AI part off, out of budget, refused or cut short", async () => {
    const { f } = fetcher(FEEDS);
    const run = async (ai: FakeAiClient | null, budget = 100) =>
      NewsCollected.parse(await collect({ ...collectPayload, ai_budget_inr: budget }, { ai, fetcher: f }, false));
    const off = await run(null);
    expect([off.ai, off.items.length, off.groups, off.usage]).toEqual(["off", 4, [], []]);
    const cap = await run(new FakeAiClient({ group: grouping }), 0);
    expect([cap.ai, cap.items.length, cap.groups]).toEqual(["cap", 4, []]);
    for (const code of ["ai.refused", "ai.max_tokens", "ai.error"] as const) {
      const failed = await run(new FakeAiClient({ group: new AiStop(code, "x") }));
      expect([failed.ai, failed.items.length, failed.groups], code).toEqual(["failed", 4, []]);
    }
  });

  it("reports a feed that cannot be fetched by the guard's code, never its words", async () => {
    const { f } = fetcher(FEEDS);
    const gone = { id: SRC_BAD, url: "https://missing.example/rss", language: "en" as const };
    const event = await collect({ ...collectPayload, sources: [gone] }, { ai: null, fetcher: f }, false);
    expect(event.sources).toEqual([{ id: SRC_BAD, ok: false, error: "fetch.status" }]);
  });

  it("asks Claude nothing when nothing is new", async () => {
    const ai = new FakeAiClient({ group: grouping });
    const { f } = fetcher(FEEDS);
    const all = [
      "https://kalpanik.example/batmya/dharan-darwaje",
      "https://kalpanik.example/batmya/kanda-bhav",
      "https://gazette.example/news/sundarpur-dam",
      "https://gazette.example/news/navgaon-onions",
    ].map(linkHash);
    const event = await collect({ ...collectPayload, known: all }, { ai, fetcher: f }, false);
    expect([event.items, event.groups, event.ai, ai.asked]).toEqual([[], [], "on", []]);
  });

  it("throws a rate limit so the queue retries, and settles it on the last attempt", async () => {
    const limited = new Anthropic.RateLimitError(429, { type: "error" }, "rate limited", new Headers());
    const { f } = fetcher(FEEDS);
    const ai = new FakeAiClient({ group: limited });
    await expect(collect(collectPayload, { ai, fetcher: f }, false)).rejects.toBe(limited);
    const last = await collect(collectPayload, { ai, fetcher: f }, true);
    expect([last.ai, last.items.length]).toEqual(["failed", 4]);
  });
});

const SOURCE_TEXT = fixture("article.html");
const draftPayload: NewsDraftPayload = {
  org_id: ORG,
  pub_id: PUB,
  draft_id: DRAFT,
  language: "en",
  length: "short",
  find_photo: false,
  title: "Sundarpur dam gates opened",
  articles: [
    {
      url: "https://gazette.example/news/sundarpur-dam",
      title: "Sundarpur dam gates opened after heavy rain",
      summary: "Five thousand cusecs released.",
      site: "The Fictional Gazette",
    },
    {
      url: "https://closed.example/news/dam",
      title: "Dam opened",
      summary: "The Sundarpur dam's gates opened on Tuesday as the rain went on in the hills above the reservoir.",
      site: "Closed Daily",
    },
  ],
  house_style: "Short sentences.",
  ai_budget_inr: 100,
};
const PAGES = {
  "https://gazette.example/robots.txt": "User-agent: *\nDisallow: /private/",
  "https://gazette.example/news/": SOURCE_TEXT,
  "https://closed.example/robots.txt": "User-agent: *\nDisallow: /news/",
  "https://closed.example/news/":
    "<article><p>Robots.txt forbids this page, so it must never be fetched at all.</p></article>",
};
const OWN = {
  headline: "Sundarpur dam opens its gates",
  body: "Water was let out of the Sundarpur reservoir on Tuesday.\n\nPeople living downstream were asked to be careful.",
};
const COPIED =
  "The gates of the Sundarpur dam were opened on Tuesday morning after two days of heavy rain in the catchment.";

describe("news.draft", () => {
  it("reads the articles robots.txt allows (the feed's summary for the others) and drafts in the paper's style", async () => {
    const ai = new FakeAiClient({ draft: OWN });
    const { f, asked } = fetcher(PAGES);
    const event = NewsDrafted.parse(await draft(draftPayload, { ai, fetcher: f }, false));
    expect(asked).not.toContain("https://closed.example/news/dam");
    const input = ai.asked[0]?.input as { sources: { text: string }[]; houseStyle: string; language: string };
    expect(input.sources.map((s) => s.text.slice(0, 40))).toEqual([
      "The gates of the Sundarpur dam were open",
      "The Sundarpur dam's gates opened on Tues",
    ]);
    expect([input.houseStyle, input.language]).toEqual(["Short sentences.", "en"]);
    expect(event).toMatchObject({ headline: OWN.headline, byline: "Pageinator desk", body: OWN.body, flagged: [] });
    expect(event.sources).toEqual(draftPayload.articles.map(({ title, url, site }) => ({ title, url, site })));
    expect(event.photos).toEqual([]);
  });

  it("asks once for a rewrite of the sentences too close to a source, and lists what is still too close", async () => {
    const close = { headline: OWN.headline, body: `${COPIED}\n\nPeople downstream were warned.` };
    const fixed = new FakeAiClient({ draft: close, rewrite: OWN });
    const { f } = fetcher(PAGES);
    const good = NewsDrafted.parse(await draft(draftPayload, { ai: fixed, fetcher: f }, false));
    expect([good.body, good.flagged]).toEqual([OWN.body, []]);
    expect(fixed.asked.map((a) => a.method)).toEqual(["draft", "rewrite"]);
    expect((fixed.asked[1]?.input as { flagged: string[] }).flagged).toEqual([COPIED]);
    expect(good.usage.map((u) => u.purpose)).toEqual(["draft", "rewrite"]);

    const stubborn = new FakeAiClient({ draft: close, rewrite: close });
    const still = NewsDrafted.parse(await draft(draftPayload, { ai: stubborn, fetcher: f }, false));
    expect(still.flagged).toEqual([COPIED]);
    // a refused rewrite keeps the first draft, its close sentences listed
    const refused = new FakeAiClient({ draft: close, rewrite: new AiStop("ai.refused", "x") });
    expect(NewsDrafted.parse(await draft(draftPayload, { ai: refused, fetcher: f }, false)).flagged).toEqual([COPIED]);
  });

  it("fails with the AI part's code: off, cap, refused, cut short", async () => {
    const { f, asked } = fetcher(PAGES);
    const off = NewsDraftFailed.parse(await draft(draftPayload, { ai: null, fetcher: f }, false));
    expect(off.code).toBe("ai.off");
    expect(asked).toEqual([]); // nothing fetched for a draft that cannot be written
    const cap = await draft({ ...draftPayload, ai_budget_inr: 0 }, { ai: new FakeAiClient({}), fetcher: f }, false);
    expect(NewsDraftFailed.parse(cap).code).toBe("ai.cap");
    for (const code of ["ai.refused", "ai.max_tokens", "ai.error"] as const) {
      const ai = new FakeAiClient({ draft: new AiStop(code, "x") });
      expect(NewsDraftFailed.parse(await draft(draftPayload, { ai, fetcher: f }, false)).code, code).toBe(code);
    }
  });

  it("fails with news.no_text when there is nothing to write from", async () => {
    const { f } = fetcher({});
    const bare = {
      ...draftPayload,
      articles: [{ url: "https://gone.example/a", title: "Dam", summary: "", site: "Gone" }],
    };
    const event = NewsDraftFailed.parse(await draft(bare, { ai: new FakeAiClient({ draft: OWN }), fetcher: f }, false));
    expect(event.code).toBe("news.no_text");
  });
});

const commonsAnswer = {
  query: {
    pages: {
      "1": {
        title: "File:Sundarpur dam gates.jpg",
        imageinfo: [
          {
            url: "https://upload.example/dam.jpg",
            thumburl: "https://upload.example/thumb/dam.jpg",
            descriptionurl: "https://commons.example/wiki/File:Sundarpur_dam_gates.jpg",
            width: 4000,
            height: 3000,
            mime: "image/jpeg",
            extmetadata: {
              Artist: { value: '<a href="https://commons.example/wiki/User:Asha">आशा पाटील</a>' },
              LicenseShortName: { value: "CC BY-SA 4.0" },
              LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0" },
            },
          },
        ],
      },
      "2": {
        title: "File:Small dam.jpg",
        imageinfo: [
          {
            url: "https://upload.example/small.jpg",
            descriptionurl: "https://commons.example/wiki/File:Small_dam.jpg",
            width: 800,
            height: 600,
            mime: "image/jpeg",
          },
        ],
      },
      "3": {
        title: "File:Dam authority logo.png",
        imageinfo: [
          {
            url: "https://upload.example/logo.png",
            descriptionurl: "https://commons.example/wiki/File:Logo.png",
            width: 3000,
            height: 3000,
            mime: "image/png",
          },
        ],
      },
      "4": {
        title: "File:Dam diagram.svg",
        imageinfo: [
          {
            url: "https://upload.example/diagram.svg",
            descriptionurl: "https://commons.example/wiki/File:Diagram.svg",
            width: 5000,
            height: 4000,
            mime: "image/svg+xml",
          },
        ],
      },
    },
  },
};
const openverseAnswer = {
  results: [
    {
      url: "https://images.example/river.jpg",
      thumbnail: "https://api.openverse.example/thumb/river",
      foreign_landing_url: "https://flickr.example/photos/river",
      width: 2400,
      height: 1600,
      title: "River below the dam",
      creator: "Ravi Kulkarni",
      source: "flickr",
      license: "by",
      license_version: "2.0",
      license_url: "https://creativecommons.org/licenses/by/2.0/",
      filetype: "jpg",
    },
    {
      url: "https://images.example/unknown-size.jpg",
      foreign_landing_url: "https://flickr.example/photos/x",
      width: null,
      height: null,
      license: "cc0",
    },
  ],
};
const PHOTO_SITES = {
  "https://commons.wikimedia.org/w/api.php": commonsAnswer,
  "https://api.openverse.org/v1/images/": openverseAnswer,
};
const sourceImage = {
  url: "https://gazette.example/media/dam-wide.jpg",
  widthPx: 3000,
  heightPx: 2000,
  pageUrl: "https://gazette.example/news/sundarpur-dam",
  site: "The Fictional Gazette",
};

describe("photos", () => {
  it("reads Commons and Openverse answers into candidates with their licences and credits", async () => {
    const { f, asked } = fetcher(PHOTO_SITES);
    const fromCommons = await commons("Sundarpur dam", f);
    expect(fromCommons[0]).toMatchObject({
      url: "https://upload.example/dam.jpg",
      thumbUrl: "https://upload.example/thumb/dam.jpg",
      creator: "आशा पाटील",
      licence: "CC BY-SA 4.0",
      origin: "commons",
    });
    const search = new URL(asked[0] ?? "");
    expect([search.searchParams.get("generator"), search.searchParams.get("gsrnamespace")]).toEqual(["search", "6"]);
    expect(search.searchParams.get("iiurlwidth")).toBe("640");
    const fromOpenverse = await openverse("Sundarpur dam", f);
    expect(fromOpenverse.map((c) => [c.licence, c.creator])).toEqual([["CC BY 2.0", "Ravi Kulkarni"]]);
    expect(new URL(asked[1] ?? "").searchParams.get("license_type")).toBe("commercial,modification");
    expect(fromCommons.filter(printable).map((c) => c.url)).toEqual(["https://upload.example/dam.jpg"]);
  });

  it("filters, labels, credits and ranks with one vision call: safe photos first, at most 8 shown to Claude", async () => {
    const ai = new FakeAiClient({ rankPhotos: { order: [2, 0, 2, 7] } });
    const { f } = fetcher(PHOTO_SITES);
    const photos = await findPhotos("Sundarpur dam", [sourceImage], new Budget(ai, 100), { fetcher: f });
    expect(photos.map((p) => [p.url, p.label, p.credit])).toEqual([
      [sourceImage.url, "needs_permission", "Photo: The Fictional Gazette"],
      ["https://upload.example/dam.jpg", "safe", "Photo: आशा पाटील / Wikimedia Commons, CC BY-SA 4.0"],
      // Claude chose two; the next in order fills up to three
      ["https://images.example/river.jpg", "safe", "Photo: Ravi Kulkarni / flickr, CC BY 2.0"],
    ]);
    const shown = ai.asked[0]?.input as { photos: { thumbUrl: string }[] };
    expect(shown.photos.map((p) => p.thumbUrl)).toEqual([
      "https://upload.example/thumb/dam.jpg",
      "https://api.openverse.example/thumb/river",
      sourceImage.url,
    ]);
  });

  it("never fails: a search that fails, or a ranking that cannot run, leaves the photos unranked or none", async () => {
    const down = fetcher({ "https://commons.wikimedia.org/": new FetchRefused("fetch.timeout", "slow") });
    expect(await findPhotos("Dam", [], new Budget(new FakeAiClient({}), 100), { fetcher: down.f })).toEqual([]);
    const { f } = fetcher(PHOTO_SITES);
    const unranked = await findPhotos("Dam", [sourceImage], new Budget(null, 100), { fetcher: f });
    expect(unranked.map((p) => p.url)).toEqual([
      "https://upload.example/dam.jpg",
      "https://images.example/river.jpg",
      sourceImage.url,
    ]);
  });

  it("are found only when the editor asked, and go into the draft", async () => {
    const ai = new FakeAiClient({ draft: OWN, rankPhotos: { order: [0, 1, 2] } });
    const { f } = fetcher({ ...PAGES, ...PHOTO_SITES });
    const event = NewsDrafted.parse(await draft({ ...draftPayload, find_photo: true }, { ai, fetcher: f }, false));
    expect(event.photos.map((p) => p.origin)).toEqual(["commons", "openverse", "source"]);
    expect(event.usage.map((u) => u.purpose)).toEqual(["draft", "photos"]);
  });
});

function helpers(attempts = 1, max = 3) {
  const logged: string[] = [];
  const controller = new AbortController();
  const h = {
    job: { id: "9", attempts, max_attempts: max, locked_by: "pool-1", task_identifier: "news" },
    abortSignal: controller.signal,
    logger: { error: (m: string) => logged.push(m), warn: (m: string) => logged.push(m) },
    withPgClient: async (fn: (c: unknown) => unknown) => fn({ query: async () => ({ rowCount: 1 }) }),
  } as unknown as JobHelpers;
  return { h, logged, controller };
}

describe("the news tasks", () => {
  const reporting = () => {
    const reported: EngineEvent[] = [];
    const report: Report = async (e) => {
      reported.push(EngineEvent.parse(e));
    };
    return { reported, report };
  };

  it("report contract-valid events whose target is the run or the draft", async () => {
    const { reported, report } = reporting();
    const { f } = fetcher({ ...FEEDS, ...PAGES });
    const deps = { ai: new FakeAiClient({ group: grouping, draft: OWN }), fetcher: f };
    await newsTask("news.collect", deps, report)(collectPayload, helpers().h);
    await newsTask("news.draft", deps, report)(draftPayload, helpers().h);
    expect(reported.map((e) => [e.kind, targetOf(e)])).toEqual([
      ["news.collected", RUN],
      ["news.drafted", DRAFT],
    ]);
  });

  it("settle a payload that is not the news finder's as job.failed for its run or draft; drop one naming none", async () => {
    const { reported, report } = reporting();
    const deps = { ai: null, fetcher: fetcher({}).f };
    await newsTask("news.collect", deps, report)({ ...collectPayload, sources: [] }, helpers().h);
    await newsTask("news.draft", deps, report)({ ...draftPayload, secret: "x" }, helpers().h);
    expect(reported).toEqual([
      {
        kind: "job.failed",
        org_id: ORG,
        pub_id: PUB,
        job_kind: "news.collect",
        target_id: RUN,
        code: "worker.job",
        message: "the job's payload is not the news finder's payload",
      },
      expect.objectContaining({ kind: "job.failed", job_kind: "news.draft", target_id: DRAFT, code: "worker.job" }),
    ]);
    const { h, logged } = helpers();
    await newsTask("news.draft", deps, report)({ org_id: ORG }, h);
    expect([reported.length, logged.length]).toEqual([2, 1]);
  });

  it("settle an event its contract refuses as job.failed (worker.output)", async () => {
    const { reported, report } = reporting();
    // an answer the real client's schema would refuse: importance 9
    const odd = { groups: [{ ...grouping.groups[0], importance: 9 }] } as unknown as typeof grouping;
    const deps = { ai: new FakeAiClient({ group: odd }), fetcher: fetcher(FEEDS).f };
    await newsTask("news.collect", deps, report)(collectPayload, helpers().h);
    expect(reported.map((e) => e.kind === "job.failed" && [e.code, e.target_id])).toEqual([["worker.output", RUN]]);
  });

  it("give a cancelled job back without reporting what it found while stopping", async () => {
    const { reported, report } = reporting();
    const { f } = fetcher(FEEDS);
    const { h, controller } = helpers();
    controller.abort();
    const thrown = await Promise.resolve(
      newsTask("news.collect", { ai: null, fetcher: f }, report)(collectPayload, h),
    ).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(RetryLater);
    expect(reported).toEqual([]);
  });
});
