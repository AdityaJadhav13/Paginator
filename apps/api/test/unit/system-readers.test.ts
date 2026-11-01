// The system readers (docs/product/10-l2-newsroom-plan.md §3.2): a flag that opens a table across organisations is set
// by withSystem alone (src/db/tenant.ts), and each flag is used in exactly one place, so a new cross-tenant reader is a
// deliberate change here.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const API = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATIONS = join("src", "db", "migrations");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (relative(API, path) === MIGRATIONS) return [];
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

const files = [...sources(join(API, "src")), ...sources(join(API, "scripts"))].map((path) => ({
  where: relative(API, path),
  text: readFileSync(path, "utf8"),
}));

describe("system readers", () => {
  it("set app.system only in withSystem", () => {
    expect(files.filter((f) => /app\.system/.test(f.text)).map((f) => f.where)).toEqual([
      join("src", "db", "tenant.ts"),
    ]);
  });

  it("use each flag in exactly one place", () => {
    const uses = files.flatMap((f) =>
      [...f.text.matchAll(/withSystem\(\s*"([a-z-]+)"/g)].map((m) => `${m[1]} ${f.where}`),
    );
    const inbox = join("src", "modules", "media", "engine-inbox.ts");
    // the consumer reads the inbox's waiting rows; the sweep reads and removes the queue's spent jobs
    expect(uses).toEqual([`engine-consumer ${inbox}`, `engine-sweep ${inbox}`]);
  });
});
