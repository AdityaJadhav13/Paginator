// The story bundle without a database (src/modules/stories/desk-bundle.ts; tools/desk/CONTRACT.md §6):
//   - a story's body as desk-text/1: the engine's own blocks, joined by exactly "\n\n", and the JS port of the Desk's
//     check (deskserver/bundle.py desk_text, with Python's whitespace); test/db/desk-bundle.test.ts checks the same
//     bodies against the Desk's own function;
//   - writeZip: a photo whose bytes are not its SHA-256 cuts the ZIP off before its end of central directory, and a
//     slow reader leaves no listeners behind.
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { ShaMismatch, deskText, isDeskText, writeZip } from "../../src/modules/stories/desk-bundle.ts";

describe("deskText", () => {
  it.each([
    ["two paragraphs", "One.\n\nTwo.", "One.\n\nTwo."],
    ["lines broken at the margin", "A line\nthat goes on.\n\nNext.", "A line that goes on.\n\nNext."],
    ["Windows line ends and spaces", "  One.\r\n\r\n  Two.  \r\n", "One.\n\nTwo."],
    ["a subheading", "One.\n##   Heading here\nTwo.", "One.\n\n## Heading here\n\nTwo."],
    ["several hashes", "### Heading", "## Heading"],
    ["an empty subheading, dropped", "One.\n\n##\n\nTwo.", "One.\n\nTwo."],
    ["one paragraph a line (most lines end a sentence)", "One.\nTwo.\nThree.", "One.\n\nTwo.\n\nThree."],
    ["three empty lines", "One.\n\n\n\nTwo.", "One.\n\nTwo."],
    ["a byte-order mark before a subheading (not a space to Python)", "\ufeff## x", "\ufeff## x"],
    ["nothing", "", ""],
  ])("makes %s desk-text/1", (_name, body, expected) => {
    expect(deskText(body)).toEqual({ text: expected, hashed: [] });
    expect(isDeskText(deskText(body).text)).toBe(true);
  });

  it("returns a subheading that starts with # for the caller to refuse, and never drops its #", () => {
    const { text, hashed } = deskText("Rally.\n\n## #MeToo rally\n\nMore.");
    expect(hashed).toEqual(["#MeToo rally"]);
    expect(text).toContain("## #MeToo rally");
    expect(isDeskText(text)).toBe(false);
  });
});

describe("isDeskText, the JS port of the Desk's desk_text", () => {
  it("refuses what is not desk-text/1", () => {
    for (const bad of [
      "One.\nTwo.",
      "One.\n\n\nTwo.",
      "One.\r\n\r\nTwo.",
      "##Heading",
      "## #Heading",
      "  ",
      "\n\nOne.",
    ]) {
      expect(isDeskText(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("uses Python's whitespace: U+FEFF is text, U+001C and U+00A0 are spaces (as the Desk decides each)", () => {
    expect(isDeskText("## \ufeffx")).toBe(true); // [^\s#] takes U+FEFF in Python
    expect(isDeskText("\ufeff")).toBe(true); // strip() keeps it: the block is not empty
    expect(isDeskText("## \u001cx")).toBe(false);
    expect(isDeskText("\u00a0## x")).toBe(false); // lstrip() removes it, so a subheading, but not "## " exactly
    expect(isDeskText("\u00a0##x")).toBe(false);
  });
});

/** A store whose read gives these chunks, whatever is asked. */
const storeOf = (chunks: Uint8Array[]) => ({
  read: async () =>
    (async function* () {
      for (const chunk of chunks) yield chunk;
    })(),
});

async function run(out: PassThrough, chunks: Uint8Array[], sha256: string, readSlowly = false) {
  const got: Buffer[] = [];
  out.on("data", (chunk: Buffer) => {
    got.push(chunk);
    if (readSlowly) {
      out.pause();
      setTimeout(() => out.resume(), 1);
    }
  });
  const original = { name: `photos/${sha256}.png`, sha256, bytes: 0, key: "k", version: "v" };
  const json = new TextEncoder().encode('{"format":"pageinator.story-bundle/2"}');
  let error: unknown = null;
  await writeZip(out, json, [original], storeOf(chunks), new Date("2026-11-30T06:00:00+05:30")).catch((e) => {
    error = e;
  });
  await new Promise((resolve) => setImmediate(resolve));
  return { bytes: Buffer.concat(got), error };
}

describe("writeZip", () => {
  it("throws the SHA mismatch for a photo with other bytes, and never writes the end of central directory", async () => {
    const { bytes, error } = await run(new PassThrough(), [new Uint8Array([1, 2, 3])], "0".repeat(64));
    expect(error).toBeInstanceOf(ShaMismatch);
    expect(bytes.includes(Buffer.from("PK\x05\x06", "latin1"))).toBe(false); // no end of central directory
    expect(bytes.includes(Buffer.from("PK\x03\x04", "latin1"))).toBe(true); // what was sent before the photo
  });

  it("leaves no drain or close listeners behind while a slow reader keeps it waiting", async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(7);
    const chunks = Array.from({ length: 40 }, () => chunk);
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256");
    for (const c of chunks) hash.update(c);
    const warnings: string[] = [];
    const onWarning = (warning: Error) => warnings.push(warning.name);
    process.on("warning", onWarning);
    const out = new PassThrough();
    const { error } = await run(out, chunks, hash.digest("hex"), true);
    process.off("warning", onWarning);
    expect(error).toBeNull();
    expect([out.listenerCount("drain"), warnings.filter((w) => w === "MaxListenersExceededWarning")]).toEqual([0, []]);
    expect(out.listenerCount("close")).toBeLessThanOrEqual(1);
  });
});
