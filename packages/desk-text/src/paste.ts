// The Desk's "paste several articles" (tools/desk/deskserver/store.py: parse_bulk, and create_many's checks through
// _apply): articles separated by a line of only `---`. The Desk's two expressions are matched by hand, with Python's
// semantics: `\s` is str.isspace, `.` is anything but LF, and IGNORECASE lets the i of "byline" also be İ or ı.
import { DeskTextError, BODY_LIMIT, LINE_LIMIT, cleanText } from "./clean.ts";
import { nfc } from "./nfc.ts";
import { prefix, skip, skipSpace, strip } from "./python.ts";

export type PastedArticle = { headline: string; byline: string; body: string };
export type SkippedArticle = { headline: string; reason: string };
export type Pasted = { created: PastedArticle[]; skipped: SkippedArticle[] };

const DASH = 0x2d;
/** byline, as re.IGNORECASE matches each letter: B b, Y y, L l, I i İ ı, N n, E e */
const BYLINE = [
  [0x42, 0x62],
  [0x59, 0x79],
  [0x4c, 0x6c],
  [0x49, 0x69, 0x130, 0x131],
  [0x4e, 0x6e],
  [0x45, 0x65],
];
const VARTAHAR = "वार्ताहर"; // "reporter": Devanagari has no case
const COLONS = new Set([0x3a, 0xff1a]); // : and the full-width ：
const DASHES = new Set([0x2d, 0x2013, 0x2014]); // - – —

/** _SEPARATOR.fullmatch(line): \s*-{3,}\s* */
export function isSeparator(line: string): boolean {
  const s = strip(line);
  return s.length >= 3 && skip(s, 0, DASH) === s.length;
}

/** The marker's end, when `line` has "byline" (in any case) at `at`, else -1. */
function bylineWord(line: string, at: number): number {
  if (line.startsWith(VARTAHAR, at)) return at + VARTAHAR.length;
  for (const [k, letters] of BYLINE.entries()) if (!letters.includes(line.charCodeAt(at + k))) return -1;
  return at + BYLINE.length;
}

/** _BYLINE.fullmatch(line).group(1): \s*(?:byline|वार्ताहर)\s*[:：]\s*[-–—]?\s*(.*), or null when it does not match. */
export function bylineOf(line: string): string | null {
  let i = bylineWord(line, skipSpace(line, 0));
  if (i < 0) return null;
  i = skipSpace(line, i);
  if (!COLONS.has(line.charCodeAt(i))) return null;
  i = skipSpace(line, i + 1);
  if (DASHES.has(line.charCodeAt(i))) i += 1;
  const rest = line.slice(skipSpace(line, i));
  return rest.includes("\n") ? null : rest;
}

/**
 * store.parse_bulk: in each part, the first non-empty line is the headline; the next non-empty line, when it starts
 * with "Byline:" (any case) or "वार्ताहर:", is the byline; the rest is the body. Parts with nothing in them are left out.
 * The parts are as pasted (NFC aside): pasteArticles cleans and checks them.
 */
export function parseBulk(text: unknown): PastedArticle[] {
  if (typeof text !== "string") throw new DeskTextError("Paste the articles as text.");
  const chunks: string[][] = [[]];
  for (const line of nfc(text.replaceAll("\r\n", "\n").replaceAll("\r", "\n")).split("\n")) {
    if (isSeparator(line)) chunks.push([]);
    else chunks[chunks.length - 1]?.push(line);
  }
  const items: PastedArticle[] = [];
  for (const lines of chunks) {
    const filled = lines.flatMap((line, k) => (strip(line) !== "" ? [k] : []));
    const [head, second] = filled;
    if (head === undefined) continue;
    let start = head + 1;
    let byline = "";
    const found = second === undefined ? null : bylineOf(lines[second] ?? "");
    if (second !== undefined && found !== null) {
      byline = found;
      start = second + 1;
    }
    items.push({ headline: lines[head] ?? "", byline, body: lines.slice(start).join("\n") });
  }
  return items;
}

/** One pasted article as the Desk accepts it (store._apply on headline, byline and body), or a refusal. */
function accepted(item: PastedArticle): PastedArticle {
  const headline = cleanText(item.headline, "headline", LINE_LIMIT);
  const byline = cleanText(item.byline, "byline", LINE_LIMIT);
  const body = cleanText(item.body, "article text", BODY_LIMIT);
  if (headline === "") throw new DeskTextError("Every article needs a headline.");
  if (body === "") throw new DeskTextError("Every article needs some text.");
  return { headline, byline, body };
}

/**
 * The Desk's paste (Store.bulk_create): the articles it would add, cleaned, and the parts it would skip with the
 * reason, their headline trimmed and cut at 200 characters. Refused, with the Desk's message, when none is added.
 */
export function pasteArticles(text: unknown): Pasted {
  const created: PastedArticle[] = [];
  const skipped: SkippedArticle[] = [];
  for (const item of parseBulk(text)) {
    try {
      created.push(accepted(item));
    } catch (error) {
      if (!(error instanceof DeskTextError)) throw error;
      skipped.push({ headline: prefix(strip(item.headline), 200), reason: error.message });
    }
  }
  if (created.length === 0) {
    const hint = skipped.length > 0 ? ` ${skipped.length} part(s) had a headline but no text.` : "";
    throw new DeskTextError(
      "No articles were found. Put each article's headline on its first line, its text below it, and a line with " +
        `only --- between articles.${hint}`,
    );
  }
  return { created, skipped };
}
