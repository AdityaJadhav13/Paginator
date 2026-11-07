// The news finder's deterministic parts: robots.txt, feed reading and article text on recorded fictional pages, the
// copy check and the photo licence labels (Marathi and English).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { copied, sentences, words } from "../src/news/copycheck.ts";
import { extractArticle } from "../src/news/extract.ts";
import { parseFeed } from "../src/news/feeds.ts";
import { FetchRefused, type Fetcher } from "../src/news/fetch.ts";
import { creditLine, licenceLabel } from "../src/news/licence.ts";
import { allowedBy, robotsAllow, rulesFor, type RobotsCache } from "../src/news/robots.ts";

const fixture = (name: string) => readFileSync(new URL(`fixtures/news/${name}`, import.meta.url), "utf8");

describe("robots.txt", () => {
  const text = `
User-agent: *
Disallow: /private/
Allow: /private/press/
Disallow: /*.pdf$

User-agent: SomeOtherBot
Disallow: /
`;
  it("uses the * group when none names us; the longest match wins, a tie to Allow", () => {
    const rules = rulesFor(text);
    expect(allowedBy(rules, "/news/story")).toBe(true);
    expect(allowedBy(rules, "/private/notes")).toBe(false);
    expect(allowedBy(rules, "/private/press/release")).toBe(true);
    expect(allowedBy(rules, "/files/report.pdf")).toBe(false);
    expect(allowedBy(rules, "/files/report.pdf?x=1")).toBe(true);
    expect(
      allowedBy(
        [
          { allow: false, path: "/a" },
          { allow: true, path: "/a" },
        ],
        "/a",
      ),
    ).toBe(true);
  });

  it("uses only our group when one names us (an empty Disallow allows everything)", () => {
    const ours = `User-agent: *\nDisallow: /\n\nUser-agent: Pageinator-NewsFinder\nDisallow:\n`;
    expect(allowedBy(rulesFor(ours), "/news")).toBe(true);
    const shut = `User-agent: pageinator-newsfinder\nUser-agent: other\nDisallow: /news/\n`;
    expect(allowedBy(rulesFor(shut), "/news/x")).toBe(false);
    expect(allowedBy(rulesFor(shut), "/sport/x")).toBe(true);
  });

  it("allows everything when robots.txt is missing (4xx), nothing when it cannot be read (5xx, a timeout)", async () => {
    const answering =
      (error: FetchRefused | null, body = ""): Fetcher =>
      async () => {
        if (error) throw error;
        return { url: "", status: 200, contentType: "text/plain", body: Buffer.from(body) };
      };
    const ask = (f: Fetcher, url = "https://site.example/news/a") => robotsAllow(url, new Map(), f);
    expect(await ask(answering(new FetchRefused("fetch.status", "404", 404)))).toBe(true);
    expect(await ask(answering(new FetchRefused("fetch.status", "403", 403)))).toBe(true);
    expect(await ask(answering(new FetchRefused("fetch.status", "503", 503)))).toBe(false);
    expect(await ask(answering(new FetchRefused("fetch.timeout", "slow")))).toBe(false);
    expect(await ask(answering(null, "User-agent: *\nDisallow: /news/"))).toBe(false);
    // fetched once per site and job
    let fetched = 0;
    const counting: Fetcher = async () => {
      fetched++;
      return { url: "", status: 200, contentType: "text/plain", body: Buffer.from("") };
    };
    const cache: RobotsCache = new Map();
    await robotsAllow("https://site.example/a", cache, counting);
    await robotsAllow("https://site.example/b", cache, counting);
    expect(fetched).toBe(1);
  });
});

