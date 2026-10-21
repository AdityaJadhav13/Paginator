// The real process (apps/api/src/main.ts, or test/process/stop-harness.ts): stops with clients in flight, reading slowly
// or still sending, stops that hang or fail, a client that drops its connection mid-body, and listen()'s errors.
import { type ChildProcess, spawn } from "node:child_process";
import { type AddressInfo, type Server, type Socket, connect, createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const MAIN = fileURLToPath(new URL("../../src/main.ts", import.meta.url));
const HARNESS = fileURLToPath(new URL("./stop-harness.ts", import.meta.url));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const FROM_APP_POST =
  "POST /anything HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: http://127.0.0.1:5180\r\nX-Pageinator: 1\r\n" +
  "Content-Type: application/json\r\n";
const children: ChildProcess[] = [];
const sockets: Socket[] = [];
const servers: Server[] = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const server of servers.splice(0)) server.close();
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

type Exit = { code: number | null; signal: string | null; stdout: string; stderr: string; at: number };

function start(env: Record<string, string>, args: string[] = [MAIN]) {
  const child = spawn(process.execPath, args, {
    env: { PATH: process.env["PATH"] ?? "", PGN_LOG_LEVEL: "info", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
  child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
  const exited = new Promise<Exit>((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal, stdout, stderr, at: Date.now() }));
  });
  const listening = new Promise<void>((resolve, reject) => {
    const poll = setInterval(() => {
      if (!stdout.includes('"msg":"Server listening at') && child.exitCode === null) return;
      clearInterval(poll);
      if (child.exitCode === null) resolve();
      else reject(new Error(`exited early: ${stderr}`));
    }, 20);
  });
  listening.catch(() => undefined); // the listen-error tests wait for the exit instead
  return { child, exited, listening };
}

/** A client that sends part of a request and then waits; `answer()` is what it has received so far. */
async function halfSend(port: number, bytes: string): Promise<Socket & { answer: () => string }> {
  let received = "";
  const socket = Object.assign(connect(port, "127.0.0.1"), { answer: () => received });
  sockets.push(socket);
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => (received += chunk));
  socket.on("error", () => socket.destroy());
  await new Promise<void>((resolve) => socket.once("connect", () => resolve()));
  socket.write(bytes);
  return socket;
}

/** The JSON log lines a process has written so far. */
function logLines(stdout: string): { level: number; msg: string }[] {
  return stdout
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as { level: number; msg: string });
}

