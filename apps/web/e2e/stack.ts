// The phone smoke's stack (Playwright's globalSetup; docs/DEVELOPMENT.md "The phone smoke"): Postgres, SeaweedFS and
// Mailpit from compose.dev.yml under a compose project of its own on ports of its own (compose.e2e.yml), migrated, its
// buckets made, and one fictional organisation bootstrapped; then the API, the engine's queue with
// the real Python runner, and the web app (Vite; the demo's from the production build), each a process of its own. It returns the teardown, which stops them
// and removes the project with its volumes. Nothing reads .env.dev: every secret is random, made here.
//   PGN_E2E_WORKER_PY  the engine worker's Python (a venv from apps/engine-worker/requirements.lock); required
//   PGN_E2E_ICC        a CMYK colour profile (default: macOS's Generic CMYK; never the private newsprint one)
//   PGN_E2E_PORT_BASE  62000 by default: Postgres +432, S3 +333, Mailpit +25, SMTP +125, API +780, web +180,
//                      the page editor's edit gateway +790
//   PGN_E2E_KEEP=1     keeps the logs folder (its path is printed)
// Of a shell's other PGN_* settings only these reach the processes, so a real layout can run (without them the engine's
// jobs refuse): PGN_ENGINE_PYTHON (the engine environment's Python), PGN_ENGINE_STALL_S, PGN_LAYOUT_TIMEOUT_S, and
// PGN_ONBOARD_PYTHON (the onboarding tool's Python: the worker venv's).
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const BASE = Number(process.env["PGN_E2E_PORT_BASE"] ?? 62000);
export const PORTS = {
  db: BASE + 432,
  s3: BASE + 333,
  mail: BASE + 25,
  smtp: BASE + 125,
  api: BASE + 780,
  web: BASE + 180,
  gateway: BASE + 790,
};
export const WEB = `http://127.0.0.1:${PORTS.web}`;
export const MAILPIT = `http://127.0.0.1:${PORTS.mail}/api/v1`;
const PROJECT = `pgn-e2e-${BASE}`;
/** The fictional newsroom (users at the reserved domain example.test). */
export const OWNER = { name: "Smoke Owner", email: "owner.smoke@example.test" };
export const REPORTER = { name: "Smoke Reporter", email: "reporter.smoke@example.test" };
/** The edition the Owner makes in the smoke. */
export const EDITION_DATE = "2026-12-01";

const hex = (bytes: number) => randomBytes(bytes).toString("hex");

