// Pageinator Desk — "Paste several": the preview (static/paste.js) reads a paste as the server saves it
// (deskserver/store.py parse_bulk). Each expected result below is what parse_bulk returns for the same text.
// node --test tools/desk/test/test_paste.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitPaste } from "../static/paste.js";

// [paste, parse_bulk's articles as {headline, byline, hasBody}] (hasBody: its body is not blank)
const CASES = [
  [
    "मथळा एक\nमजकूर.\n---\nमथळा दोन\nमजकूर.",
    [
      ["मथळा एक", "", true],
      ["मथळा दोन", "", true],
    ],
  ],
  [
    "मथळा एक\nमजकूर.\n-----\nमथळा दोन\nमजकूर.",
    [
      ["मथळा एक", "", true],
      ["मथळा दोन", "", true],
    ],
  ],
  [
    "मथळा एक\n  ----  \nमथळा दोन",
    [
      ["मथळा एक", "", false],
      ["मथळा दोन", "", false],
    ],
  ],
  ["मथळा\n\nByline: प्रतिनिधी\nमजकूर.", [["मथळा", "प्रतिनिधी", true]]],
  ["मथळा\nवार्ताहर：प्रतिनिधी\nमजकूर.", [["मथळा", "प्रतिनिधी", true]]],
  ["मथळा\nवार्ताहर :- प्रतिनिधी, काल्पनिकनगर\nमजकूर.", [["मथळा", "प्रतिनिधी, काल्पनिकनगर", true]]],
  ["मथळा\nBYLINE: Staff\n", [["मथळा", "Staff", false]]],
  ["मथळा\nमजकूर.\nByline: नंतर", [["मथळा", "", true]]],
  ["\n\n---\n   \n---\nफक्त मथळा\n---\n", [["फक्त मथळा", "", false]]],
  ["मथळा\r\nमजकूर.\r\n--\r\nअजून मजकूर.", [["मथळा", "", true]]],
];

test("the preview finds the articles, headlines and bylines parse_bulk finds", () => {
  for (const [text, want] of CASES) {
    const got = splitPaste(text).map((x) => [x.headline, x.byline, x.hasBody]);
    assert.deepEqual(got, want, JSON.stringify(text));
  }
});

test("an article's own text is kept whole, so a skipped one can go back into the box", () => {
  const items = splitPaste("मथळा एक\n\nByline: प्रतिनिधी\nमजकूर.\n-----\nमथळा दोन\nदुसरा मजकूर.");
  assert.deepEqual(
    items.map((x) => x.text),
    ["मथळा एक\n\nByline: प्रतिनिधी\nमजकूर.", "मथळा दोन\nदुसरा मजकूर."],
  );
  assert.equal(splitPaste(items.map((x) => x.text).join("\n---\n")).length, 2);
});
