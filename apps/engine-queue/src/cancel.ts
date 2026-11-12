// A user's cancel of a layout or a measure (L2.3; plan §2.2): the API's app.cancel_engine_job removes a job that has
// not started and always NOTIFYs `engine_cancel` with its key; this process LISTENs and aborts the matching job it is
// running (its runner then stops gracefully). `measure:*` stops every running measure (a layout takes priority). A
// NOTIFY lost while the connection was down only means the run goes on: the API has recorded the cancel already and
// ignores the run's later events.
import pg from "pg";

export const CANCEL_CHANNEL = "engine_cancel";
/** How long the listener waits before connecting again after its connection failed. */
export const RELISTEN_MS = 5_000;

/** The running jobs of this process that a cancel can reach, by job key. */
export class Cancels {
  private readonly running = new Map<string, Set<AbortController>>();

  /** Watches a running job's key; the returned controller aborts on its cancel. Call `done` when the job ends. */
  watch(key: string | null): { signal: AbortSignal; done: () => void } {
    const controller = new AbortController();
    if (key === null) return { signal: controller.signal, done: () => {} };
    const set = this.running.get(key) ?? new Set();
    this.running.set(key, set.add(controller));
    return {
      signal: controller.signal,
      done: () => {
        set.delete(controller);
        if (set.size === 0 && this.running.get(key) === set) this.running.delete(key);
      },
    };
  }

  /** A NOTIFY's payload (`run:<id>`, `measure:<id>` or `measure:*`): aborts the jobs it names; how many. */
  cancel(payload: string): number {
    const keys = payload === "measure:*" ? [...this.running.keys()].filter((k) => k.startsWith("measure:")) : [payload];
    let n = 0;
    for (const key of keys)
      for (const controller of this.running.get(key) ?? []) {
        controller.abort();
        n += 1;
      }
    return n;
  }
}

/** LISTENs on engine_cancel on a connection of its own (as pgn_engine: LISTEN needs no grant), connecting again
 * after any failure until stopped. */
export function listenForCancels(connectionString: string, cancels: Cancels): { stop: () => Promise<void> } {
  let client: pg.Client | null = null;
  let stopped = false;
  let retrying: NodeJS.Timeout | undefined;
  const again = (failed: pg.Client) => {
    if (stopped || client !== failed) return; // stopping, or already connecting again
    client = null;
    failed.end().catch(() => {});
    retrying = setTimeout(connect, RELISTEN_MS);
    retrying.unref();
  };
  const connect = () => {
    if (stopped) return;
    const c = new pg.Client({ connectionString });
    client = c;
    c.on("error", () => again(c));
    c.on("end", () => again(c));
    c.on("notification", (message) => {
      if (message.channel === CANCEL_CHANNEL && message.payload) cancels.cancel(message.payload);
    });
    c.connect()
      .then(() => c.query(`listen ${CANCEL_CHANNEL}`))
      .catch(() => {
        console.warn("The engine queue could not listen for cancels; trying again.");
        again(c);
      });
  };
  connect();
  return {
    stop: async () => {
      stopped = true;
      clearTimeout(retrying);
      await client?.end().catch(() => {});
    },
  };
}
