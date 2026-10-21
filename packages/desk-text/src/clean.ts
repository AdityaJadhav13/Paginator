// Text as the Desk stores it (tools/desk/deskserver/util.py clean_text), with the Desk's limits and field names
// (deskserver/store.py TEXT_FIELDS) and its plain refusals, word for word.
import { nfc } from "./nfc.ts";
import { length, rstrip, strip } from "./python.ts";

/** The most characters (code points) of a headline, kicker, deck, byline, caption or credit. */
export const LINE_LIMIT = 2000;
/** The most characters (code points) of a body. */
export const BODY_LIMIT = 200_000;
/** The story fields the Desk cleans, with the name its messages give each and its limit (store.TEXT_FIELDS). */
export const TEXT_FIELDS = [
  { key: "headline", label: "headline", limit: LINE_LIMIT },
  { key: "kicker", label: "kicker", limit: LINE_LIMIT },
  { key: "deck", label: "deck", limit: LINE_LIMIT },
  { key: "byline", label: "byline", limit: LINE_LIMIT },
  { key: "body", label: "article text", limit: BODY_LIMIT },
] as const;

/** A refusal as the Desk words it: its status (400) and its plain message for the person at the desk. */
export class DeskTextError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "DeskTextError";
  }
}

/** The C0 controls but tab and LF (CRs are LFs by then), and DEL: util._CONTROL. */
function control(unit: number): boolean {
  return (unit <= 0x08 || (unit >= 0x0b && unit <= 0x1f) || unit === 0x7f) && unit !== 0x09 && unit !== 0x0a;
}

function withoutControls(text: string): string {
  let out = "";
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (!control(text.charCodeAt(i))) continue;
    out += text.slice(start, i);
    start = i + 1;
  }
  return start === 0 ? text : out + text.slice(start);
}

/**
 * util.clean_text: NFC, CR and CRLF to LF, control characters dropped (after NFC, as the Desk does), each line's
 * trailing space trimmed and the whole stripped; refused when longer than `limit` code points. Null is "".
 * The Desk also takes a number and writes it with Python's str(); the port refuses one ("must be text"), as the hosted
 * API's schemas do, because JavaScript cannot tell 1.0 from 1.
 */
export function cleanText(value: unknown, field: string, limit: number): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") throw new DeskTextError(`The ${field} must be text.`);
  const text = withoutControls(nfc(value.replaceAll("\r\n", "\n").replaceAll("\r", "\n")));
  const cleaned = strip(text.split("\n").map(rstrip).join("\n"));
  const n = length(cleaned);
  if (n > limit) throw new DeskTextError(`The ${field} is too long (${n} characters; the most is ${limit}).`);
  return cleaned;
}
