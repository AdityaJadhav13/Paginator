// The queue's process (plan §2.2 step 3; the worker image's CMD): settings from the environment, the worker's health
// command, then the queue as pgn_engine, reporting to the API's inbox. SIGTERM or SIGINT stops it: running jobs end by
// themselves (at most the runner's time limit) and are finished in the database before it exits 0, so the
// deployment's stop grace period must exceed PGN_RUNNER_TIMEOUT_S + 5 s. A second signal exits at once (the job stays
// locked until a queue releases it: a lock older than the runner's limit plus 5 minutes, checked at start-up and
// every minute, queue.ts releaseStaleLocks; out of attempts, it is then the API's sweep's). It exits 1 when its settings are
// missing, the worker is not healthy, or a job found the worker misconfigured (worker.config): an operator's fault.
//   PGN_DB_HOST, PGN_DB_PORT (5432), PGN_DB_NAME, PGN_ENGINE_PASSWORD; PGSSLMODE as node-postgres reads it
//   PGN_QUEUE_CONCURRENCY (1), PGN_RUNNER_TIMEOUT_S (180), PGN_WORKER_PYTHON (python), PGN_WORKER_DIR (the runner's cwd)
//   and the runner's own settings (PGN_S3_*, PGN_ICC_SHA256, PAGEINATOR_ICC, PGN_WORKER_HOMES: runnerEnv passes only those)
import { reportToInbox } from "./inbox.ts";
import { startQueue, type QueueSettings } from "./queue.ts";

export class SettingsError extends Error {}

const WHOLE = /^[1-9][0-9]{0,5}$/;

export function settingsFrom(env: NodeJS.ProcessEnv): QueueSettings {
  const need = (name: string) => {
    const value = env[name];
    if (!value) throw new SettingsError(`${name} is not set`);
    return value;
  };
  const whole = (name: string, fallback: string, max: number) => {
    const value = env[name] || fallback;
    if (!WHOLE.test(value) || Number(value) > max)
      throw new SettingsError(`${name} must be a whole number up to ${max}`);
    return Number(value);
  };
  const url = new URL("postgres://localhost");
  url.hostname = need("PGN_DB_HOST");
  url.port = String(whole("PGN_DB_PORT", "5432", 65535));
  url.pathname = `/${encodeURIComponent(need("PGN_DB_NAME"))}`;
  url.username = "pgn_engine";
  url.password = encodeURIComponent(need("PGN_ENGINE_PASSWORD"));
  url.searchParams.set("application_name", "pageinator-engine-queue");
  return {
    connectionString: url.href,
    concurrency: whole("PGN_QUEUE_CONCURRENCY", "1", 16),
    noHandleSignals: true,
    report: reportToInbox,
    runner: {
      command: env["PGN_WORKER_PYTHON"] || "python",
      args: ["-B", "-m", "pgn_worker.run"],
      health: ["-B", "-m", "pgn_worker.health"],
      cwd: env["PGN_WORKER_DIR"] || "/opt/pageinator/apps/engine-worker",
      env,
      timeoutMs: whole("PGN_RUNNER_TIMEOUT_S", "180", 3600) * 1000,
    },
  };
}

async function main(): Promise<void> {
  let settings: QueueSettings;
  try {
    settings = settingsFrom(process.env);
  } catch (error) {
    if (!(error instanceof SettingsError)) throw error;
    console.error(`The engine queue cannot start: ${error.message}.`);
    process.exit(1);
  }
  const runner = await startQueue(settings);
  let stopping = false;
  const stop = (signal: NodeJS.Signals) => {
    if (stopping) process.exit(1); // a second signal: at once
    stopping = true;
    console.log(`The engine queue is stopping (${signal}): running jobs finish first.`);
    void runner.stop();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  await runner.promise;
  console.log("The engine queue stopped.");
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`The engine queue stopped: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
