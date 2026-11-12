// What Node refuses before Fastify sees a request (bytes that are not HTTP, headers that are too large, a request that
// arrives too slowly) is answered with the envelope, a new request id and the baseline headers too.
import { type AddressInfo, type Socket, connect } from "node:net";
import { PassThrough } from "node:stream";
import type { ConnectionError, FastifyBaseLogger } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { ErrorEnvelope } from "@pageinator/contracts";
import type { App } from "../../src/app.ts";
import { clientErrorHandler } from "../../src/http/errors.ts";
import { UUID, testApp } from "./helpers.ts";

type Answer = { status: number; headers: Record<string, string>; body: string };

function parse(text: string): Answer {
  const at = text.indexOf("\r\n\r\n");
  const [statusLine = "", ...lines] = text.slice(0, at).split("\r\n");
  const headers = Object.fromEntries(
    lines.map((line) => [line.slice(0, line.indexOf(":")).toLowerCase(), line.slice(line.indexOf(":") + 1).trim()]),
  );
  return { status: Number(statusLine.split(" ")[1]), headers, body: text.slice(at + 4) };
}

let app: App | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** Sends raw bytes to a listening app and returns what it writes before it closes the connection. */
async function send(bytes: string): Promise<Answer> {
  app = await testApp();
  await app.listen({ host: "127.0.0.1", port: 0 });
  const { port } = app.server.address() as AddressInfo;
  const text = await new Promise<string>((resolve) => {
    let out = "";
    const socket = connect(port, "127.0.0.1", () => socket.write(bytes));
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => (out += chunk));
    socket.on("close", () => resolve(out));
    socket.on("error", () => socket.destroy());
  });
  return parse(text);
}

function expectEnvelope(answer: Answer, status: number, code: string, message: string): void {
  expect(answer.status).toBe(status);
  expect(answer.headers["content-type"]).toBe("application/json; charset=utf-8");
  expect(answer.headers["x-request-id"]).toMatch(UUID);
  expect(answer.headers["x-content-type-options"]).toBe("nosniff");
  expect(answer.headers["content-security-policy"]).toBe("default-src 'none';frame-ancestors 'none'");
  expect(answer.headers["x-frame-options"]).toBe("DENY");
  expect(answer.headers["connection"]).toBe("close");
  expect(ErrorEnvelope.parse(JSON.parse(answer.body)).error).toEqual({
    code,
    message,
    requestId: answer.headers["x-request-id"],
  });
}

describe("Node-level refusals", () => {
  it("answers bytes that are not HTTP with 400", async () => {
    expectEnvelope(await send("HELLO PAGEINATOR\r\n\r\n"), 400, "invalid_request", "This request could not be read.");
  });

  it("answers headers that are too large with 431", async () => {
    const huge = `GET /healthz HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Big: ${"a".repeat(20_000)}\r\n\r\n`;
    expectEnvelope(await send(huge), 431, "request_too_large", "This request is too large.");
  });

  it("answers a request that arrives too slowly with 408 (Node's own timeout)", () => {
    const timedOut = fakeSocket();
    clientErrorHandler.call({ log: quiet }, connectionError("ERR_HTTP_REQUEST_TIMEOUT"), timedOut.socket);
    expectEnvelope(
      parse(timedOut.written.join("")),
      408,
      "invalid_request",
      "This request took too long to arrive. Try again.",
    );
    expect(timedOut.destroyed()).toBe(true);
  });

  it("writes nothing to a client that has gone, to a socket it cannot write, or inside a response under way", () => {
    const cases: [string, ReturnType<typeof fakeSocket>, ConnectionError][] = [
      ["reset by the client", fakeSocket(), connectionError("ECONNRESET")],
      ["already destroyed", fakeSocket({ destroyed: true }), connectionError("HPE_INVALID_METHOD")],
      ["not writable", fakeSocket({ writable: false }), connectionError("HPE_INVALID_METHOD")],
      ["response headers already sent", fakeSocket({ headersSent: true }), connectionError("HPE_INVALID_METHOD")],
    ];
    for (const [name, fake, error] of cases) {
      clientErrorHandler.call({ log: quiet }, error, fake.socket);
      expect(fake.written, name).toEqual([]);
    }
  });

  it("logs only the id and Node's error code, never the raw bytes (they may hold a cookie)", () => {
    const logged: unknown[][] = [];
    const log = { info: (...args: unknown[]) => logged.push(args) } as unknown as FastifyBaseLogger;
    const secret = "Cookie: pgn_session=kalpaniknagar-secret-session";
    const error = Object.assign(connectionError("HPE_HEADER_OVERFLOW"), {
      rawPacket: Buffer.from(`GET / HTTP/1.1\r\n${secret}\r\n`),
      bytesParsed: 17,
    });
    clientErrorHandler.call({ log }, error, fakeSocket().socket);
    expect(logged).toHaveLength(1);
    const [fields] = logged[0] as [Record<string, unknown>];
    expect(Object.keys(fields).sort()).toEqual(["code", "reqId"]);
    expect(fields["code"]).toBe("HPE_HEADER_OVERFLOW");
    expect(JSON.stringify(logged)).not.toContain("kalpaniknagar-secret-session");
  });

  it("does not write its own answer inside a pipelined response that is still being sent", async () => {
    app = await testApp();
    app.get("/test/stream", async (_request, reply) => {
      const body = new PassThrough();
      body.write('{"part":1,');
      setTimeout(() => body.end('"part":2}'), 400);
      return reply.type("application/json").send(body);
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { port } = app.server.address() as AddressInfo;
    const text = await new Promise<string>((resolve) => {
      let out = "";
      const socket = connect(port, "127.0.0.1", () => {
        socket.write("GET /test/stream HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
        setTimeout(() => socket.write("NOT HTTP AT ALL\r\n\r\n"), 100);
      });
      socket.setEncoding("latin1");
      socket.on("data", (chunk: string) => (out += chunk));
      socket.on("close", () => resolve(out));
      socket.on("error", () => socket.destroy());
    });
    expect(text.startsWith("HTTP/1.1 200 OK")).toBe(true);
    expect(text.slice(text.indexOf("\r\n\r\n"))).not.toContain("HTTP/1.1 400");
  });
});

function fakeSocket(state: { destroyed?: boolean; writable?: boolean; headersSent?: boolean } = {}) {
  const written: string[] = [];
  let destroyed = false;
  const socket = {
    destroyed: state.destroyed ?? false,
    writable: state.writable ?? true,
    _httpMessage: state.headersSent === undefined ? undefined : { headersSent: state.headersSent },
    write: (data: string) => written.push(data) > 0,
    destroy: () => {
      destroyed = true;
    },
  } as unknown as Socket;
  return { socket, written, destroyed: () => destroyed };
}

function connectionError(code: string): ConnectionError {
  return Object.assign(new Error(code), { code }) as ConnectionError;
}

const quiet = { info: () => undefined } as unknown as FastifyBaseLogger;
