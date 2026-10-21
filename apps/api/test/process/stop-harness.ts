// Started by main.test.ts: an app stopped the way main.ts stops it. argv[2] is the case:
//   - "hang":   an onClose hook that never settles and holds no handle; stopped at once, with no grace period;
//   - "reject": an onClose hook that fails; stopped at once;
//   - "big":    listens on PGN_API_PORT with a route whose answer (8 MiB) is larger than the socket buffers, and stops
//               on SIGTERM or SIGINT with a 10 s grace period.
import { buildApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config.ts";
import { stop, stopOnSignals } from "../../src/shutdown.ts";

const mode = process.argv[2];
const app = await buildApp({ config: loadConfig({ PGN_LOG_LEVEL: mode === "big" ? "info" : "silent" }), checks: {} });
if (mode === "big") {
  app.get("/test/big", async (_request, reply) => {
    await new Promise((resolve) => setTimeout(resolve, 300)); // still in flight when the stop begins
    return reply.type("application/octet-stream").send(Buffer.alloc(8 * 1024 * 1024, 0x61));
  });
  stopOnSignals(app, 10);
  await app.listen({ host: "127.0.0.1", port: Number(process.env["PGN_API_PORT"]) });
} else {
  app.addHook("onClose", () =>
    mode === "reject" ? Promise.reject(new Error("a close hook failed")) : new Promise<void>(() => undefined),
  );
  await app.ready();
  stop(app, "SIGTERM", 0);
}
