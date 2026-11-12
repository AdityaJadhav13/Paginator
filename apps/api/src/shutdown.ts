// How the API stops on SIGTERM or SIGINT. It takes no new requests, and every answer begun after the stop says
// `Connection: close` (closeWhenStopping), so Node closes that connection once the answer has been sent in full; the
// process ends when the last one is done. Three limits:
//   - an answer Node already held in full when the stop began is cut at once, even mid-write to a slow client: Node's
//     own server.close() closes every connection whose answer has ended;
//   - an answer already streaming when the stop began keeps its connection open until the grace period ends;
//   - an answer sent before the stop and before its request's body was read (the origin guard's 403, a malformed-URL
//     400) keeps its connection until that body arrives or the grace period ends, because server.close() leaves a
//     connection whose request is still in progress. The exit is still clean.
// A connection still open when the grace period (PGN_SHUTDOWN_GRACE_S) ends is closed anyway, so a slow or stuck client
// cannot keep the process alive; if the close has still not finished STUCK_MS later, the process prints one plain line
// and exits 1.
//
// Each signal is handled once: a second identical signal kills the process at once (Node's default), with no line;
// SIGTERM then SIGINT runs the stop twice (Fastify queues the second close behind the first).
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from "fastify";

export const STUCK_MS = 5_000;
const stopping = new WeakSet<object>(); // the HTTP servers whose app is stopping

/** True once stop() has begun for the app that owns this HTTP server. */
export function isStopping(server: object): boolean {
  return stopping.has(server);
}

/** What a stop needs of the app (a Fastify instance). */
export type Stoppable = {
  log: FastifyBaseLogger;
  server: object & { closeAllConnections(): void };
  close(): PromiseLike<unknown>;
};

/**
 * An onSend hook: while the app stops, every answer closes its connection once it has been sent. On a connection with
 * pipelined requests that is the first answer queued, so the requests behind it go unanswered; browsers and Caddy do
 * not pipeline.
 */
export async function closeWhenStopping(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (isStopping(request.server.server) && !reply.raw.headersSent) reply.header("connection", "close");
}

export function stop(app: Stoppable, signal: string, graceSeconds: number): void {
  stopping.add(app.server);
  app.log.info({ signal }, "stopping: no new requests");
  // Neither timer is unref'd: a close that hangs with nothing else pending must still reach the plain line and exit 1.
  setTimeout(() => {
    // either a client is still sending or reading, or a close hook has not finished
    app.log.warn("the grace period is over: closing any connection still open");
    app.server.closeAllConnections();
    setTimeout(() => {
      console.error(`The API did not stop within ${graceSeconds + STUCK_MS / 1000} s of ${signal}.`);
      process.exit(1);
    }, STUCK_MS);
  }, graceSeconds * 1000);
  app.close().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(`The API did not stop cleanly: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}

export function stopOnSignals(app: Stoppable, graceSeconds: number): void {
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => stop(app, signal, graceSeconds));
}
