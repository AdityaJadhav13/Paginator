// Pageinator Desk — the main screen's words (static/strings.js), in English and Marathi. Node's own test runner, no
// other tools: node --test tools/desk/test/test_strings.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GLOSSARY_KEYS, LANGS, REVIEW, SAME_KEYS, STRINGS, lang, setLang, t, tIn, tn } from "../static/strings.js";

const STATIC = join(import.meta.dirname, "..", "static");
const APP = readFileSync(join(STATIC, "app.js"), "utf8");
const HTML = readFileSync(join(STATIC, "index.html"), "utf8");
const EDITOR = readFileSync(join(STATIC, "editor.js"), "utf8");
const EDITOR_HTML = readFileSync(join(STATIC, "editor.html"), "utf8");
const EDITOR_VIEW = readFileSync(join(STATIC, "editor-view.js"), "utf8");
const KEYS = Object.keys(STRINGS.en);
const PLACEHOLDER = /\{(\w+)\}/g;
const DEVANAGARI = /\p{Script=Devanagari}/u;
const DEVANAGARI_DIGIT = /[०-९]/u;

const isPlural = (v) => v !== null && typeof v === "object";
const forms = (v) => (isPlural(v) ? Object.entries(v) : [["", v]]);
const placeholders = (text) => [...text.matchAll(PLACEHOLDER)].map((m) => m[1]).sort();

test("English and Marathi have the same keys, and the same kind of entry for each", () => {
  assert.deepEqual(LANGS, ["en", "mr"]);
  assert.deepEqual(Object.keys(STRINGS.mr), KEYS);
  for (const key of KEYS) {
    const en = STRINGS.en[key];
    const mr = STRINGS.mr[key];
    assert.equal(isPlural(en), isPlural(mr), `${key}: plural in one language only`);
    if (isPlural(en)) {
      assert.deepEqual(Object.keys(en).sort(), ["one", "other"], `${key}: English forms`);
      assert.deepEqual(Object.keys(mr).sort(), ["one", "other"], `${key}: Marathi forms`);
    }
  }
});

test("no value is empty", () => {
  for (const language of LANGS) {
    for (const key of KEYS) {
      for (const [form, text] of forms(STRINGS[language][key])) {
        assert.equal(typeof text, "string", `${language} ${key} ${form}`);
        assert.ok(text.trim() !== "", `${language} ${key} ${form} is empty`);
      }
    }
  }
});

test("each placeholder of a language is in the other one, form by form", () => {
  for (const key of KEYS) {
    const mr = new Map(forms(STRINGS.mr[key]));
    for (const [form, en] of forms(STRINGS.en[key])) {
      assert.deepEqual(placeholders(mr.get(form)), placeholders(en), `${key} ${form}: ${en} | ${mr.get(form)}`);
    }
  }
});

test("Marathi is in Devanagari with Latin digits; English has no Devanagari", () => {
  for (const key of KEYS) {
    for (const [form, text] of forms(STRINGS.mr[key])) {
      assert.ok(!DEVANAGARI_DIGIT.test(text), `mr ${key} ${form}: interface digits are Latin`);
      // words of its own (not only placeholders, as "{word}" where the folio's Marathi word is given) are Marathi
      const words = text.replace(PLACEHOLDER, "");
      if (!SAME_KEYS.includes(key) && /\p{L}/u.test(words))
        assert.ok(DEVANAGARI.test(words), `mr ${key} ${form} is not in Marathi: ${text}`);
    }
    for (const [form, text] of forms(STRINGS.en[key])) {
      if (key !== "lang.mr") assert.ok(!DEVANAGARI.test(text), `en ${key} ${form} has Devanagari: ${text}`);
    }
  }
});

test("every key is on the REVIEW list unless it is marked glossary-only or the same in both languages", () => {
  const marked = new Set([...GLOSSARY_KEYS, ...SAME_KEYS]);
  assert.equal(marked.size, GLOSSARY_KEYS.length + SAME_KEYS.length, "a key has two marks");
  assert.deepEqual([...REVIEW, ...marked].sort(), [...KEYS].sort());
  for (const key of REVIEW) assert.ok(!marked.has(key), key);
  for (const key of SAME_KEYS) assert.deepEqual(STRINGS.mr[key], STRINGS.en[key], `${key} is marked the same`);
});