describe("stopping", () => {
  it.each(["SIGTERM", "SIGINT"] as const)("stops at once on %s when nothing is in flight", async (signal) => {
    const port = await freePort();
    const api = start({ PGN_API_PORT: String(port) });
    await api.listening;
    const signalled = Date.now();
    api.child.kill(signal);
    const exit = await api.exited;
    expect(exit.code).toBe(0);
    expect(exit.at - signalled).toBeLessThan(2000);
    expect(logLines(exit.stdout).map((line) => line.msg)).toContain("stopping: no new requests");
  });

  it("lets a request in flight finish, then exits at once, well before the grace period", async () => {
    const port = await freePort();
    const api = start({ PGN_API_PORT: String(port), PGN_SHUTDOWN_GRACE_S: "4" });
    await api.listening;
    const client = await halfSend(port, `${FROM_APP_POST}Content-Length: 2\r\n\r\n`);
    await sleep(100);
    const signalled = Date.now();
    api.child.kill("SIGTERM");
    await sleep(300);
    client.write("{}"); // the request completes 300 ms into the stop
    const exit = await api.exited;
    expect(client.answer().split("\r\n")[0]).toBe("HTTP/1.1 404 Not Found");
    expect(client.answer().toLowerCase()).toContain("\r\nconnection: close\r\n");
    expect(exit.code).toBe(0);
    expect(exit.at - signalled).toBeGreaterThanOrEqual(300);
    expect(exit.at - signalled).toBeLessThan(1500);
    expect(exit.stdout).not.toContain("the grace period is over");
  }, 15_000);

  it("closes the connection of a malformed-URL request completed during the stop, without waiting for the grace", async () => {
    const port = await freePort();
    const api = start({ PGN_API_PORT: String(port), PGN_SHUTDOWN_GRACE_S: "4" });
    await api.listening;
    const client = await halfSend(port, "GET /%E0%A4%A HTTP/1.1\r\nHost: 127.0.0.1\r\n");
    await sleep(100);
    const signalled = Date.now();
    api.child.kill("SIGTERM");
    await sleep(300);
    client.write("\r\n"); // the headers finish 300 ms into the stop: Fastify refuses the URL before routing
    const exit = await api.exited;
    expect(client.answer().split("\r\n")[0]).toBe("HTTP/1.1 400 Bad Request");
    expect(client.answer().toLowerCase()).toContain("\r\nconnection: close\r\n");
    expect(exit.code).toBe(0);
    expect(exit.at - signalled).toBeGreaterThanOrEqual(300);
    expect(exit.at - signalled).toBeLessThan(1500);
    expect(exit.stdout).not.toContain("the grace period is over");
  }, 15_000);

  it("delivers a large answer in full to a client that reads slowly during the stop", async () => {
    const port = await freePort();
    const api = start({ PGN_API_PORT: String(port) }, [HARNESS, "big"]);
    await api.listening;
    const socket = connect(port, "127.0.0.1");
    sockets.push(socket);
    socket.on("error", () => socket.destroy());
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    const closed = new Promise<void>((resolve) => socket.on("close", () => resolve()));
    await new Promise<void>((resolve) => socket.once("connect", () => resolve()));
    socket.write("GET /test/big HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
    socket.pause(); // a slow phone: it reads nothing for 1.5 s
    await sleep(100);
    api.child.kill("SIGTERM"); // the answer is still being prepared (300 ms)
    await sleep(1500);
    socket.resume();
    await closed;
    const raw = Buffer.concat(chunks);
    const headEnd = raw.indexOf("\r\n\r\n");
    const head = raw.subarray(0, headEnd).toString("latin1");
    expect(head.split("\r\n")[0]).toBe("HTTP/1.1 200 OK");
    expect(head.toLowerCase()).toContain("\r\nconnection: close");
    expect(raw.length - headEnd - 4).toBe(8 * 1024 * 1024);
    expect(Number(/content-length: (\d+)/i.exec(head)?.[1])).toBe(8 * 1024 * 1024);
    expect((await api.exited).code).toBe(0);
  }, 15_000);

  it("closes the connections of clients still sending once the grace period is over", async () => {
    const port = await freePort();
    const api = start({ PGN_API_PORT: String(port), PGN_SHUTDOWN_GRACE_S: "1" });
    await api.listening;
    const halfHeaders = await halfSend(port, "GET /healthz HTTP/1.1\r\nHost: 127.0.0.1\r\n");
    const halfBody = await halfSend(
      port,
      "POST /anything HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: http://127.0.0.1:5180\r\nX-Pageinator: 1\r\n" +
        'Content-Type: application/json\r\nContent-Length: 1000\r\n\r\n{"headline": ',
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    const signalled = Date.now();
    api.child.kill("SIGTERM");
    const exit = await api.exited;
    expect(exit.code).toBe(0);
    expect(exit.at - signalled).toBeGreaterThanOrEqual(900);
    expect(exit.at - signalled).toBeLessThan(4000);
    expect(exit.stdout).toContain("the grace period is over: closing any connection still open");
    expect(halfHeaders.destroyed || halfHeaders.readableEnded).toBe(true);
    expect(halfBody.destroyed || halfBody.readableEnded).toBe(true);
  }, 15_000);

  it("still prints its line and exits 1, after 5 s, when the close hangs with nothing else pending", async () => {
    const started = Date.now();
    const exit = await start({}, [HARNESS, "hang"]).exited;
    expect(exit.code).toBe(1);
    expect(exit.stderr).toBe("The API did not stop within 5 s of SIGTERM.\n");
    expect(exit.at - started).toBeGreaterThanOrEqual(4500);
  }, 15_000);

  it("exits 1 with a plain line when a close hook fails", async () => {
    const exit = await start({}, [HARNESS, "reject"]).exited;
    expect(exit.code).toBe(1);
    expect(exit.stderr).toBe("The API did not stop cleanly: a close hook failed\n");
  }, 15_000);

  it("is killed at once by a second SIGTERM, with no line", async () => {
    const port = await freePort();
    const api = start({ PGN_API_PORT: String(port), PGN_SHUTDOWN_GRACE_S: "4" });
    await api.listening;
    await halfSend(port, "GET /healthz HTTP/1.1\r\nHost: 127.0.0.1\r\n"); // keeps the first stop waiting
    await sleep(100);
    const signalled = Date.now();
    api.child.kill("SIGTERM");
    await sleep(200);
    api.child.kill("SIGTERM");
    const exit = await api.exited;
    expect(exit.signal).toBe("SIGTERM");
    expect(exit.at - signalled).toBeLessThan(1500);
    expect(exit.stderr).toBe("");
  }, 15_000);
});

describe("a client that drops the connection mid-body", () => {
  it.each(["end", "resetAndDestroy"] as const)(
    "is logged at info, not as a failure of ours (%s)",
    async (how) => {
      const port = await freePort();
      const api = start({ PGN_API_PORT: String(port) });
      await api.listening;
      const client = await halfSend(port, `${FROM_APP_POST}Content-Length: 1000\r\n\r\n{"headline": `);
      await sleep(150);
      if (how === "end") client.end();
      else client.resetAndDestroy();
      await sleep(400);
      api.child.kill("SIGTERM");
      const lines = logLines((await api.exited).stdout);
      expect(
        lines.filter((line) => line.msg === "the request body could not be read").map((line) => line.level),
      ).toEqual([30]);
      expect(lines.filter((line) => line.level >= 50)).toEqual([]);
    },
    15_000,
  );
});

describe("listen errors", () => {
  it("says in one plain line that the port is in use, and exits 1", async () => {
    const port = await freePort();
    const taken = createServer();
    servers.push(taken);
    await new Promise<void>((resolve) => taken.listen(port, "127.0.0.1", resolve));
    const exit = await start({ PGN_API_PORT: String(port) }).exited;
    expect(exit.code).toBe(1);
    expect(exit.stderr).toBe(`The API could not listen on 127.0.0.1:${port}: the port is already in use.\n`);
  }, 15_000);

  it("says in one plain line that this machine has no such address, and exits 1", async () => {
    const exit = await start({ PGN_API_HOST: "192.0.2.1", PGN_API_PORT: String(await freePort()) }).exited;
    expect(exit.code).toBe(1);
    expect(exit.stderr).toMatch(/^The API could not listen on 192\.0\.2\.1:\d+: this machine has no such address\.\n$/);
  }, 15_000);

  it("writes an IPv6 address in brackets", async () => {
    const exit = await start({ PGN_API_HOST: "2001:db8::1", PGN_API_PORT: "28791" }).exited;
    expect(exit.code).toBe(1);
    expect(exit.stderr).toMatch(/^The API could not listen on \[2001:db8::1\]:28791: /);
  }, 15_000);
});
