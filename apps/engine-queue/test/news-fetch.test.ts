// The news finder's fetch guard (src/news/fetch.ts): which addresses are public, and safeFetch against a local server
// (loopback only: the test lets 127.0.0.1 count as public through the seam, so nothing leaves this machine).
import http from "node:http";
import type { AddressInfo } from "node:net";
import zlib from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FetchRefused, isPublicAddress, NEWS_USER_AGENT, safeFetch, type FetchSeams } from "../src/news/fetch.ts";

describe("isPublicAddress", () => {
  it("refuses private, loopback, link-local, CGNAT, multicast, reserved and documentation addresses", () => {
    for (const ip of [
      "10.1.2.3",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "255.255.255.255",
      "198.18.0.1",
      "192.0.2.1",
      "::",
      "::1",
      "fe80::1",
      "fc00::1",
      "fd12:3456::1",
      "ff02::1",
      "2001:db8::1",
      "2002:a00:1::",
      "not an address",
      "",
    ])
      expect(isPublicAddress(ip), ip).toBe(false);
  });

  it("reads an IPv4 address inside IPv6 (mapped, in either spelling, or compatible) as that address", () => {
    for (const ip of [
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::ffff:10.0.0.1",
      "::ffff:a9fe:a9fe",
      "::10.0.0.1",
      "::ffff:0:7f00:1",
    ])
      expect(isPublicAddress(ip), ip).toBe(false);
    expect(isPublicAddress("::ffff:8.8.8.8")).toBe(true);
    expect(isPublicAddress("::ffff:808:808")).toBe(true);
  });

  it("reads the IPv4 address inside a NAT64 address (64:ff9b::/96, 64:ff9b:1::/96) as that address", () => {
    for (const ip of [
      "64:ff9b::a00:1",
      "64:ff9b::127.0.0.1",
      "64:ff9b::7f00:1",
      "64:ff9b::a9fe:a9fe",
      "64:ff9b::c0a8:101",
      "64:ff9b::",
      "64:ff9b:1::a00:1",
      "64:ff9b:1::169.254.169.254",
      "64:ff9b:1:808:8:800::", // the /48 shape: not read, so refused
    ])
      expect(isPublicAddress(ip), ip).toBe(false);
    for (const ip of ["64:ff9b::808:808", "64:ff9b::8.8.8.8", "64:ff9b::101:101", "64:ff9b:1::808:808"])
      expect(isPublicAddress(ip), ip).toBe(true);
  });

  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111", "2a00:1450::1"])
      expect(isPublicAddress(ip), ip).toBe(true);
  });
});

let server: http.Server;
let port = 0;
const hits: string[] = [];
beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits.push(`${req.url} ${req.headers["user-agent"]}`);
    const path = req.url ?? "/";
    if (path === "/feed") return res.writeHead(200, { "content-type": "application/rss+xml" }).end("<rss/>");
    if (path === "/big") return res.writeHead(200, { "content-type": "text/plain" }).end("x".repeat(5000));
    if (path === "/bomb")
      return res
        .writeHead(200, { "content-type": "text/plain", "content-encoding": "gzip" })
        .end(zlib.gzipSync(Buffer.alloc(1_000_000)));
    if (path === "/gz")
      return res.writeHead(200, { "content-type": "text/plain", "content-encoding": "gzip" }).end(zlib.gzipSync("ok"));
    if (path === "/slow") return; // never answers
    if (path === "/to-private") return res.writeHead(302, { location: "http://inside.test/" }).end();
    if (path === "/to-ftp") return res.writeHead(301, { location: "ftp://feeds.test/x" }).end();
    if (path.startsWith("/loop")) return res.writeHead(307, { location: `/loop${path.length}` }).end();
    if (path === "/hop") return res.writeHead(302, { location: "/feed" }).end();
    if (path === "/html") return res.writeHead(200, { "content-type": "text/html" }).end("<p>");
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

