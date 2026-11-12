// The port against the Desk's own functions: every vector of test/vectors/desk-text.jsonl, which
// test/vectors/generate.py makes by running them in the oracle venv. If the Desk's code they come from has changed,
// the first test says what to make again.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BODY_LIMIT,
  BRIEF_WORDS,
  DeskTextError,
  LINE_LIMIT,
  TEXT_FIELDS,
  blocks,
  bodyWords,
  cleanText,
  isBrief,
  parseBulk,
  pasteArticles,
} from "../src/index.ts";
import { SENTENCE_END } from "../src/body.ts";
import { nfc, unassigned14 } from "../src/nfc.ts";
import { bylineOf, isSeparator } from "../src/paste.ts";
import { isSpace } from "../src/python.ts";

type Vector = Record<string, unknown> & { fn: string; why?: string };
const REPO = new URL("../../../", import.meta.url);
const vectors = readFileSync(new URL("vectors/desk-text.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter((line) => line !== "")
  .map((line) => JSON.parse(line) as Vector);
const of = (fn: string) => vectors.filter((vector) => vector.fn === fn);
const one = (fn: string) => {
  const [vector] = of(fn);
  if (!vector) throw new Error(`the vectors have no ${fn}`);
  return vector;
};

/** An input as written: a long one as {"concat": [text | [unit, times], …]}. */
function input(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(input);
  if (value !== null && typeof value === "object") {
    const parts = (value as { concat?: unknown }).concat;
    if (Array.isArray(parts))
      return parts.map((p) => (typeof p === "string" ? p : String(p[0]).repeat(Number(p[1])))).join("");
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, input(v)]));
  }
  return value;
}

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** What the port gave, with each string that the vector holds as {sha256, chars} put the same way. */
function shaped(actual: unknown, expected: unknown): unknown {
  if (typeof actual === "string" && expected !== null && typeof expected === "object" && "sha256" in expected) {
    return { sha256: sha256(actual), chars: [...actual].length };
  }
  if (Array.isArray(actual) && Array.isArray(expected)) return actual.map((a, k) => shaped(a, expected[k]));
  if (actual !== null && typeof actual === "object" && expected !== null && typeof expected === "object") {
    return Object.fromEntries(
      Object.entries(actual).map(([k, v]) => [k, shaped(v, (expected as Record<string, unknown>)[k])]),
    );
  }
  return actual;
}

/** {output} or {error: {status, message}}, as the vectors hold an outcome. */
function outcome(fn: () => unknown): Record<string, unknown> {
  try {
    return { output: fn() };
  } catch (error) {
    if (!(error instanceof DeskTextError)) throw error;
    return { error: { status: error.status, message: error.message } };
  }
}

function expectOutcome(vector: Vector, fn: () => unknown) {
  const want = "error" in vector ? { error: vector["error"] } : { output: vector["output"] };
  expect(shaped(outcome(fn), want), vector.why).toEqual(want);
}

/** The generator's block(): a definition and every line after it that is blank or indented deeper. */
function block(lines: string[], name: string): string {
  const parts = name.split(".");
  const inner = parts.pop() ?? "";
  let start = 0;
  let indent = "";
  for (const cls of parts) {
    start = lines.findIndex((line, i) => i >= start && new RegExp(`^${indent}class ${cls}\\b`).test(line));
    indent += "    ";
  }
  const escaped = inner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const head = new RegExp(`^${indent}(?:def ${escaped}\\(|${escaped} *[:=])`);
  const begin = lines.findIndex((line, i) => i >= start && head.test(line));
  const blank = (line: string) => /^[ \t]*$/.test(line);
  const depth = (line: string) => line.length - line.replace(/^ +/, "").length;
  let end = begin + 1;
  while (end < lines.length && (blank(lines[end] ?? "") || depth(lines[end] ?? "") > indent.length)) end += 1;
  while (blank(lines[end - 1] ?? "")) end -= 1;
  return lines.slice(begin, end).join("\n");
}

describe("the vectors", () => {
  const about = one("about");

  it("come from the Desk's code as it is now", () => {
    expect(about["format"]).toBe("pageinator.desk-text.vectors/1");
    expect(about["unicode"]).toBe("14.0.0");
    const changed = (about["sources"] as { file: string; name: string; sha256: string }[]).filter(
      ({ file, name, sha256: digest }) => {
        const lines = readFileSync(new URL(file, REPO), "utf8").split("\n");
        return sha256(block(lines, name)) !== digest;
      },
    );
    // if this fails: the Desk's text code changed. Port the change, then make the vectors again (generate.py)
    expect(changed.map(({ file, name }) => `${file}: ${name}`)).toEqual([]);
  });

  it("hold every kind of vector", () => {
    for (const fn of ["characters", "nfc", "blocks", "is_brief", "clean_text", "parse_bulk", "paste"]) {
      expect(of(fn).length, fn).toBeGreaterThan(0);
    }
    expect(vectors.length).toBe(195);
  });

  it("give the Desk's constants", () => {
    const constants = about["constants"] as Record<string, unknown>;
    expect(BRIEF_WORDS).toBe(constants["BRIEF_WORDS"]);
    expect(BRIEF_WORDS).toBe(constants["server_BRIEF_WORDS"]);
    expect(LINE_LIMIT).toBe(constants["LINE_LIMIT"]);
    expect(BODY_LIMIT).toBe(constants["BODY_LIMIT"]);
    expect(TEXT_FIELDS.map((f) => [f.key, f.label, f.limit])).toEqual(constants["TEXT_FIELDS"]);
  });
});

