// The queue's process (plan §2.2 step 3; the worker image's CMD): settings from the environment, the worker's health
// command, then the queue as pgn_engine, reporting to the API's inbox. SIGTERM or SIGINT stops it: running jobs end by
// themselves (at most the runner's time limit) and are finished in the database before it exits 0; an engine job
// (whose own limit is longer) is stopped gracefully once PGN_RUNNER_TIMEOUT_S + 5 s have passed, at most 10 s more, a
// layout then failed as worker.restarted (tasks.ts). So the deployment's stop grace period must exceed
// PGN_RUNNER_TIMEOUT_S + 20 s. A second signal exits at once (the job stays
// locked until a queue releases it: a lock older than the runner's limit plus 5 minutes, checked at start-up and
// every minute, queue.ts releaseStaleLocks; out of attempts, it is then the API's sweep's). It exits 1 when its settings are
// missing, the worker is not healthy, or a job found the worker misconfigured (worker.config): an operator's fault.
//   PGN_DB_HOST, PGN_DB_PORT (5432), PGN_DB_NAME, PGN_ENGINE_PASSWORD; PGSSLMODE as node-postgres reads it
//   PGN_QUEUE_CONCURRENCY (2), PGN_RUNNER_TIMEOUT_S (180), PGN_WORKER_PYTHON (python), PGN_WORKER_DIR (the runner's cwd)
//   PGN_LAYOUT_TIMEOUT_S (3600: engine.layout's limit; engine.setup has 1800 s, engine.measure 900 s), and for the
//   runner PGN_ENGINE_PYTHON (the layout engine's Python) and PGN_ENGINE_STALL_S (how long an engine may show no
//   progress; the runner's default when unset)
//   and the runner's own settings (PGN_S3_*, PGN_ICC_SHA256, PAGEINATOR_ICC, PGN_WORKER_HOMES: runnerEnv passes only those)
//   the news finder's Claude: ANTHROPIC_API_KEY (none: the AI part is off, collection still works; never passed to
//   the Python runner), PGN_AI_MODEL (claude-opus-5-5), PGN_AI_INR_PER_USD (88: the rupee price of a dollar, for the
//   spend log and the cap)
import { reportToInbox } from "./inbox.ts";
import { AnthropicAi } from "./news/ai.ts";
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
  const model = env["PGN_AI_MODEL"] || "claude-opus-5-5";
  if (!/^[a-z0-9][a-z0-9.-]{0,99}$/.test(model)) throw new SettingsError("PGN_AI_MODEL must be a model id");
  const rate = env["PGN_AI_INR_PER_USD"] || "88";
  if (!/^[0-9]{1,4}(\.[0-9]{1,4})?$/.test(rate) || Number(rate) <= 0)
    throw new SettingsError("PGN_AI_INR_PER_USD must be a positive number of rupees");
  const apiKey = env["ANTHROPIC_API_KEY"];
  return {
    connectionString: url.href,
    concurrency: whole("PGN_QUEUE_CONCURRENCY", "2", 16),
    noHandleSignals: true,
    report: reportToInbox,
    news: { ai: apiKey ? new AnthropicAi({ apiKey, model, inrPerUsd: Number(rate) }) : null },
    runner: {
      command: env["PGN_WORKER_PYTHON"] || "python",
      args: ["-B", "-m", "pgn_worker.run"],
      health: ["-B", "-m", "pgn_worker.health"],
      cwd: env["PGN_WORKER_DIR"] || "/opt/pageinator/apps/engine-worker",
      env,
      timeoutMs: whole("PGN_RUNNER_TIMEOUT_S", "180", 3600) * 1000,
      limitsMs: {
        "engine.layout": whole("PGN_LAYOUT_TIMEOUT_S", "3600", 86_400) * 1000,
        "engine.setup": 1_800_000,
        "engine.measure": 900_000,
      },
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
