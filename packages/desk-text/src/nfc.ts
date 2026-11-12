// unicodedata.normalize("NFC", text) as Python 3.11 does it. Python 3.11 knows Unicode 14; JavaScript engines know
// later versions (Node 24: Unicode 17), and give some code points added since 2021 a decomposition or a combining
// class (on Node 24, 76 of them: Tulu-Tigalari, Todhri, Kawi …). Python treats each code point it does not know as a
// starter that composes with nothing, so NFC(a + u + b) is NFC(a) + u + NFC(b) for such a code point u: the port
// normalises the runs between them with the engine and keeps them as they are. For the code points Unicode 14 does
// assign, Unicode's stability policy keeps every later version's normalisation the same. The parity test checks the
// result on every code point (test/vectors/desk-text.jsonl, "nfc").
import { UNASSIGNED } from "./unicode14.gen.ts";

const FIRST = UNASSIGNED[0]?.[0] ?? 0x110000;

/** True when Unicode 14 leaves the code point unassigned. */
export function unassigned14(codePoint: number): boolean {
  if (codePoint < FIRST) return false;
  let low = 0;
  let high = UNASSIGNED.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const [first, last] = UNASSIGNED[middle] ?? [0, -1];
    if (codePoint < first) high = middle - 1;
    else if (codePoint > last) low = middle + 1;
    else return true;
  }
  return false;
}

export function nfc(text: string): string {
  let out = "";
  let start = 0;
  for (let i = 0; i < text.length;) {
    const codePoint = text.codePointAt(i) ?? 0;
    const size = codePoint > 0xffff ? 2 : 1;
    if (unassigned14(codePoint)) {
      out += text.slice(start, i).normalize("NFC") + text.slice(i, i + size);
      start = i + size;
    }
    i += size;
  }
  return start === 0 ? text.normalize("NFC") : out + text.slice(start).normalize("NFC");
}
