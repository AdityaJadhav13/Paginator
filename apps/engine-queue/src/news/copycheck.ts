// The copy check (deterministic, never Claude): a draft sentence is too close to a source when it shares 8 or more
// consecutive words with one source, or when 60 % or more of its 5-word runs appear in one source. Words are runs of
// Unicode letters, combining marks and digits (so a Devanagari word keeps its vowel signs and virama), compared after
// NFC normalisation and lower-casing; sentences end at . ? ! । ॥ or a line break.

const WORD = /[\p{L}\p{M}\p{N}]+/gu;
const SENTENCE = /[^.?!।॥\n]+[.?!।॥]*/gu;
export const RUN = 8;
const GRAM = 5;
const SHARE = 0.6;

export const words = (text: string): string[] => text.normalize("NFC").toLowerCase().match(WORD) ?? [];

export const sentences = (text: string): string[] =>
  (text.match(SENTENCE) ?? []).map((s) => s.trim()).filter((s) => s.length > 0);

function grams(list: readonly string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= list.length; i++) out.push(list.slice(i, i + n).join(" "));
  return out;
}

/** The draft's sentences that are too close to any of the sources, in the draft's order. */
export function copied(draft: string, sources: readonly string[]): string[] {
  const indexed = sources.map((s) => {
    const w = words(s);
    return { runs: new Set(grams(w, RUN)), fives: new Set(grams(w, GRAM)) };
  });
  return sentences(draft).filter((sentence) => {
    const w = words(sentence);
    const runs = grams(w, RUN);
    const fives = grams(w, GRAM);
    return indexed.some(
      (src) =>
        runs.some((r) => src.runs.has(r)) ||
        (fives.length > 0 && fives.filter((f) => src.fives.has(f)).length / fives.length >= SHARE),
    );
  });
}