// keys appear in app.js only as whole string literals ("ns.name"), never built at run time, so they can be checked
const NAMESPACES = [...new Set(KEYS.map((k) => k.split(".")[0]))];
const KEY_LITERAL = new RegExp(`["'\`]((?:${NAMESPACES.join("|")})\\.[A-Za-z0-9_.]+)["'\`]`, "g");
const keysIn = (code) => new Set([...code.matchAll(KEY_LITERAL)].map((m) => m[1]));
const keysInHtml = (html) => new Set([...html.matchAll(/\bdata-(?:t(?:-[a-z-]+)?|help)="([^"]+)"/g)].map((m) => m[1]));
const usedInApp = new Set([...keysIn(APP), ...keysIn(EDITOR)]);
const usedInHtml = new Set([...keysInHtml(HTML), ...keysInHtml(EDITOR_HTML)]);

test("every key the main screen and the page editor use is in the catalogue", () => {
  for (const [name, code, least] of [
    ["app.js", APP, 300],
    ["editor.js", EDITOR, 200],
  ]) {
    const used = keysIn(code);
    assert.ok(used.size > least, `only ${used.size} keys found in ${name}`);
    for (const key of used) assert.ok(KEYS.includes(key), `${name} uses ${key}, which is not in strings.js`);
    assert.ok(!/\btn?\(\s*`/.test(code), `${name}: a key built at run time (t(\`…\`)) cannot be checked`);
  }
  for (const [name, html, least] of [
    ["index.html", HTML, 50],
    ["editor.html", EDITOR_HTML, 50],
  ]) {
    const used = keysInHtml(html);
    assert.ok(used.size > least, `only ${used.size} keys found in ${name}`);
    for (const key of used) assert.ok(KEYS.includes(key), `${name} uses ${key}, which is not in strings.js`);
  }
});

// A string literal that reads as English words (a sentence, or a phrase of three words or more): every word the
// screens show comes from strings.js. Class lists, selectors and canvas fonts are not caught (no capital, no
// sentence, hyphens or punctuation).
const SENTENCE = /^[A-Z][a-z]+ [a-z]+|^[A-Za-z']+( [A-Za-z']+){2,}$|[A-Za-z]{2,} [A-Za-z]{2,}[.…?!:]$/;
function englishLiterals(code) {
  const lines = code
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)) // comment lines
    .map((l) => l.replace(/\s\/\/ .*$/, "")); // a comment after code
  const out = [];
  for (const m of lines.join("\n").matchAll(/"([^"\\\n]*)"|`([^`\\]*)`/g)) {
    const text = (m[1] ?? m[2]).replace(/\$\{[^}]*\}/g, " ").trim();
    if (SENTENCE.test(text)) out.push(text);
  }
  return out;
}

test("no English words are written into the screens' code (they come from strings.js)", () => {
  for (const [name, code] of [
    ["app.js", APP],
    ["editor.js", EDITOR],
    ["editor-view.js", EDITOR_VIEW],
  ])
    assert.deepEqual(englishLiterals(code), [], name);
  // the check catches what it is for
  assert.deepEqual(englishLiterals('notice("The page is saved.");\nh("span", {}, "no photo here");'), [
    "The page is saved.",
    "no photo here",
  ]);
});

test("no English text in the screens' HTML outside strings.js (the page title and the noscript note aside)", () => {
  for (const [name, html] of [
    ["index.html", HTML],
    ["editor.html", EDITOR_HTML],
  ]) {
    const text = html
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(title|noscript|script|style|pre)\b[\s\S]*?<\/\1>/g, "")
      .replace(/<[^>]+>/g, "\n");
    const words = text.split("\n").filter((line) => /[A-Za-z]{2,}/.test(line));
    assert.deepEqual(words, [], name);
    // attributes a person reads are keys (data-t-…), never text
    assert.deepEqual([...html.matchAll(/\s(title|aria-label|placeholder|alt)="[^"]*[A-Za-z]{2,}[^"]*"/g)], [], name);
  }
});

test("every key in the catalogue is used", () => {
  for (const key of KEYS) assert.ok(usedInApp.has(key) || usedInHtml.has(key), `${key} is not used`);
});

test("t(): placeholders, plural forms, Latin digits with Indian grouping, fall-backs", () => {
  setLang("en");
  assert.equal(lang(), "en");
  assert.equal(t("count.article", { n: 1 }), "1 article");
  assert.equal(t("count.article", { n: 0 }), "0 articles");
  assert.equal(t("count.word", { n: 12900 }), "12,900 words");
  assert.equal(t("arts.warnings", { n: 1 }), "Warning");
  assert.equal(t("page.named", { n: 3, role: t("role.inside") }), "Page 3 · Inside");
  setLang("mr");
  assert.equal(t("count.article", { n: 1 }), "1 बातमी");
  assert.equal(t("count.article", { n: 2 }), "2 बातम्या");
  assert.equal(t("count.word", { n: 123456 }), "1,23,456 शब्द");
  assert.equal(t("sum.adsFilled", { n: 1, total: 3 }), "3 पैकी 1 भरली");
  assert.equal(t("date.full", { wd: t("date.wed"), d: "21", mon: t("date.oct"), y: "2026" }), "बुध 21 ऑक्टो 2026");
  assert.equal(tIn("en", "state.done"), "Done");
  assert.equal(t("no.such.key"), "no.such.key");
  assert.equal(t("page.n"), "पान {n}"); // a missing value stays visible
  const code = { tag: "code" };
  assert.deepEqual(tn("paste.help1", { code }), ["दोन बातम्यांच्या मध्ये फक्त ", code, " असलेली ओळ ठेवा."]);
  setLang("xx");
  assert.equal(lang(), "en");
});

test("the engine status says it is checking from the first paint, before /api/status answers", () => {
  // the label is filled from strings.js at once (applyLang), and drawn again before the first request
  assert.match(HTML, /<span class="engine-label" id="engine-label" data-t="engine.checking"><\/span>/);
  const init = APP.slice(APP.indexOf("function init()"));
  assert.ok(init.indexOf("renderStatus()") > 0 && init.indexOf("renderStatus()") < init.indexOf("refreshStatus()"));
});
