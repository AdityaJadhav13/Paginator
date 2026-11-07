// A feed's items (RSS 2.0, RSS 1.0/RDF and Atom), read forgivingly: the title, a short summary as plain text (feeds
// put HTML, escaped or in CDATA, in their descriptions), the link (made absolute against the feed's address; only
// http and https), and the time it was published when the feed gives one. An item without a title or a link is left
// out.
import { DomUtils, parseDocument } from "htmlparser2";

export type FeedItem = { title: string; summary: string; link: string; published: string | null };

const { getElementsByTagName, textContent, getAttributeValue } = DomUtils;
type Element = ReturnType<typeof getElementsByTagName>[number];

export function parseFeed(xml: string, feedUrl: string): FeedItem[] {
  const doc = parseDocument(xml, { xmlMode: true });
  const atom = getElementsByTagName("entry", doc, true);
  const entries = atom.length > 0 ? atom : getElementsByTagName("item", doc, true);
  const items: FeedItem[] = [];
  for (const entry of entries) {
    const title = plain(child(entry, "title"), 500);
    const link = absolute(atom.length > 0 ? atomLink(entry) : linkOf(entry), feedUrl);
    if (!title || !link) continue;
    const summary = plain(
      child(entry, "description") ||
        child(entry, "summary") ||
        child(entry, "content") ||
        child(entry, "content:encoded"),
      2000,
    );
    const when =
      child(entry, "pubDate") || child(entry, "published") || child(entry, "dc:date") || child(entry, "updated");
    items.push({ title, summary, link, published: moment(when) });
  }
  return items;
}

/** The text of an entry's own child element (not a nested one's). */
function child(entry: Element, name: string): string {
  const found = getElementsByTagName(name, entry.children, false, 1)[0];
  return found ? textContent(found).trim() : "";
}

function linkOf(entry: Element): string {
  const guid = getElementsByTagName("guid", entry.children, false, 1)[0];
  const permalink = guid && getAttributeValue(guid, "isPermaLink") !== "false" ? textContent(guid).trim() : "";
  return child(entry, "link") || permalink;
}

function atomLink(entry: Element): string {
  const links = getElementsByTagName("link", entry.children, false);
  const alternate = links.find((l) => (getAttributeValue(l, "rel") ?? "alternate") === "alternate") ?? links[0];
  return (alternate && getAttributeValue(alternate, "href")) || "";
}

/** `link` made absolute against `base`: an http(s) address of at most 2048 characters, else null. */
export function absolute(link: string, base: string): string | null {
  if (!link) return null;
  try {
    const u = new URL(link, base);
    return (u.protocol === "http:" || u.protocol === "https:") && u.href.length <= 2048 ? u.href : null;
  } catch {
    return null;
  }
}

/** HTML or text as one line of plain text, at most `max` characters. */
export function plain(html: string, max: number): string {
  const text = /[<&]/.test(html) ? textContent(parseDocument(html)) : html;
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

function moment(text: string): string | null {
  if (!text) return null;
  const t = new Date(text);
  // a date the contract cannot take (year 10000, or before 1970) would refuse the whole run's event: none instead
  const year = Number.isNaN(t.getTime()) ? NaN : t.getUTCFullYear();
  return year >= 1970 && year <= new Date().getUTCFullYear() + 1 ? t.toISOString() : null;
}