/** Waits for ok(), each try cut off after 2 s; stops at once when the process it waits for has exited. */
async function until(what: string, ok: () => Promise<boolean>, child?: ChildProcess, ms = 60_000): Promise<void> {
  const end = Date.now() + ms;
  const attempt = () =>
    Promise.race([ok().catch(() => false), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000))]);
  while (!(await attempt())) {
    if (child && child.exitCode !== null) throw new Error(`${what} exited (${child.exitCode}) before it was ready`);
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Fails at once when a port the smoke needs is taken (by another stack, or a run cut short). */
async function portsFree(): Promise<void> {
  for (const port of Object.values(PORTS)) {
    await new Promise<void>((resolve, reject) => {
      const probe = createServer()
        .once("error", () => reject(new Error(`port ${port} is taken: set PGN_E2E_PORT_BASE to another base`)))
        .once("listening", () => probe.close(() => resolve()));
      probe.listen(port, "127.0.0.1");
    });
  }
}

/** A test that fails writes this into the logs folder, so the teardown keeps the logs. */
export const FAILED_MARK = "failed";

/** Playwright's globalSetup: the web app from Vite's development server. */
export default function stack(): Promise<() => Promise<void>> {
  return startStack(false);
}

/** The stack; with production, the web app is the production build (`vite build`, then `vite preview` with the same
 * /api proxy), as deployed: no development-only screens. */
export async function startStack(production: boolean): Promise<() => Promise<void>> {
  const python = process.env["PGN_E2E_WORKER_PY"] ?? "";
  if (!existsSync(python)) throw new Error("Set PGN_E2E_WORKER_PY to the engine worker's Python (its venv).");
  const icc = process.env["PGN_E2E_ICC"] ?? "/System/Library/ColorSync/Profiles/Generic CMYK Profile.icc";
  if (!existsSync(icc)) throw new Error("Set PGN_E2E_ICC to a CMYK colour profile on this machine.");

  const folder = mkdtempSync(join(tmpdir(), "pgn-e2e-"));
  const homes = join(folder, "homes");
  mkdirSync(homes, { mode: 0o700 });
  const secrets = {
    PGN_POSTGRES_PASSWORD: hex(16),
    PGN_MIGRATOR_PASSWORD: hex(16),
    PGN_APP_PASSWORD: hex(16),
    PGN_AUTH_PASSWORD: hex(16),
    PGN_ENGINE_PASSWORD: hex(16),
    PGN_LISTEN_PASSWORD: hex(16),
    PGN_S3_ACCESS_KEY_ID: hex(10),
    PGN_S3_SECRET_ACCESS_KEY: hex(20),
  };
  const envFile = join(folder, "compose.env");
  writeFileSync(
    envFile,
    Object.entries({
      ...secrets,
      PGN_E2E_DB_PORT: PORTS.db,
      PGN_E2E_S3_PORT: PORTS.s3,
      PGN_E2E_MAIL_PORT: PORTS.mail,
      PGN_E2E_SMTP_PORT: PORTS.smtp,
    })
      .map(([name, value]) => `${name}=${value}\n`)
      .join(""),
    { mode: 0o600 },
  );
  const compose = (...args: string[]) =>
    execFileSync(
      "docker",
      [
        "compose",
        "-p",
        PROJECT,
        "--env-file",
        envFile,
        "-f",
        join(REPO, "infra/docker/compose.dev.yml"),
        "-f",
        join(REPO, "apps/web/e2e/compose.e2e.yml"),
        ...args,
      ],
      { encoding: "utf8", stdio: "pipe" },
    );

  // the settings every process gets: no inherited PGN_* (a developer's shell) but the engine's, only these
  const kept = new Set(["PGN_ENGINE_PYTHON", "PGN_ENGINE_STALL_S", "PGN_LAYOUT_TIMEOUT_S", "PGN_ONBOARD_PYTHON"]);
  const base = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("PGN_") || kept.has(name)),
  );
  const env = {
    ...base,
    ...secrets,
    PGN_DB_HOST: "127.0.0.1",
    PGN_DB_PORT: String(PORTS.db),
    PGN_DB_NAME: "pageinator",
    PGN_API_PORT: String(PORTS.api),
    PGN_ALLOWED_ORIGINS: WEB,
    PGN_AUTH_SECRET: hex(32),
    PGN_SMTP_PORT: String(PORTS.smtp),
    PGN_S3_ENDPOINT: `http://127.0.0.1:${PORTS.s3}`,
    PGN_S3_WORK_BUCKET: "pgn-e2e-work",
    PGN_S3_ARCHIVE_BUCKET: "pgn-e2e-archive",
    PGN_LOG_LEVEL: "warn",
  };
  const node = (script: string, ...args: string[]) =>
    execFileSync(process.execPath, [join(REPO, script), ...args], { env, encoding: "utf8", cwd: REPO });

  const processes: ChildProcess[] = [];
  const start = (name: string, command: string, args: string[], cwd: string, extra: NodeJS.ProcessEnv = {}) => {
    const log = openSync(join(folder, `${name}.log`), "a");
    const child = spawn(command, args, { cwd, env: { ...env, ...extra }, stdio: ["ignore", log, log] });
    processes.push(child);
    return child;
  };
  const teardown = async () => {
    for (const child of processes) child.kill("SIGTERM");
    await Promise.all(
      processes.map(
        (child) =>
          new Promise<void>((resolve) => {
            if (child.exitCode !== null || child.signalCode !== null) return resolve();
            const timer = setTimeout(() => {
              child.kill("SIGKILL");
              resolve();
            }, 10_000);
            child.once("exit", () => {
              clearTimeout(timer);
              resolve();
            });
          }),
      ),
    );
    try {
      compose("down", "--volumes", "--remove-orphans");
    } finally {
      if (process.env["PGN_E2E_KEEP"] === "1" || existsSync(join(folder, FAILED_MARK)))
        console.log(`The smoke's logs: ${folder}`);
      else rmSync(folder, { recursive: true, force: true });
    }
  };

  try {
    compose("down", "--volumes", "--remove-orphans"); // a run cut short before
    await portsFree();
    compose("up", "-d", "--wait", "db", "s3", "mail");
    node("apps/api/scripts/db-migrate.ts");
    // with the CORS rule for the web app's origin: the browser uploads to the store itself
    execFileSync(process.execPath, [join(REPO, "apps/api/scripts/dev-buckets.ts")], {
      env: { ...env, PGN_S3_CORS_ORIGIN: WEB },
      cwd: REPO,
      stdio: "ignore",
    });
    const made = node(
      "apps/api/scripts/bootstrap-org.ts",
      ...["--owner-name", OWNER.name, "--owner-email", OWNER.email],
      ...["--org-name", "Example Press Smoke", "--org-slug", "example-press-smoke"],
      ...["--pub-name", "Kalpanik Varta", "--pub-slug", "kalpanik-varta"],
      ...["--languages", "mr,en", "--primary", "mr", "--digits", "devanagari"],
    );
    const ids = /Organisation ([0-9a-f-]{36}), publication ([0-9a-f-]{36})/.exec(made);
    if (!ids) throw new Error(`bootstrap-org said: ${made}`);
    const [, orgId, pubId] = ids;
    // the page editor's edit gateway, on the engine's homes (as compose.pilot.yml shares them), and the API signed to it
    const gateway = {
      PGN_GATEWAY_URL: `http://127.0.0.1:${PORTS.gateway}`,
      PGN_GATEWAY_SECRET: hex(32),
    };
    const editGateway = start("gateway", python, ["-B", "-m", "pgn_worker.gateway"], join(REPO, "apps/engine-worker"), {
      PGN_GATEWAY_SECRET: gateway.PGN_GATEWAY_SECRET,
      PGN_GATEWAY_PORT: String(PORTS.gateway),
      PGN_WORKER_HOMES: homes,
    });
    // it refuses an unsigned request (401) once it listens
    await until("the edit gateway", async () => (await fetch(`${gateway.PGN_GATEWAY_URL}/v1/call`)).status === 401, editGateway);
    const api = start("api", process.execPath, ["src/main.ts"], join(REPO, "apps/api"), gateway);
    await until("the API", async () => (await fetch(`http://127.0.0.1:${PORTS.api}/readyz`)).ok, api);
    const profile = readFileSync(icc);
    const queue = start("queue", process.execPath, ["src/main.ts"], join(REPO, "apps/engine-queue"), {
      PGN_WORKER_PYTHON: python,
      PGN_WORKER_DIR: join(REPO, "apps/engine-worker"),
      PGN_RUNNER_TIMEOUT_S: "120",
      PAGEINATOR_ICC: icc,
      PGN_ICC_SHA256: createHash("sha256").update(profile).digest("hex"),
      PGN_WORKER_HOMES: homes,
    });
    const vite = join(REPO, "apps/web/node_modules/vite/bin/vite.js");
    const dist = join(folder, "dist"); // the build goes in the logs folder, not the checkout's dist/
    if (production)
      execFileSync(process.execPath, [vite, "build", "--outDir", dist, "--emptyOutDir"], {
        cwd: join(REPO, "apps/web"),
        stdio: "ignore",
      });
    const web = start(
      "web",
      process.execPath,
      [vite, ...(production ? ["preview", "--outDir", dist] : []), "--port", String(PORTS.web)],
      join(REPO, "apps/web"),
      { PGN_DEV_API: `http://127.0.0.1:${PORTS.api}` },
    );
    await until("the web app", async () => (await fetch(WEB)).ok, web);
    if (queue.exitCode !== null) throw new Error(`the engine queue stopped: see ${join(folder, "queue.log")}`);
    if (editGateway.exitCode !== null) throw new Error(`the edit gateway stopped: see ${join(folder, "gateway.log")}`);

    Object.assign(process.env, {
      PGN_E2E_ORG: orgId,
      PGN_E2E_PUB: pubId,
      PGN_E2E_LOGS: folder,
    });
    return teardown;
  } catch (error) {
    process.env["PGN_E2E_KEEP"] = "1";
    await teardown();
    throw error;
  }
}
