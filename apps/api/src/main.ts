// Starts the API: settings from the environment, then buildApp, then listen (127.0.0.1:8780 unless set otherwise).
// SIGTERM or SIGINT stops it (src/shutdown.ts): answers begun after the stop close their connections once sent; an
// answer already sent in full when the stop began is cut at once (Node's own close). One already streaming, or one sent
// before its request's body was read, keeps its connection until the grace period (PGN_SHUTDOWN_GRACE_S, 10 s by
// default) ends, when every connection still open is closed; the exit is still clean. A second identical signal kills
// the process at once, with no line; SIGTERM then SIGINT runs the stop twice.
import { buildApp } from "./app.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { stopOnSignals } from "./shutdown.ts";

function settings() {
  try {
    return loadConfig(process.env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(error.message);
    process.exit(1);
  }
}

/** The usual reasons listen() fails, in plain words (instead of a stack trace). */
function listenProblem(error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "EADDRINUSE") return "the port is already in use";
  if (code === "EADDRNOTAVAIL") return "this machine has no such address";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "the host name is not known";
  if (code === "EACCES") return "permission denied for that port";
  return error instanceof Error ? error.message : String(error);
}

const config = settings();
const app = await buildApp({ config, checks: {} }); // the database check arrives with the pools (PR 5)
stopOnSignals(app, config.shutdownGraceSeconds);

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  const where = config.host.includes(":") ? `[${config.host}]:${config.port}` : `${config.host}:${config.port}`;
  console.error(`The API could not listen on ${where}: ${listenProblem(error)}.`);
  process.exit(1);
}
