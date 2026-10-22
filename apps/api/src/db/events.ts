// The API's one LISTEN connection (docs/product/10-l2-newsroom-plan.md §2; pgn_listen, made by Database.listener()):
// it hears channel app_events (migration 2026_11_24_0001) and hands each message's text on, unparsed: the receiver
// treats it as an untrusted hint (src/modules/notifications/events.ts). A lost connection is made again after a pause
// (1 s, doubling to 30 s); since messages sent meanwhile are lost, `onGap` is called once it listens again, so the
// receiver can tell everyone to fetch afresh.
import type { Client } from "pg";
import type { Database } from "./pools.ts";

export const CHANNEL = "app_events";

export type Listening = {
  /** Resolves once the connection listens (or has failed once: it keeps trying). */
  ready: Promise<void>;
  /** Ends the connection and stops trying. */
  close(): Promise<void>;
};

export function listenAppEvents(
  database: Pick<Database, "listener">,
  handlers: { onMessage(text: string): void; onGap(): void; onError(error: Error): void },
): Listening {
  let client: Client | undefined;
  let closed = false;
  let pause = 1_000;
  let timer: NodeJS.Timeout | undefined;
  let gap = false; // a connection was lost (or never made) since the last one listened
  let markReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });

  const again = () => {
    if (closed || timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      void connect();
    }, pause);
    pause = Math.min(pause * 2, 30_000);
  };

  async function connect(): Promise<void> {
    const next = database.listener();
    client = next;
    let failed = false;
    const fail = (error: Error) => {
      if (failed) return;
      failed = true;
      gap = true;
      handlers.onError(error);
      next.removeAllListeners("notification");
      next.end().catch(() => undefined);
      markReady();
      again();
    };
    next.on("error", fail);
    next.on("end", () => {
      if (!closed) fail(new Error("the LISTEN connection ended"));
    });
    next.on("notification", (message) => {
      if (message.channel === CHANNEL && typeof message.payload === "string") handlers.onMessage(message.payload);
    });
    try {
      await next.connect();
      await next.query(`listen ${CHANNEL}`);
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    if (closed) {
      await next.end().catch(() => undefined);
      return;
    }
    pause = 1_000;
    if (gap) handlers.onGap();
    gap = false;
    markReady();
  }

  void connect();
  return {
    ready,
    async close() {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      await client?.end().catch(() => undefined);
    },
  };
}
