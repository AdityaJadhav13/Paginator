// A client that drops the connection mid-body is the client's doing (logged at info, answered 400); any other error,
// even one raised after the client has gone, is ours (logged at error). Over real sockets, because only a real abort
// sets request.raw.errored, the error the rule in src/http/errors.ts compares with.
import { type AddressInfo, connect } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.ts";
import { ORIGIN, testApp } from "./helpers.ts";

let app: App | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

type Case = {
  method: "GET" | "POST";
  /** where the route raises its own error, once the client has gone; "none" raises nothing */
  phase: "onRequest" | "preHandler" | "none";
  props: object;
  bytes: string;
  leave: "destroy" | "end";
};
const POST_HEAD =
  `POST /test/wait HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: ${ORIGIN}\r\nX-Pageinator: 1\r\n` +
  'Content-Type: application/json\r\nContent-Length: 1000\r\n\r\n{"headline": ';

/** Runs one case and returns the levels the error handler logged at for that request. */
async function levels(c: Case): Promise<string[]> {
  app = await testApp();
  const logged: string[] = [];
  let settle: () => void = () => undefined;
  const handled = new Promise<void>((resolve) => (settle = resolve));
  const record = (request: { log: object }) => {
    request.log = new Proxy(request.log, {
      get(target, key) {
        if (key === "info" || key === "error") return () => (logged.push(key), setTimeout(settle, 20));
        return Reflect.get(target, key) as unknown;
      },
    });
  };
  const failAfterClientLeaves = async (request: {
    log: object;
    raw: { readableAborted: boolean; once(event: string, listener: () => void): void };
  }) => {
    record(request);
    if (!request.raw.readableAborted) await new Promise<void>((resolve) => request.raw.once("close", resolve));
    throw Object.assign(new Error("a fault on our side, raised after the client left"), c.props);
  };
  app.route({
    method: c.method,
    url: "/test/wait",
    onRequest: c.phase === "onRequest" ? failAfterClientLeaves : async (request) => record(request),
    ...(c.phase === "preHandler" ? { preHandler: failAfterClientLeaves } : {}),
    handler: async () => ({ ok: true }),
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const { port } = app.server.address() as AddressInfo;
  const socket = connect(port, "127.0.0.1");
  socket.on("error", () => undefined);
  await new Promise<void>((resolve) => socket.once("connect", () => resolve()));
  socket.write(c.bytes);
  await new Promise((resolve) => setTimeout(resolve, 100));
  if (c.leave === "end") socket.end();
  else socket.destroy();
  await Promise.race([handled, new Promise((resolve) => setTimeout(resolve, 2000))]);
  return logged;
}

describe("a body that breaks off", () => {
  it.each(["destroy", "end"] as const)("is the client's, logged at info (the client %s)", async (leave) => {
    expect(await levels({ method: "POST", phase: "none", props: {}, bytes: POST_HEAD, leave })).toEqual(["info"]);
  });

  it.each([
    [
      "an FST_-coded 400 from a hook",
      {
        method: "POST",
        phase: "onRequest",
        props: { statusCode: 400, code: "FST_SOME_PLUGIN_REFUSAL" },
        bytes: POST_HEAD,
      },
    ],
    ["a plain 400 from a hook", { method: "POST", phase: "onRequest", props: { statusCode: 400 }, bytes: POST_HEAD }],
    ["a 401 from a hook", { method: "POST", phase: "onRequest", props: { statusCode: 401 }, bytes: POST_HEAD }],
    [
      "a plain 400 on a GET without a body",
      {
        method: "GET",
        phase: "onRequest",
        props: { statusCode: 400 },
        bytes: "GET /test/wait HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n",
      },
    ],
    [
      "a plain 400 after the body of a GET was read",
      {
        method: "GET",
        phase: "preHandler",
        props: { statusCode: 400 },
        bytes: "GET /test/wait HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 1000\r\n\r\nabc",
      },
    ],
  ] as const)("is never matched by %s once the client has gone: that is ours, logged at error", async (_name, c) => {
    expect(await levels({ ...c, leave: "destroy" })).toEqual(["error"]);
  });
});
