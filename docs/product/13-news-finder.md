# 13 — The news finder (the sidebar's "Sources")

Status: owner request of 2026-11-04, built as L2.7 (10-l2-newsroom-plan.md §1) on `feat/l2-news`. Every example name
is fictional. What still needs a real API key, real feeds or the owner's decisions is listed in §8.

## 1. What the newsroom gets

Every few hours the product collects the latest news from a list of sites and RSS feeds the paper chooses. It groups
reports of the same event from different sources into one **topic**. An editor picks a topic, and Claude drafts a
story about it **in the paper's own words and house style**, in Marathi or English, from all the sources together:
- it never copies sentences (a check in code, §5, makes sure);
- the source links come with it, for the editor (not printed unless the editor keeps them).

Only **important news gets a photo** (owner: "not every story needs an image; the important news should have one").
For those, the product offers 3–5 print-worthy photos, each labelled **Safe to print** or **Needs permission**. A
"Needs permission" photo is used only after someone ticks **"We have the right to print this"**, which is recorded.

The story lands in Stories as a **Draft assigned to the editor who picked it**. Nothing prints without a person
approving it through the normal approvals.

## 2. Who sees it

| Who | What |
|---|---|
| Chief Editor, Editor, Sub-editor (and Owner, Admin) | the Sources screen: topics, pick, drafts, photos, the rights tick |
| Chief Editor (and Owner, Admin) | the source list, the house style guide, "Collect now", how often to collect |
| Reporters and everyone else | nothing: the screen is not in their sidebar, and the API refuses them |

Everything is kept per paper, behind the same walls as the rest of the product, and recorded in the audit log:
source changes, settings changes, collections, picks, drafts, photo choices and rights ticks.

## 3. How it works

1. **Sources.** Each paper keeps its own list: name, feed address, language (Marathi or English), on or off, last
   fetch and its last problem (shown in English or Marathi). **Add suggested sources** (Chief Editor, Owner, Admin)
   adds, switched on, whichever of these public feeds the list does not have yet (by address; all answered valid RSS
   on 2026-11-04; the owner confirms the list, D-27):

   | Name | Feed | Language |
   |---|---|---|
   | Sakal | https://www.esakal.com/stories.rss | Marathi |
   | ABP Majha | https://marathi.abplive.com/home/feed | Marathi |
   | TV9 Marathi | https://www.tv9marathi.com/feed | Marathi |
   | The Hindu | https://www.thehindu.com/feeder/default.rss | English |
   | The Indian Express | https://indianexpress.com/feed/ | English |
   | Hindustan Times | https://www.hindustantimes.com/feeds/rss/india-news/rssfeed.xml | English |
   | NDTV | https://feeds.feedburner.com/ndtvnews-top-stories | English |

   Loksatta, Lokmat and Maharashtra Times had no working public feed on 2026-11-04, and PIB's feed answered in Hindi,
   so none of them is suggested. Only feeds are read for collection; pages are never scraped for it.
