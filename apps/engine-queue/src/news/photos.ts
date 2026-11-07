// Photos for a big story (only when the editor asked for one): candidates from the Wikimedia Commons API, the
// Openverse API and the source articles' own lead pictures (og:image), filtered by code (long side at least 2000 px,
// JPEG, PNG or WebP, no logos, icons or banners), the first 8 ranked by one Claude vision call, 3-5 offered, each
// with its deterministic label and credit line. PIB is not searched: it has no stable public API for its photos
// (its press releases' pictures sit only in its web pages), so a PIB picture comes in only as a source's og:image.
// A failure anywhere here never fails the draft: the draft is offered with fewer photos, or none.
import type { PhotoCandidate } from "@pageinator/contracts";
import { z } from "zod";
import type { Budget } from "./ai.ts";
import { safeFetch, type Fetcher } from "./fetch.ts";
import { creditLine, licenceLabel } from "./licence.ts";

/** Prints about a third of a page wide at 150 ppi (docs/product/13-news-finder.md; to be tuned with the L2-370 grid). */
export const MIN_LONG_SIDE = 2000;
const RANKED = 8;
const OFFERED = 5;
const MIN_OFFERED = 3;
/** JPEG, PNG or WebP, by its MIME type or its file extension */
const PHOTO_TYPE = /^(?:image\/)?(?:jpe?g|png|webp)$/i;
const NOT_A_PHOTO = /logo|icon|favicon|sprite|placeholder|avatar|badge|banner|watermark/i;
const API = { maxBytes: 2 * 1024 * 1024, timeoutMs: 15_000, types: ["application/json"] } as const;

export type SourceImage = {
  url: string;
  widthPx: number | null;
  heightPx: number | null;
  pageUrl: string;
  site: string;
};

type Candidate = Omit<PhotoCandidate, "label" | "credit">;

const Text = z.object({ value: z.unknown() }).optional();
const CommonsAnswer = z.object({
  query: z
    .object({
      pages: z.record(
        z.string(),
        z.object({
          title: z.string(),
          imageinfo: z
            .array(
              z.object({
                url: z.string(),
                thumburl: z.string().optional(),
                descriptionurl: z.string(),
                width: z.number(),
                height: z.number(),
                mime: z.string(),
                extmetadata: z
                  .object({ Artist: Text, LicenseShortName: Text, LicenseUrl: Text, ObjectName: Text })
                  .optional(),
              }),
            )
            .optional(),
        }),
      ),
    })
    .optional(),
});

const OpenverseAnswer = z.object({
  results: z.array(
    z.object({
      url: z.string(),
      thumbnail: z.string().nullish(),
      foreign_landing_url: z.string().nullish(),
      width: z.number().nullish(),
      height: z.number().nullish(),
      title: z.string().nullish(),
      creator: z.string().nullish(),
      source: z.string().nullish(),
      license: z.string(),
      license_version: z.string().nullish(),
      license_url: z.string().nullish(),
      filetype: z.string().nullish(),
    }),
  ),
});

const plainText = (v: unknown) =>
  typeof v === "string"
    ? v
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;|&#160;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ")
        .trim()
    : "";
const http = (u: string | null | undefined) => (u && /^https?:\/\/[^\s]+$/.test(u) && u.length <= 2048 ? u : null);

export async function commons(query: string, fetcher: Fetcher = safeFetch): Promise<Candidate[]> {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  for (const [k, v] of Object.entries({
    action: "query",
    format: "json",
    formatversion: "1",
    generator: "search",
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: "6",
    gsrlimit: "20",
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: "640",
    iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl|ObjectName",
  }))
    url.searchParams.set(k, v);
  const { body } = await fetcher(url.href, API);
  const pages = CommonsAnswer.parse(JSON.parse(body.toString("utf8"))).query?.pages ?? {};
  return Object.values(pages).flatMap((page) => {
    const info = page.imageinfo?.[0];
    const full = http(info?.url);
    const pageUrl = http(info?.descriptionurl);
    if (!info || !full || !pageUrl || !PHOTO_TYPE.test(info.mime)) return [];
    const meta = info.extmetadata;
    const licence = plainText(meta?.LicenseShortName?.value) || "unknown";
    return [
      {
        url: full,
        thumbUrl: http(info.thumburl) ?? full,
        pageUrl,
        widthPx: info.width,
        heightPx: info.height,
        title: (
          plainText(meta?.ObjectName?.value) || page.title.replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "")
        ).slice(0, 500),
        creator: plainText(meta?.Artist?.value).slice(0, 500),
        site: "Wikimedia Commons",
        licence: licence.slice(0, 100),
        licenceUrl: http(plainText(meta?.LicenseUrl?.value)),
        origin: "commons" as const,
      },
    ];
  });
}

