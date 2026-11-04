// The one-time import of the owner's Desk data (docs/product/10-l2-newsroom-plan.md §3.8), on the server:
//   pnpm --filter @pageinator/api import-desk -- --org <id> --pub <id> \
//     --bundle <orgs/<org>/imports/….zip in the work bucket | s3://<work bucket>/orgs/<org>/imports/….zip | a local file> \
//     [--actor <user id>] [--dry-run] [--all-runs] [--include-samples]
// The bundle is tools/desk/export-home.sh's desk-home.zip. The import runs as --actor (by default the organisation's
// Owner), recorded in the audit log with actor kind "import"; src/db/desk-import.ts does the work. It prints the counts
// per kind and, for every file it stored, the SHA-256 read back from the store against the manifest's (exit code 1 if
// one differs). A dry run prints the counts and writes nothing.
import { createReadStream } from "node:fs";
import { parseArgs } from "node:util";
import { ConfigError, loadConfig } from "../src/config.ts";
import { ImportRefused, KINDS, importDesk } from "../src/db/desk-import.ts";
import { openDatabase } from "../src/db/pools.ts";
import { s3Store } from "../src/storage/s3.ts";

const { values } = parseArgs({
  options: {
    org: { type: "string" },
    pub: { type: "string" },
    bundle: { type: "string" },
    actor: { type: "string" },
    "dry-run": { type: "boolean" },
    "all-runs": { type: "boolean" },
    "include-samples": { type: "boolean" },
  },
  strict: true,
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const { org, pub, bundle, actor } = values;
if (!org || !pub || !bundle || !UUID.test(org) || !UUID.test(pub) || (actor !== undefined && !UUID.test(actor))) {
  console.error("Usage: import-desk --org <id> --pub <id> --bundle <key or file> [--actor <user id>] [--dry-run] …");
  process.exit(2);
}

try {
  const config = loadConfig(process.env);
  if (!config.storage) throw new ConfigError("The import needs the object store (PGN_S3_…).");
  const store = s3Store(config.storage);
  const database = openDatabase(config.database);
  try {
    const prefix = `s3://${config.storage.workBucket}/`;
    const key = bundle.startsWith(prefix) ? bundle.slice(prefix.length) : bundle.startsWith("orgs/") ? bundle : null;
    let source: AsyncIterable<Uint8Array>;
    if (key !== null) {
      // only this organisation's imports folder: never another key of the bucket
      if (!key.startsWith(`orgs/${org}/imports/`) || key.includes(".."))
        throw new ImportRefused(`The bundle must be under orgs/${org}/imports/ in the work bucket.`);
      const head = await store.head(key);
      if (!head?.versionId) throw new ImportRefused(`No bundle at ${key}.`);
      source = await store.read(key, head.versionId);
    } else source = createReadStream(bundle);
    const owner = (await database.identity.members(org)).find((member) => member.role.split(",").includes("owner"));
    const actorId = actor ?? owner?.userId;
    if (!actorId) throw new ImportRefused("The organisation has no Owner: name the person with --actor.");

    const report = await importDesk({
      database,
      store,
      orgId: org,
      pubId: pub,
      actorId,
      source,
      dryRun: values["dry-run"] ?? false,
      allRuns: values["all-runs"] ?? false,
      includeSamples: values["include-samples"] ?? false,
    });
    console.log(`Bundle SHA-256 ${report.bundleSha256}${report.dryRun ? " (dry run: nothing was written)" : ""}`);
    console.log(
      `${"".padEnd(10)}${["in bundle", "added", "already there", "left out"].map((h) => h.padStart(14)).join("")}`,
    );
    for (const kind of KINDS) {
      const c = report.counts[kind];
      console.log(
        `${kind.padEnd(10)}${[c.found, c.added, c.existing, c.skipped].map((n) => String(n).padStart(14)).join("")}`,
      );
    }
    console.log(`Sample articles ${values["include-samples"] ? "imported" : "left out"}: ${report.samples}`);
    for (const note of report.notes) console.log(`  ${note}`);
    if (KINDS.every((kind) => report.counts[kind].added === 0)) {
      console.log("Nothing new: everything in the bundle that can be imported is here already.");
    }
    if (!report.dryRun) {
      const bad = report.files.filter((file) => file.stored !== file.manifest);
      console.log(
        `Import check: ${report.files.length} files stored, ${report.files.length - bad.length} match the manifest.`,
      );
      for (const file of report.files) {
        console.log(
          `  ${file.stored === file.manifest ? "same" : "DIFFERS"} ${file.stored} ${file.path} -> ${file.key}`,
        );
      }
      if (bad.length > 0) process.exitCode = 1;
    }
  } finally {
    await database.close();
  }
} catch (error) {
  if (!(error instanceof ConfigError || error instanceof ImportRefused)) throw error;
  console.error(error.message);
  process.exitCode = 1;
}
