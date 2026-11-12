// The engine's body parser (tools/desk/engine/deskarticles.py: blocks, body_words, is_brief; deskcommon.nfc), so the
// hosted word counts and short-item flags are the ones the engine prints by. Python's semantics: src/python.ts.
import { nfc } from "./nfc.ts";
import { rstrip, skip, split, strip, truthy } from "./python.ts";

/** deskarticles.BRIEF_WORDS: a short item ("news in brief") has 1 to 60 body words and no photo. */
export const BRIEF_WORDS = 60;
/** deskarticles.SENTENCE_END: what may end a line that is a paragraph of its own. */
export const SENTENCE_END = ".!?।॥:;\"'”’)";
const ENDS = new Set([...SENTENCE_END].map((ch) => ch.charCodeAt(0)));
const HASH = 0x23;

export type Block = { kind: "para" | "crosshead"; text: string };

/** deskcommon.nfc: CR and CRLF to LF, NFC, each line's trailing space trimmed, and the whole stripped. */
export function deskNfc(text: string | null | undefined): string {
  if (!text) return "";
  const lines = nfc(text.replaceAll("\r\n", "\n").replaceAll("\r", "\n")).split("\n");
  return strip(lines.map(rstrip).join("\n"));
}

function isSubheading(line: string): boolean {
  return strip(line).startsWith("##");
}

/** A line ends a sentence (ln[-1] in SENTENCE_END; no sentence end is outside the BMP, so the last code unit says). */
function endsSentence(line: string): boolean {
  return ENDS.has(line.charCodeAt(line.length - 1));
}

/**
 * deskarticles.blocks: body text → paragraphs and subheadings.
 * - A line that starts with "##" is a subheading, wherever it stands.
 * - Paragraphs are separated by empty lines; the lines inside one are joined with spaces.
 * - Text with no empty line at all, most of whose lines end a sentence, is one paragraph per line (as WhatsApp and
 *   word processors paste it); lines broken at the margin end mid-sentence and are joined.
 */
export function blocks(body: string | null | undefined): Block[] {
  const raw = deskNfc(body).split("\n");
  const text = raw.map(strip).filter((line, k) => line !== "" && !isSubheading(raw[k] ?? ""));
  const blankInside = raw.some((line) => strip(line) === "");
  const ends = text.filter(endsSentence).length;
  const perLine = !blankInside && text.length > 1 && ends >= 0.6 * text.length;
  const out: Block[] = [];
  const current: string[] = [];
  const flush = () => {
    if (current.length === 0) return;
    out.push({ kind: "para", text: split(current.join(" ")).join(" ") });
    current.length = 0;
  };
  for (const line of raw) {
    const s = strip(line);
    if (s === "") flush();
    else if (isSubheading(s)) {
      flush();
      const head = split(s.slice(skip(s, 0, HASH))).join(" ");
      if (head !== "") out.push({ kind: "crosshead", text: head });
    } else {
      current.push(s);
      if (perLine) flush();
    }
  }
  flush();
  return out;
}

/** deskarticles.body_words: the words of the paragraphs (subheadings are not counted). */
export function bodyWords(body: string | null | undefined): number {
  return blocks(body).reduce((sum, block) => sum + (block.kind === "para" ? split(block.text).length : 0), 0);
}

/** deskarticles.is_brief: no photo, and 1 to 60 body words. A photo is any value Python counts as true. */
export function isBrief(article: { body?: string | null | undefined; photo?: unknown }): boolean {
  const words = bodyWords(article.body);
  return !truthy(article.photo) && words > 0 && words <= BRIEF_WORDS;
}
