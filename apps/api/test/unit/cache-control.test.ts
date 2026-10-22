// Cache-Control: no-store on every /api/v1 and /api/auth answer (src/app.ts: an onSend hook, the server factory for
// answers written before any hook, and BASELINE_HEADERS for every error answer), so story text never stays in a
// shared PC's browser cache: framework refusals, Node's raw refusals, the 503 while closing, and the paths spelled
// without their slash or with doubled slashes.
import { type AddressInfo, connect } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { type App, isApiPath } from "../../src/app.ts";
import { ORIGIN, testApp } from "./helpers.ts";

let app: App | undefined;
afterEach(async () => {
  await app?.close().catch(() => undefined);
  app = undefined;
});

/** Writes raw bytes to the listening app, and returns what came back once the connection closed. */
async function raw(target: App, bytes: string, afterWrite?: (write: (more: string) => void) => void): Promise<string> {
  const { port } = target.server.address() as AddressInfo;
  return new Promise<string>((resolve) => {
    let out = "";
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(bytes);
      afterWrite?.((more) => socket.write(more));
    });
    socket.setEncoding("utf8");
    let quiet: NodeJS.Timeout | undefined;
    socket.on("data", (chunk: string) => {
      out += chunk;
      clearTimeout(quiet);
      quiet = setTimeout(() => socket.destroy(), 1500); // nothing more for a while: done
    });
    socket.on("close", () => {
      clearTimeout(quiet);
      resolve(out);
    });
    socket.on("error", () => socket.destroy());
  });
}

const cacheOf = (answer: string) =>
  answer
    .split("\r\n")
    .filter((line) => line.toLowerCase().startsWith("cache-control:"))
    .map((line) => line.slice("cache-control:".length).trim());

describe("Cache-Control: no-store", () => {
  it("knows an API path however it is spelled", () => {
    for (const url of [
      "/api/v1",
      "/api/v1/",
      "/api/v1?x=1",
      "/api/auth",
      "/api/auth/get-session",
      "//api/v1/me",
      "/api//v1",
    ]) {
      expect(isApiPath(url), url).toBe(true);
    }
    for (const url of ["/healthz", "/api/v10", "/api/authx", "/apiv1", "/"]) expect(isApiPath(url), url).toBe(false);
  });

  it("is on the framework's refusals and on every spelling of an API path", async () => {
    app = await testApp({ PGN_RATE_LIMIT_PER_MINUTE: "100" });
    const answers = await Promise.all(
      ["/api/v1/%zz", `/api/v1/orgs/${"x".repeat(200)}`, "/api/v1", "/api/v1?x=1", "/api/auth", "//api/v1/me"].map(
        (url) => (app as App).inject({ method: "GET", url }),
      ),
    );
    expect(answers.map((res) => [res.statusCode, res.headers["cache-control"]])).toEqual(
      answers.map((res) => [res.statusCode, "no-store"]),
    );
    const refused = await app.inject({
      method: "POST",
      url: "/api/v1/x",
      headers: { origin: "https://elsewhere.test" },
    });
    expect([refused.statusCode, refused.headers["cache-control"]]).toEqual([403, "no-store"]);
  });

  it("is on a 429", async () => {
    app = await testApp({ PGN_RATE_LIMIT_PER_MINUTE: "1" });
    await app.inject({ method: "GET", url: "/api/v1/nowhere" });
    const over = await app.inject({ method: "GET", url: "/api/v1/nowhere" });
    expect([over.statusCode, over.headers["cache-control"]]).toEqual([429, "no-store"]);
  });

  it("is on Node's raw refusals: headers too large (431) and bytes that are not HTTP (400)", async () => {
    app = await testApp();
    await app.listen({ host: "127.0.0.1", port: 0 });
    const big = await raw(app, `GET /api/v1/me HTTP/1.1\r\nHost: x\r\nX-Big: ${"a".repeat(20_000)}\r\n\r\n`);
    expect([big.split(" ")[1], cacheOf(big)]).toEqual(["431", ["no-store"]]);
    const junk = await raw(app, "NOT HTTP AT ALL\r\n\r\n");
    expect([junk.split(" ")[1], cacheOf(junk)]).toEqual(["400", ["no-store"]]);
  });

  it("is on Fastify's 503 while the app closes", async () => {
    app = await testApp();
    app.get("/api/v1/test-slow", async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return { ok: true };
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const target = app;
    const request = (path: string) => `GET ${path} HTTP/1.1\r\nHost: x\r\nOrigin: ${ORIGIN}\r\n\r\n`;
    // a second request on the same connection, sent once the app has begun to close (the first still in flight)
    const answer = await raw(target, request("/api/v1/test-slow"), (write) => {
      setTimeout(() => void target.close(), 100);
      setTimeout(() => write(request("/api/v1/second")), 150);
    });
    app = undefined;
    const second = answer.slice(answer.indexOf("HTTP/1.1", 10));
    expect([second.split(" ")[1], cacheOf(second)]).toEqual(["503", ["no-store"]]);
  });
});