/** feeds.test is this machine; inside.test is a private address; rebind.test answers both. */
const seams: FetchSeams = {
  isPublic: (ip) => ip === "127.0.0.1",
  lookup: (host, _o, cb) => {
    const table: Record<string, string[]> = {
      "feeds.test": ["127.0.0.1"],
      "inside.test": ["10.0.0.7"],
      "rebind.test": ["127.0.0.1", "10.0.0.7"],
    };
    const found = table[host];
    if (!found) return cb(Object.assign(new Error("not found"), { code: "ENOTFOUND" }), []);
    cb(
      null,
      found.map((address) => ({ address, family: 4 })),
    );
  },
};
const at = (path: string, host = "feeds.test") => `http://${host}:${port}${path}`;
const options = { maxBytes: 1000, timeoutMs: 2000 };
const refusal = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof FetchRefused ? e.code : e),
  );

describe("safeFetch", () => {
  it("fetches through the guarded lookup, with the product's User-Agent", async () => {
    const got = await safeFetch(at("/hop"), { ...options, types: ["application/rss+xml"] }, seams);
    expect(got).toMatchObject({ url: at("/feed"), status: 200, contentType: "application/rss+xml" });
    expect(got.body.toString()).toBe("<rss/>");
    expect(hits.at(-1)).toBe(`/feed ${NEWS_USER_AGENT}`);
    expect(NEWS_USER_AGENT).not.toMatch(/@/); // never a person's email
  });

  it("decodes a compressed answer, and counts the decoded bytes against the cap", async () => {
    expect((await safeFetch(at("/gz"), options, seams)).body.toString()).toBe("ok");
    expect(await refusal(safeFetch(at("/bomb"), options, seams))).toBe("fetch.too_large");
  });

  it("refuses a name that answers with a private address, at once or among others (DNS rebinding)", async () => {
    expect(await refusal(safeFetch(at("/feed", "inside.test"), options, seams))).toBe("fetch.private_address");
    expect(await refusal(safeFetch(at("/feed", "rebind.test"), options, seams))).toBe("fetch.private_address");
  });

  it("refuses a private address written as an IP, without the seam's leniency for 127.0.0.1 by default", async () => {
    for (const host of ["10.0.0.7", "[::1]", "[::ffff:127.0.0.1]", "169.254.169.254"])
      expect(await refusal(safeFetch(at("/feed", host), options, seams)), host).toBe("fetch.private_address");
    expect(await refusal(safeFetch(at("/feed", "127.0.0.1"), options))).toBe("fetch.private_address");
  });

  it("checks every redirect again, and stops after three", async () => {
    expect(await refusal(safeFetch(at("/to-private"), options, seams))).toBe("fetch.private_address");
    expect(await refusal(safeFetch(at("/to-ftp"), options, seams))).toBe("fetch.scheme");
    expect(await refusal(safeFetch(at("/loop"), options, seams))).toBe("fetch.redirects");
  });

  it("fetches only http and https addresses without a password", async () => {
    for (const url of ["ftp://feeds.test/x", "file:///etc/passwd", "gopher://x", "http://u:p@feeds.test/", "nonsense"])
      expect(await refusal(safeFetch(url, options, seams)), url).toBe("fetch.scheme");
  });

  it("caps the body, the time, the status and the type", async () => {
    expect(await refusal(safeFetch(at("/big"), options, seams))).toBe("fetch.too_large");
    expect(await refusal(safeFetch(at("/slow"), { ...options, timeoutMs: 200 }, seams))).toBe("fetch.timeout");
    const missing = await safeFetch(at("/missing"), options, seams).catch((e: unknown) => e);
    expect(missing).toBeInstanceOf(FetchRefused);
    expect([(missing as FetchRefused).code, (missing as FetchRefused).status]).toEqual(["fetch.status", 404]);
    expect(await refusal(safeFetch(at("/html"), { ...options, types: ["application/rss+xml"] }, seams))).toBe(
      "fetch.type",
    );
    expect(await refusal(safeFetch(at("/feed", "unknown.test"), options, seams))).toBe("fetch.network");
  });

  it("stops when the caller cancels", async () => {
    const controller = new AbortController();
    const pending = refusal(safeFetch(at("/slow"), { ...options, signal: controller.signal }, seams));
    controller.abort();
    expect(await pending).toBe("fetch.network");
  });
});
