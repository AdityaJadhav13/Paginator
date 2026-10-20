// The committed golden vectors are exactly what their generators wrote: every file MANIFEST.json lists is present
// with its size and SHA-256, nothing else sits in the golden directories, every record file holds the number of
// records the generator counted, and the evidence referenced in place is unchanged. (Regenerating them needs the
// frozen oracle on the reference machine: tools/goldens/v1/gen_all.py --check.)
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, collectStrings, readJsonl, readText, repoPath } from "../src/index.ts";

type FileEntry = { sha256: string; bytes: number; generator: string };
type Manifest = {
  files: Record<string, FileEntry>;
  counts: Record<string, Record<string, unknown>>;
  referenced_in_place: Record<string, { sha256?: string; files?: Record<string, string> }>;
};

const manifest = JSON.parse(readText(repoPath("fixtures/goldens/v1/MANIFEST.json"))) as Manifest;
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

function filesUnder(dir: string): string[] {
  return readdirSync(repoPath(dir), { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && d.name !== ".DS_Store")
    .map((d) => relative(REPO_ROOT, join(d.parentPath, d.name)).split("\\").join("/"))
    .sort();
}

describe("golden vectors v1", () => {
  it("has every listed file, byte for byte", () => {
    const wrong = Object.entries(manifest.files)
      .filter(([path, e]) => statSync(repoPath(path)).size !== e.bytes || sha256(repoPath(path)) !== e.sha256)
      .map(([path]) => path);
    expect(wrong).toEqual([]);
    expect(Object.keys(manifest.files).length).toBeGreaterThan(50);
  });

  it("has nothing in the golden directories that no generator wrote", () => {
    const allowed = new Set([
      ...Object.keys(manifest.files),
      "fixtures/goldens/v1/MANIFEST.json",
      "fixtures/goldens/v1/CHANGELOG.md",
    ]);
    const stray = [...filesUnder("fixtures/goldens/v1"), ...filesUnder("fixtures/fonts/v1")].filter(
      (f) => !allowed.has(f),
    );
    expect(stray).toEqual([]);
  });

  it("holds as many records as the generators counted", () => {
    const records = (path: string) => readJsonl(repoPath(path)).length;
    const c = manifest.counts;
    expect(records("fixtures/goldens/v1/pyshim/vectors.jsonl.gz")).toBe(c["pyshim"]?.["records"]);
    expect(records("fixtures/goldens/v1/fonts/registry.jsonl.gz")).toBe(c["fonts"]?.["records"]);
    expect(records("fixtures/goldens/v1/compose/compose.jsonl.gz")).toBe(c["compose"]?.["compositions"]);
    expect(records("fixtures/goldens/v1/compose/prepare.jsonl.gz")).toBe(c["compose"]?.["prepared"]);
    expect(records("fixtures/goldens/v1/headline/compose.jsonl.gz")).toBe(c["headline"]?.["records"]);
    expect(records("fixtures/goldens/v1/rline/lines.jsonl.gz")).toBe(c["rline"]?.["lines"]);
    expect(records("fixtures/goldens/v1/pdf/vectors.jsonl.gz")).toBe(c["pdf"]?.["vectors"]);
    expect(records("fixtures/goldens/v1/pdf/micro.jsonl.gz")).toBe(c["pdf"]?.["micro_files"]);
    const liang = c["liang"] ?? {};
    expect(records("fixtures/goldens/v1/liang/breaks.jsonl.gz")).toBe(
      Number(liang["words_en"]) + Number(liang["words_mr"]),
    );
  });

  it("agrees with the fixtures and the press test it was made from", () => {
    type FontRecord = { uses: string[]; expected: { font_id: string; instance_sha256: string } };
    const fonts = readJsonl(repoPath("fixtures/goldens/v1/fonts/registry.jsonl.gz")) as FontRecord[];
    const fixtureIds = new Set(
      fonts.filter((f) => f.uses.includes("fixtures/typeset/v1")).map((f) => f.expected.font_id),
    );
    const behavior = repoPath("fixtures/typeset/v1/behavior");
    const used = new Set(
      readdirSync(behavior)
        .filter((n) => n.endsWith(".jsonl"))
        .flatMap((n) => readJsonl(join(behavior, n)))
        .flatMap((r) => collectStrings(r, (key) => key === "font_id")),
    );
    expect([...used].filter((id) => !fixtureIds.has(id))).toEqual([]);
    expect(used.size).toBe(5);
    type Press = { fonts: Record<string, { face_sha256: string }> };
    const press = JSON.parse(
      readText(repoPath("fixtures/goldens/v1/press/pageinator_press_test_synthetic.manifest.json")),
    ) as Press;
    for (const [key, f] of Object.entries(press.fonts)) {
      const record = fonts.find((r) => r.uses.includes(`press:${key}`));
      expect(record?.expected.instance_sha256, key).toBe(f.face_sha256);
    }
  });

  it("refers to unchanged evidence", () => {
    const changed: string[] = [];
    for (const [path, ref] of Object.entries(manifest.referenced_in_place)) {
      if (ref.sha256 && sha256(repoPath(path)) !== ref.sha256) changed.push(path);
      for (const [file, digest] of Object.entries(ref.files ?? {}))
        if (sha256(repoPath(file)) !== digest) changed.push(file);
    }
    expect(changed).toEqual([]);
  });
});