describe("feeds", () => {
  it("reads an RSS 2.0 feed in Marathi: plain-text summaries, absolute links, times; no link, no item", () => {
    const items = parseFeed(fixture("feed-mr.rss.xml"), "https://kalpanik.example/rss");
    expect(items).toEqual([
      {
        title: "सुंदरपूर धरणाचे दरवाजे उघडले",
        summary: "सुंदरपूर धरणातून पाच हजार क्युसेक पाणी सोडण्यात आले.",
        link: "https://kalpanik.example/batmya/dharan-darwaje",
        published: "2026-11-03T01:00:00.000Z",
      },
      {
        title: "नवगाव बाजार समितीत कांद्याचे भाव वाढले",
        summary: "कांद्याला विक्रमी दर & मागणी वाढली.",
        link: "https://kalpanik.example/batmya/kanda-bhav",
        published: "2026-11-03T02:30:00.000Z",
      },
      // the repeat is the feed's: the collection drops it by its link's hash
      {
        title: "सुंदरपूर धरणाचे दरवाजे उघडले",
        summary: "तीच बातमी पुन्हा.",
        link: "https://kalpanik.example/batmya/dharan-darwaje",
        published: null,
      },
    ]);
  });

  it("reads an Atom feed: the alternate link, published before updated, HTML summaries as text", () => {
    expect(parseFeed(fixture("feed-en.atom.xml"), "https://gazette.example/feed.atom")).toEqual([
      {
        title: "Sundarpur dam gates opened after heavy rain",
        summary: "Five thousand cusecs released from the Sundarpur dam.",
        link: "https://gazette.example/news/sundarpur-dam",
        published: "2026-11-03T01:15:00.000Z",
      },
      {
        title: "Navgaon market sees record onion prices",
        summary: "Onion prices hit a record as demand rises.",
        link: "https://gazette.example/news/navgaon-onions",
        published: "2026-11-03T03:00:00.000Z",
      },
    ]);
  });

  it("reads nothing from a page that is not a feed, and drops a javascript: link", () => {
    expect(parseFeed("<html><body><p>hello</p></body></html>", "https://x.example/")).toEqual([]);
    const bad = `<rss><channel><item><title>t</title><link>javascript:alert(1)</link></item></channel></rss>`;
    expect(parseFeed(bad, "https://x.example/")).toEqual([]);
  });

  it("gives no date rather than one the contract refuses (one bad item must not refuse the whole run)", () => {
    const year10000 = `<rss><channel><item><title>t</title><link>https://x.example/a</link>
      <pubDate>Fri, 01 Jan 10000 00:00:00 GMT</pubDate></item></channel></rss>`;
    expect(parseFeed(year10000, "https://x.example/")[0]?.published).toBeNull();
  });
});

describe("article text", () => {
  it("keeps the article's paragraphs, not menus, captions, asides or scripts; reads og:image and its size", () => {
    const got = extractArticle(fixture("article.html"), "https://gazette.example/news/sundarpur-dam");
    expect(got.text).toBe(
      "The gates of the Sundarpur dam were opened on Tuesday morning after two days of heavy rain in the catchment.\n\n" +
        "Officials said five thousand cusecs of water were released and villages downstream were told to stay alert.",
    );
    expect(got.image).toEqual({ url: "https://gazette.example/media/dam-wide.jpg", widthPx: 3000, heightPx: 2000 });
    expect(got.site).toBe("The Fictional Gazette");
  });
});

