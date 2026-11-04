// An article page's text for the draft: the paragraphs of its <article> (else <main>, else the whole page), without
// scripts, menus, headers, footers, asides, forms and figures; and its lead picture and site name from the Open Graph
// tags (og:image with og:image:width/height when the page gives them, og:site_name).
import { DomUtils, parseDocument } from "htmlparser2";
import { absolute } from "./feeds.ts";

const { getElementsByTagName, textContent, getAttributeValue, removeElement } = DomUtils;

export type Extracted = {
  text: string;
  image: { url: string; widthPx: number | null; heightPx: number | null } | null;
  site: string | null;
};

const NOISE = ["script", "style", "noscript", "nav", "header", "footer", "aside", "form", "figure", "iframe", "svg"];
/** A paragraph shorter than this is a caption, a share button or a byline more often than text. */
const MIN_PARAGRAPH = 30;
const MAX_TEXT = 20_000;

export function extractArticle(html: string, pageUrl: string): Extracted {
  const doc = parseDocument(html);
  const meta = (property: string) => {
    const tag = getElementsByTagName("meta", doc, true).find(
      (m) => (getAttributeValue(m, "property") ?? getAttributeValue(m, "name")) === property,
    );
    return tag ? (getAttributeValue(tag, "content") ?? "").trim() : "";
  };
  const imageUrl = absolute(meta("og:image:secure_url") || meta("og:image"), pageUrl);
  const size = (name: string) => (/^[1-9][0-9]{0,5}$/.test(meta(name)) ? Number(meta(name)) : null);
  for (const tag of NOISE) for (const el of getElementsByTagName(tag, doc, true)) removeElement(el);
  const scope = getElementsByTagName("article", doc, true)[0] ?? getElementsByTagName("main", doc, true)[0] ?? doc;
  const paragraphs = getElementsByTagName("p", scope, true)
    .map((p) => textContent(p).replace(/\s+/g, " ").trim())
    .filter((p) => p.length >= MIN_PARAGRAPH);
  return {
    text: paragraphs.join("\n\n").slice(0, MAX_TEXT),
    image: imageUrl ? { url: imageUrl, widthPx: size("og:image:width"), heightPx: size("og:image:height") } : null,
    site: meta("og:site_name").slice(0, 200) || null,
  };
}
