// Python 3.11's string semantics where JavaScript's differ, as far as the Desk's text functions use them. Whitespace is
// str.isspace's (the same as `\s` in Python's re), not JavaScript's `\s` or trim(): Python counts U+001C–U+001F and
// U+0085 as space and U+FEFF not. Lengths and slices count code points, as Python's do, not UTF-16 code units. The
// parity test checks each against Python on every code point (test/vectors/desk-text.jsonl).

/** str.isspace for one UTF-16 code unit: the 29 code points of Python 3.11 (all in the BMP, so a surrogate is not). */
export function isSpace(unit: number): boolean {
  if (unit < 0x80) return unit === 0x20 || (unit >= 0x09 && unit <= 0x0d) || (unit >= 0x1c && unit <= 0x1f);
  return (
    unit === 0x85 ||
    unit === 0xa0 ||
    unit === 0x1680 ||
    (unit >= 0x2000 && unit <= 0x200a) ||
    unit === 0x2028 ||
    unit === 0x2029 ||
    unit === 0x202f ||
    unit === 0x205f ||
    unit === 0x3000
  );
}

/** str.split(): the words between runs of whitespace. */
export function split(text: string): string[] {
  const words: string[] = [];
  let start = -1;
  for (let i = 0; i < text.length; i += 1) {
    if (isSpace(text.charCodeAt(i))) {
      if (start >= 0) words.push(text.slice(start, i));
      start = -1;
    } else if (start < 0) start = i;
  }
  if (start >= 0) words.push(text.slice(start));
  return words;
}

/** str.rstrip() */
export function rstrip(text: string): string {
  let end = text.length;
  while (end > 0 && isSpace(text.charCodeAt(end - 1))) end -= 1;
  return text.slice(0, end);
}

/** str.strip() */
export function strip(text: string): string {
  let start = 0;
  while (start < text.length && isSpace(text.charCodeAt(start))) start += 1;
  return rstrip(text.slice(start));
}

/** The index of the first code unit that is not `unit` (str.lstrip(char) is text.slice(of it)). */
export function skip(text: string, from: number, unit: number): number {
  let i = from;
  while (i < text.length && text.charCodeAt(i) === unit) i += 1;
  return i;
}

/** The index after the whitespace that starts at `from`. */
export function skipSpace(text: string, from: number): number {
  let i = from;
  while (i < text.length && isSpace(text.charCodeAt(i))) i += 1;
  return i;
}

function pairAt(text: string, i: number): boolean {
  const unit = text.charCodeAt(i);
  if (unit < 0xd800 || unit > 0xdbff || i + 1 >= text.length) return false;
  const next = text.charCodeAt(i + 1);
  return next >= 0xdc00 && next <= 0xdfff;
}

/** len(): code points (a surrogate pair is one, a lone surrogate one too, as in a string Python decoded from JSON). */
export function length(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i += pairAt(text, i) ? 2 : 1) n += 1;
  return n;
}

/** text[:n] */
export function prefix(text: string, n: number): string {
  let i = 0;
  for (let k = 0; k < n && i < text.length; k += 1) i += pairAt(text, i) ? 2 : 1;
  return text.slice(0, i);
}

/** bool(value) for what JSON can hold: null, false, 0, "", [] and {} are false. */
export function truthy(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}