describe("the copy check", () => {
  const source =
    "The gates of the Sundarpur dam were opened on Tuesday morning after two days of heavy rain in the catchment area.";
  it("splits words on Unicode letters and marks (Devanagari vowel signs kept), NFC and lower case", () => {
    expect(words("धरणाचे दरवाजे, उघडले!")).toEqual(["धरणाचे", "दरवाजे", "उघडले"]);
    expect(words("Café CAFÉ 42")).toEqual(["café", "café", "42"]);
    expect(sentences("पहिले वाक्य। दुसरे वाक्य॥ Third one? Fourth!\nFifth")).toEqual([
      "पहिले वाक्य।",
      "दुसरे वाक्य॥",
      "Third one?",
      "Fourth!",
      "Fifth",
    ]);
  });

  it("flags 8 consecutive words shared with a source (English)", () => {
    const draft =
      "Officials acted quickly. On Tuesday the gates of the Sundarpur dam were opened on Tuesday morning, they said.";
    expect(copied(draft, [source])).toEqual([
      "On Tuesday the gates of the Sundarpur dam were opened on Tuesday morning, they said.",
    ]);
    expect(copied("Heavy rain over two days led officials to open the Sundarpur dam on Tuesday.", [source])).toEqual(
      [],
    );
  });

  it("flags 8 consecutive words shared with a source (Marathi), whatever the punctuation", () => {
    const mr = "सुंदरपूर धरणाचे दरवाजे मंगळवारी सकाळी पाणलोट क्षेत्रात दोन दिवसांच्या मुसळधार पावसानंतर उघडण्यात आले.";
    const close =
      "प्रशासनाने सांगितले की सुंदरपूर धरणाचे दरवाजे, मंगळवारी सकाळी पाणलोट क्षेत्रात दोन दिवसांच्या पावसानंतर उघडले।";
    expect(copied(close, [mr])).toEqual([close]);
    expect(copied("दोन दिवस पाऊस पडल्याने धरणातून पाणी सोडले।", [mr])).toEqual([]);
  });

  it("flags a sentence with 60 % or more of its 5-word runs in one source, short of 8 in a row", () => {
    // 9 words, 5 runs of five; seven words in a row are in the source, so 3 of the runs: 60 %
    const draft = "the gates of the sundarpur dam were shut today.";
    expect(copied(draft, [source])).toEqual([draft]);
    // spread over two sources, neither reaching 60 %, it passes
    expect(
      copied("one two three four five six seven", ["one two three four five x", "y three four five six seven"]),
    ).toEqual([]);
    expect(copied("one two three four five six seven", ["one two three four five six x"])).toEqual([
      "one two three four five six seven",
    ]);
  });

  it("never flags a sentence shorter than five words", () => {
    expect(copied("The gates opened.", [source])).toEqual([]);
  });
});

describe("photo licences", () => {
  it("labels Commons and Openverse CC0, CC BY, CC BY-SA (any version or port) and public domain as safe", () => {
    for (const licence of [
      "CC0",
      "CC0 1.0",
      "cc0 1.0 universal",
      "CC BY 4.0",
      "CC-BY-2.0",
      "CC BY-SA 3.0",
      "CC BY-SA 3.0 IGO",
      "CC BY 2.5 in",
      "cc_by_sa_4.0",
      "Creative Commons Attribution-Share Alike 4.0",
      "Public domain",
      "Public Domain Mark 1.0",
      "PDM",
      "PD-US",
      "PD-India",
      "pd-old-70",
      "by-sa 4.0",
    ]) {
      expect(licenceLabel("commons", licence), licence).toBe("safe");
      expect(licenceLabel("openverse", licence), licence).toBe("safe");
    }
  });

  it("labels NC, ND, unknown and odd licences, and every source picture, as needing permission", () => {
    for (const licence of [
      "CC BY-NC 4.0",
      "CC BY-NC-SA 2.0",
      "CC BY-ND 4.0",
      "cc by nc",
      "Creative Commons Attribution-NonCommercial 4.0",
      "GFDL",
      "Attribution",
      "All rights reserved",
      "unknown",
      "",
      "CC BY 4.0 or ask the author",
      "pd but no permission",
      "by",
    ])
      expect(licenceLabel("commons", licence), licence).toBe("needs_permission");
    expect(licenceLabel("source", "CC0")).toBe("needs_permission");
    expect(licenceLabel("pib", "unknown")).toBe("safe");
  });

  it("writes the credit line, naming the licence when known and the creator when there is one", () => {
    expect(creditLine("Asha Patil", "Wikimedia Commons", "CC BY-SA 4.0")).toBe(
      "Photo: Asha Patil / Wikimedia Commons, CC BY-SA 4.0",
    );
    expect(creditLine("आशा पाटील", "Wikimedia Commons", "CC BY 4.0")).toBe(
      "Photo: आशा पाटील / Wikimedia Commons, CC BY 4.0",
    );
    expect(creditLine("", "The Fictional Gazette", "unknown")).toBe("Photo: The Fictional Gazette");
    expect(creditLine("  ", "", "")).toBe("Photo: unknown");
    expect(creditLine("x".repeat(600), "s", "CC0")).toHaveLength(500);
  });
});
