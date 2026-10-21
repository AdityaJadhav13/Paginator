// Writes src/db/schema.gen.ts from a migrated database (docs/product/10-l2-newsroom-plan.md §3.6); with --check, it
// writes nothing and fails when the file differs. Settings: as db:migrate's.
import { readFile, writeFile } from "node:fs/promises";
import { ConfigError, loadMigratorConfig } from "../src/config.ts";
import { SCHEMA_FILE, generate } from "../src/db/codegen.ts";

const check = process.argv.includes("--check");
try {
  const text = await generate(loadMigratorConfig(process.env));
  const current = await readFile(SCHEMA_FILE, "utf8").catch(() => "");
  if (text === current) {
    console.log("src/db/schema.gen.ts matches the database.");
  } else if (check) {
    console.error(
      "src/db/schema.gen.ts differs from the migrated database: run `pnpm --filter @pageinator/api db:codegen`.",
    );
    process.exitCode = 1;
  } else {
    await writeFile(SCHEMA_FILE, text);
    console.log("Wrote src/db/schema.gen.ts.");
  }
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(error.message);
  process.exitCode = 1;
}
