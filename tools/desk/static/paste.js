// Pageinator Desk: "Paste several" read as the server reads it (tools/desk/static/paste.js).
//
// The preview must agree with what the server saves (deskserver/store.py parse_bulk): when it keeps the articles the
// server skipped in the box, a disagreement would lose text. So this follows parse_bulk rule for rule:
//   - a line of only three or more "-" (spaces around allowed) separates two articles;
//   - in each, the first non-empty line is the headline; the next NON-EMPTY line is the byline when it starts with
//     "Byline" or "वार्ताहर" and a colon (":" or "："), "-", "–" or "—" may follow; the rest is the body;
//   - a part with nothing in it is skipped. Text is NFC-normalised, as the server stores it.
// tools/desk/test/test_paste.mjs checks it against the cases parse_bulk handles.

const SEPARATOR = /^\s*-{3,}\s*$/;
const BYLINE = /^\s*(?:byline|वार्ताहर)\s*[:：]\s*[-–—]?\s*([\s\S]*)$/i;

/** [{headline, byline, hasBody, text}] for each article in a paste; `text` is the article's own lines, as pasted. */
export function splitPaste(text) {
  const lines = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .normalize("NFC")
    .split("\n");
  const chunks = [[]];
  for (const line of lines) {
    if (SEPARATOR.test(line)) chunks.push([]);
    else chunks[chunks.length - 1].push(line);
  }
  const items = [];
  for (const chunk of chunks) {
    const filled = chunk.map((line, k) => (line.trim() ? k : -1)).filter((k) => k >= 0);
    if (!filled.length) continue;
    let start = filled[0] + 1;
    let byline = "";
    const m = filled.length > 1 ? BYLINE.exec(chunk[filled[1]]) : null;
    if (m) {
      byline = m[1];
      start = filled[1] + 1;
    }
    items.push({
      headline: chunk[filled[0]].trim(),
      byline,
      hasBody: chunk.slice(start).join("\n").trim() !== "",
      text: chunk.join("\n").trim(),
    });
  }
  return items;
}
