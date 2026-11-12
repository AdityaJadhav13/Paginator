// A photo's label and credit line (deterministic, never Claude; docs/product/13-news-finder.md). Safe to print: a
// Wikimedia Commons or Openverse photo under CC0, CC BY or CC BY-SA (any version or port) or in the public domain
// (the Public Domain Mark, PD-…), or a government press release (PIB). Anything else needs permission: NC and ND
// licences, unknown licences, and every picture of a source article (its og:image), whatever it claims.
import type { LicenceLabel, PhotoCandidate } from "@pageinator/contracts";

type Origin = PhotoCandidate["origin"];

/** The licence's name in a comparable form: lower case, words split on spaces, hyphens and underscores. */
const norm = (licence: string) =>
  licence
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[-_/,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const VERSION = String.raw`(?: v?\d+(?:\.\d+)?)?`;
const PORT = String.raw`(?: [a-z]{2,5})?`; // a jurisdiction port: "in", "de", "igo"
const SAFE = new RegExp(
  String.raw`^(?:` +
    String.raw`cc0${VERSION}(?: universal)?` +
    // "by" without "cc" only with a version ("by sa 4.0", as Openverse writes it): a bare "by" says nothing
    String.raw`|cc by(?: sa)?${VERSION}${PORT}|by(?: sa)? v?\d+(?:\.\d+)?${PORT}` +
    String.raw`|(?:creative commons )?attribution(?: share ?alike)?${VERSION}${PORT}` +
    String.raw`|public domain(?: mark)?${VERSION}|pdm${VERSION}|pd (?:old|us|gov|usgov|india|author|self|textlogo)(?: [a-z0-9 .]+)?` +
    String.raw`)$`,
);

export function licenceLabel(origin: Origin, licence: string): LicenceLabel {
  if (origin === "pib") return "safe";
  if (origin === "source") return "needs_permission";
  const name = norm(licence);
  // "attribution" alone (Commons' own non-CC licence) is not on the list; only with "creative commons" in front
  if (name === "attribution") return "needs_permission";
  if (/\b(?:nc|nd)\b|non ?commercial|no ?deriv/.test(name)) return "needs_permission";
  return SAFE.test(name) ? "safe" : "needs_permission";
}

/** "Photo: <creator> / <site>, <licence>": the licence named whenever it is known (CC BY and BY-SA ask for it), the
 * creator left out when unknown. At most 500 characters. */
export function creditLine(creator: string, site: string, licence: string): string {
  const who = [creator.trim(), site.trim()].filter(Boolean).join(" / ") || "unknown";
  const known = licence.trim() && norm(licence) !== "unknown" ? `, ${licence.trim()}` : "";
  return `Photo: ${who}${known}`.slice(0, 500);
}
