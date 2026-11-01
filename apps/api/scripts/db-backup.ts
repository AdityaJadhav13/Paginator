// One database backup (docs/runbooks/restore.md): `pg_dump --format=custom` as pgn_backup into a file in
// PGN_BACKUP_DIR (/tmp unless set; /work, a volume, in compose), then
// one PutObject to the backups bucket under Object Lock in governance mode, retained PGN_BACKUP_RETAIN_DAYS (35 by
// default), with its SHA-256 checked by the store; then a HeadObject reads the checksum back. It runs in the backup
// image (infra/docker/api.Dockerfile, target backup), which has pg_dump 18; infra/backup/backup-loop.sh runs it
// nightly. It prints one line, "backup done: …" or "backup failed: …" (the CloudWatch alarms match them), and no
// secret. A dump over 5 GB would need a multipart upload: it fails plainly instead.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { ConfigError, loadBackupConfig } from "../src/config.ts";
import { s3Client } from "../src/storage/s3.ts";

const MAX_PUT_BYTES = 5 * 1024 ** 3;

/** The database's TLS settings, passed on to pg_dump as the API's pools read them (PGSSLMODE: verify-full and the RDS
 * certificate bundle in PGSSLROOTCERT in the pilot). */
function tlsSettings(): Record<string, string> {
  const names = ["PGSSLMODE", "PGSSLROOTCERT"] as const;
  return Object.fromEntries(names.flatMap((name) => (process.env[name] ? [[name, process.env[name]]] : [])));
}

async function dump(
  config: ReturnType<typeof loadBackupConfig>,
  file: string,
): Promise<{ bytes: number; sha256: Buffer }> {
  const { host, port, name, password } = config.database;
  const child = spawn(
    "pg_dump",
    [
      "--format=custom",
      "--no-password",
      `--host=${host}`,
      `--port=${port}`,
      "--username=pgn_backup",
      `--dbname=${name}`,
    ],
    {
      env: { ...tlsSettings(), PATH: process.env["PATH"] ?? "/usr/bin:/bin", PGPASSWORD: password },
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  const exited = new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
  const hash = createHash("sha256");
  const hashing = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk);
      done(null, chunk);
    },
  });
  await pipeline(child.stdout, hashing, createWriteStream(file, { mode: 0o600 }));
  const code = await exited;
  if (code !== 0) throw new Error(`pg_dump exited with ${code}`);
  return { bytes: (await stat(file)).size, sha256: hash.digest() };
}

async function main(): Promise<void> {
  const config = loadBackupConfig(process.env);
  const started = new Date();
  const stamp = started
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  const key = `postgres/${stamp.slice(0, 4)}/${stamp.slice(4, 6)}/${stamp.slice(6, 8)}/${config.database.name}-${stamp}.dump`;
  const file = join(process.env["PGN_BACKUP_DIR"] || "/tmp", `pgn-backup-${stamp}.dump`);
  try {
    const { bytes, sha256 } = await dump(config, file);
    if (bytes > MAX_PUT_BYTES) throw new Error(`the dump is ${bytes} bytes, over the 5 GB of one upload`);
    const client = s3Client(config.storage);
    const checksum = sha256.toString("base64");
    const retainUntil = new Date(started.getTime() + config.retainDays * 86_400_000);
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: createReadStream(file),
        ContentLength: bytes,
        ContentType: "application/octet-stream",
        ChecksumSHA256: checksum,
        ObjectLockMode: "GOVERNANCE",
        ObjectLockRetainUntilDate: retainUntil,
        Metadata: { sha256: sha256.toString("hex") },
      }),
    );
    const head = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key, ChecksumMode: "ENABLED" }));
    if (head.ContentLength !== bytes) throw new Error(`the store holds ${head.ContentLength} bytes, not ${bytes}`);
    if (head.ChecksumSHA256 !== undefined && head.ChecksumSHA256 !== checksum)
      throw new Error("the store's SHA-256 differs");
    const locked = head.ObjectLockMode === "GOVERNANCE" ? `locked until ${retainUntil.toISOString()}` : "NOT LOCKED";
    if (head.ObjectLockMode !== "GOVERNANCE")
      throw new Error(`the object is ${locked}: is Object Lock on for the bucket?`);
    console.log(
      `backup done: s3://${config.bucket}/${key}, ${bytes} bytes, sha256 ${sha256.toString("hex")}, ${locked}`,
    );
  } finally {
    await rm(file, { force: true });
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  // a ConfigError's message lists every setting that is not right, one per line
  console.error(`backup failed: ${error instanceof ConfigError ? "\n" : ""}${message}`);
  process.exitCode = 1;
}