/** Openverse's anonymous API (a few requests a minute and a hundred or so a day are allowed without a key: one per
 * draft). Only licences that allow commercial use and changes are asked for. */
export async function openverse(query: string, fetcher: Fetcher = safeFetch): Promise<Candidate[]> {
  const url = new URL("https://api.openverse.org/v1/images/");
  for (const [k, v] of Object.entries({ q: query, license_type: "commercial,modification", page_size: "20" }))
    url.searchParams.set(k, v);
  const { body } = await fetcher(url.href, API);
  return OpenverseAnswer.parse(JSON.parse(body.toString("utf8"))).results.flatMap((r) => {
    const full = http(r.url);
    const pageUrl = http(r.foreign_landing_url) ?? full;
    const filetype = r.filetype ?? full?.split(".").pop() ?? "";
    if (!full || !pageUrl || !r.width || !r.height || !PHOTO_TYPE.test(filetype)) return [];
    const code = r.license.toLowerCase();
    const name = code === "cc0" ? "CC0" : code === "pdm" ? "Public Domain Mark" : `CC ${code.toUpperCase()}`;
    return [
      {
        url: full,
        thumbUrl: http(r.thumbnail) ?? full,
        pageUrl,
        widthPx: Math.round(r.width),
        heightPx: Math.round(r.height),
        title: (r.title ?? "").slice(0, 500),
        creator: (r.creator ?? "").slice(0, 500),
        site: (r.source ?? "Openverse").slice(0, 200),
        licence: `${name}${r.license_version ? ` ${r.license_version}` : ""}`.slice(0, 100),
        licenceUrl: http(r.license_url),
        origin: "openverse" as const,
      },
    ];
  });
}

/** The source articles' lead pictures: only those whose pages give their size (a picture of unknown size is left out:
 * shortcut, upgrade by reading the size from the picture's first bytes). */
export function fromSources(images: readonly SourceImage[]): Candidate[] {
  return images.flatMap((img) => {
    const ext = new URL(img.url).pathname.split(".").pop() ?? "";
    if (!img.widthPx || !img.heightPx || !PHOTO_TYPE.test(ext)) return [];
    return [
      {
        url: img.url,
        thumbUrl: img.url,
        pageUrl: img.pageUrl,
        widthPx: img.widthPx,
        heightPx: img.heightPx,
        title: img.site.slice(0, 500),
        creator: "",
        site: img.site.slice(0, 200),
        licence: "unknown",
        licenceUrl: null,
        origin: "source" as const,
      },
    ];
  });
}

/** Big enough to print, not a logo or a banner (the type is checked as each source is read). */
export function printable(c: Candidate): boolean {
  const long = Math.max(c.widthPx, c.heightPx);
  const short = Math.min(c.widthPx, c.heightPx);
  return long >= MIN_LONG_SIDE && long <= 4 * short && !NOT_A_PHOTO.test(`${c.title} ${c.url}`);
}

const finish = (c: Candidate): PhotoCandidate => ({
  ...c,
  label: licenceLabel(c.origin, c.licence),
  credit: creditLine(c.creator, c.site, c.licence),
});

export type PhotoDeps = { fetcher?: Fetcher; signal?: AbortSignal };

/** 3-5 photos for the story, best first (fewer when fewer are found); never throws. */
export async function findPhotos(
  title: string,
  sources: readonly SourceImage[],
  budget: Budget,
  deps: PhotoDeps = {},
): Promise<PhotoCandidate[]> {
  const fetcher = deps.fetcher ?? safeFetch;
  const found = await Promise.all([commons(title, fetcher), openverse(title, fetcher)].map((p) => p.catch(() => [])));
  const seen = new Set<string>();
  // free pictures first (Commons, Openverse), then the sources' own; each picture once
  const candidates = [...found.flat(), ...fromSources(sources)]
    .filter(printable)
    .filter((c) => !seen.has(c.url) && seen.add(c.url))
    .map(finish)
    .sort((a, b) => Number(b.label === "safe") - Number(a.label === "safe"))
    .slice(0, RANKED);
  if (candidates.length <= 1) return candidates;
  try {
    const { order } = await budget.run((ai) =>
      ai.rankPhotos({ title, photos: candidates.map((c) => ({ thumbUrl: c.thumbUrl, title: c.title })) }, deps.signal),
    );
    const picked = [...new Set(order)].filter((n) => n < candidates.length).slice(0, OFFERED);
    // Claude found fewer than three that fit: the rest in order, up to three
    for (let n = 0; picked.length < Math.min(MIN_OFFERED, candidates.length); n++)
      if (!picked.includes(n)) picked.push(n);
    return picked.map((n) => candidates[n]).filter((c): c is PhotoCandidate => c !== undefined);
  } catch {
    // AI off, the cap, a refusal, a rate limit or an outage: the photos unranked, never the draft lost
    return candidates.slice(0, OFFERED);
  }
}