describe("Python's characters, on every code point", () => {
  const chars = one("characters");
  const every = (test: (ch: string) => boolean) => {
    const found: number[] = [];
    for (let c = 0; c < 0x110000; c += 1) {
      if (c >= 0xd800 && c < 0xe000) continue;
      if (test(String.fromCodePoint(c))) found.push(c);
    }
    return found;
  };

  it("whitespace is str.isspace's", () => {
    expect(every((ch) => ch.length === 1 && isSpace(ch.charCodeAt(0)))).toEqual(chars["isspace"]);
  });

  // about twenty passes over every code point: seconds alone, more on a busy machine (as NFC's below)
  it("the separator and the byline marker match what the Desk's expressions match", { timeout: 120_000 }, () => {
    const byline = (ch: string) => bylineOf(ch) !== null;
    expect(every((ch) => isSeparator(`${ch}---${ch}`))).toEqual(chars["separator_space"]);
    expect(every((ch) => byline(`${ch}byline:x`))).toEqual(chars["byline_space_before"]);
    expect(every((ch) => byline(`byline${ch}:x`))).toEqual(chars["byline_space_after"]);
    expect(every((ch) => byline(`byline${ch}x`))).toEqual(chars["byline_colon"]);
    expect(every((ch) => bylineOf(`byline:${ch}x`) === "x")).toEqual(chars["byline_dash_or_space"]);
    expect(every((ch) => !byline(`byline:x${ch}`))).toEqual(chars["byline_rest_refused"]);
    const word = "byline";
    const letters = [...word].map((_, k) => every((ch) => byline(`${word.slice(0, k)}${ch}${word.slice(k + 1)}:x`)));
    expect(letters).toEqual(chars["byline_letters"]);
    const marathi = "वार्ताहर";
    const marks = [...marathi].map((_, k) =>
      every((ch) => byline(`${marathi.slice(0, k)}${ch}${marathi.slice(k + 1)}:x`)),
    );
    expect(marks).toEqual(chars["byline_marathi"]);
    expect(SENTENCE_END).toBe(chars["sentence_end"]);
  });

  it("NFC is Python's (Unicode 14) on every code point", { timeout: 120_000 }, () => {
    const vector = one("nfc");
    const size = vector["block"] as number;
    const [base, low, high] = vector["probes"] as [string, string, string];
    const hashes: string[] = [];
    for (let start = 0; start < 0x110000; start += size) {
      const hash = createHash("sha256");
      for (let c = start; c < start + size; c += 1) {
        if (c >= 0xd800 && c < 0xe000) continue;
        const ch = String.fromCodePoint(c);
        // the port has no NFD; for a code point Unicode 14 does not know, Python's NFD leaves it as it is
        const nfd = unassigned14(c) ? ch : ch.normalize("NFD");
        hash.update(`${[nfc(ch), nfd, nfc(base + ch + low), nfc(base + high + ch)].join("\0")}\x01`, "utf8");
      }
      hashes.push(hash.digest("hex").slice(0, 16));
    }
    const differ = hashes.flatMap((h, k) => (h === (vector["hashes"] as string[])[k] ? [] : [(k * size).toString(16)]));
    expect(differ, "blocks (first code point, hex) where the port's NFC is not Python's").toEqual([]);
  });
});

describe("the port gives what the Desk gives", () => {
  it.each(of("blocks").map((v) => [v.why, v] as const))("blocks and body words: %s", (_, vector) => {
    const body = input(vector["input"]) as string | null;
    const want = { blocks: vector["blocks"], words: vector["words"] };
    const got = { blocks: blocks(body).map((b) => [b.kind, b.text]), words: bodyWords(body) };
    expect(shaped(got, want)).toEqual(want);
  });

  it.each(of("is_brief").map((v) => [v.why, v] as const))("short item: %s", (_, vector) => {
    expect(isBrief(input(vector["input"]) as { body?: string | null; photo?: unknown })).toBe(vector["output"]);
  });

  it.each(of("clean_text").map((v) => [v.why, v] as const))("clean_text: %s", (_, vector) => {
    const [value, field, limit] = input(vector["input"]) as [unknown, string, number];
    expectOutcome(vector, () => cleanText(value, field, limit));
  });

  it.each(of("parse_bulk").map((v) => [v.why, v] as const))("parse_bulk: %s", (_, vector) => {
    expectOutcome(vector, () => parseBulk(input(vector["input"])));
  });

  it.each(of("paste").map((v) => [v.why, v] as const))("paste: %s", (_, vector) => {
    expectOutcome(vector, () => {
      const { created, skipped } = pasteArticles(input(vector["input"]));
      const counted = created.map((a) => ({
        ...a,
        words: bodyWords(a.body),
        is_brief: isBrief({ ...a, photo: null }),
      }));
      return { created: counted, skipped };
    });
  });
});

describe("where the port differs from the Desk, on purpose", () => {
  it("refuses a number, which the Desk would write with Python's str()", () => {
    expect(() => cleanText(12, "headline", LINE_LIMIT)).toThrow(new DeskTextError("The headline must be text."));
    expect(() => cleanText(1.5, "headline", LINE_LIMIT)).toThrow(DeskTextError);
  });

  it("parses and cleans a lone surrogate as Python would, though the Desk cannot save it", () => {
    expect(pasteArticles("Head\ud800\nbody\udc00").created).toEqual([
      { headline: "Head\ud800", byline: "", body: "body\udc00" },
    ]);
  });
});