2. **Collect** (every 3 hours by default; the Chief Editor can change it or collect now). The engine queue fetches
   each feed politely: a product User-Agent (never a person's email), time limits, size limits, at most three
   redirects, and only public internet addresses (§6). Items are kept for 3 days; a link already seen is skipped.
3. **Group.** One Claude call per collection groups the new items (titles and summaries) into topics, or adds them
   to a topic from the last 3 days, with an importance from 1 to 5. Topics are listed by the number of distinct
   sources and how recent they are. A **big story** has at least 3 distinct sources or importance 4 or more.
4. **Pick.** The editor chooses the language, the length (short, standard, long) and **Find a photo**, which is on
   by default only for big stories.
5. **Draft.** The engine queue reads each source article (respecting the site's robots.txt), and one Claude call
   writes the story with the paper's **house style guide** (an editable text kept in the database; the paper's own
   style examples never enter the repository). The byline is "Pageinator desk". Then the copy check (§5) runs; a
   failure gets one rewrite of the flagged sentences, and anything still too close is **shown to the editor**, never
   passed silently.
6. **Photos** (only with Find a photo). Candidates come from Wikimedia Commons and Openverse (free licences, with
   author and licence in their data) and from the source articles' own lead pictures. Code drops pictures smaller
   than 2000 px on the long side (about a third of a page wide, sharp at 150 ppi), other formats, logos and icons.
   One Claude call ranks the best few ("fits the news, clear subject, prints well"), and 3–5 are offered.
7. **Labels are decided by code, never by Claude.** Safe to print: Wikimedia/Openverse pictures under CC0, CC BY,
   CC BY-SA or public domain, and government press-release pictures; a paid agency the paper configures (D-29).
   Everything else, including a news site's own picture, is Needs permission. CC BY and BY-SA credit lines are filled
   in as the licence asks.
8. **The chosen photo** goes into the Media library through the same intake as an upload (fingerprint, preview, CMYK
   version), with its caption, credit and photographer or site, source link, licence and label. Attaching a Needs
   permission picture to any story is refused until the rights tick is recorded (who and when, shown in the Media
   library's picture details).

## 4. Honesty and safety

- Every draft and photo choice says **"Made with Claude — check before use"** until a person edits the story.
- AI only drafts text, groups headlines and ranks photos. No AI for layout, line breaks, fit or validity (unchanged).
- The API key lives only on the engine queue's server; the API is told only whether there is one (`PGN_NEWS_AI`, set
  on by the pilot's compose file exactly when the key is). With no key the Sources screen says the AI part is off from
  the start (before any collection), collection still works, and "Trending" lists the **latest headlines** by source,
  newest first, labelled as not grouped: no topic is made per headline, and nothing can be picked (the API refuses a
  pick with `ai_off`, so no draft is queued to fail).
- A daily spend cap (₹300 by default) is checked before every Claude call; every call's tokens and cost are logged,
  and the Sources screen shows the AI spend this month.
- Claude's answers are read only after checking that it finished (not refused, not cut short); a refusal is retried
  once on a fallback model by Anthropic's own server-side fallback.
- Tests use a fake Claude and recorded fictional feeds: no network and no key in CI.

## 5. The copy check (code, not AI)

A sentence of the draft is flagged when it shares **8 or more consecutive words** with any source article, or when
**60 % or more of its five-word sequences** appear in a source. Words are cut the way Marathi needs (Devanagari
letters and vowel signs kept together, Unicode-normalised, case ignored); sentences end at . ? ! । ॥ and line
breaks. Unit tests cover Marathi and English.

## 6. Fetching safely

Feeds, articles, robots.txt, the photo searches and the chosen photo's download all go through one guarded fetch:
http and https only; the address actually connected to must be a public one (private, loopback, link-local,
carrier-grade NAT, multicast and reserved ranges refused, IPv6 included; an IPv4 address inside IPv6 (mapped,
compatible, or NAT64 on 64:ff9b::/96 and 64:ff9b:1::/96) is judged as that IPv4 address, checked after the name is resolved so a
changing DNS answer cannot slip past); every redirect checked again, at most three; a time limit for the whole
request; a size limit enforced while reading.

## 7. Cost (Claude Opus 5.5: $4 per million input tokens, $20 per million output; about ₹88 per $)

| Part | Estimate |
|---|---|
| Grouping: 8 collections a day, ~14k in and ~4k out each | about ₹2,900 a month |
| A draft: ~12k in, ~5k out | about ₹13 a story; 10 a day ≈ ₹4,000 a month |
| Photo ranking (big stories only) | about ₹3.5 each; 4 a day ≈ ₹400 a month |
| **Total at 10 drafts a day** | **≈ ₹7,000–8,000 a month** (≈ ₹4,500 at 5 a day) |
| Hosting | none new: it runs in the existing engine queue; a few hundred rupees a month of storage at most |

Claude Haiku 5.5 for grouping only would cut grouping to about ₹100 a month (the owner's choice; Opus stays the
default). These are estimates, not measured: no real call has been made yet (§8).

## 8. What is not yet proven, and the owner's decisions

Built and tested with a fake Claude and fictional feeds only. Before real use:
- **D-26** an Anthropic API key and a monthly budget (then the first real collections and drafts are watched: the
  grouping's quality, the drafts' Marathi, the photo ranking, the real cost against §7, prompt caching's hit rate);
- **D-27** the starting source list (the suggested feeds are public, but whether each may be used is the owner's call);
- **D-28** the house style guide text (and examples, kept private);
- **D-29** any paid agency (PTI, ANI, Reuters pictures) to treat as Safe to print.

The feeds checked on 2026-11-04 as valid public RSS are the suggested list in §3.1. Loksatta, Lokmat and Maharashtra
Times have no working public feed (2026-11-04), and PIB's feed is Hindi. Minor findings left for the end are
L2-420–L2-431 in 11-fix-before-launch.md.
