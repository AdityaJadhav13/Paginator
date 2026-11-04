// The page editor on the API's side without a database: the gateway client (its signature against the contract's
// vector and a gateway stub that checks it; a gateway that cannot be reached or answers outside its contract), the
// Desk's own words the API says (tools/desk/engine/messages.json), editing.placement's port, and the settings.
import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { type IncomingMessage, type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  EDIT_CALL_FORMAT,
  type EditCall,
  GATEWAY_NONCE_HEADER,
  GATEWAY_SIGNATURE_HEADER,
  GATEWAY_TEST_VECTOR,
  GATEWAY_TIME_HEADER,
} from "@pageinator/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../../src/config.ts";
import { gatewayClient, signature } from "../../src/modules/editor/gateway.ts";
import { MESSAGES, movedHere, placement } from "../../src/modules/editor/views.ts";
import { PASSWORDS } from "./helpers.ts";

const V = GATEWAY_TEST_VECTOR;
const DESK = JSON.parse(
  readFileSync(new URL("../../../../tools/desk/engine/messages.json", import.meta.url), "utf8"),
) as Record<string, string>;

describe("the gateway's signature", () => {
  it("matches the contract's vector", () => {
    expect(signature(V.secret, V.method, V.path, V.time, V.nonce, V.body)).toBe(V.signature);
    expect(signature(V.secret, V.method, V.path, V.time, V.nonce, `${V.body} `)).not.toBe(V.signature);
    expect(signature(V.secret, V.method, V.path, V.time, "f".repeat(32), V.body)).not.toBe(V.signature);
  });
});

const CALL: EditCall = {
  format: EDIT_CALL_FORMAT,
  org_id: "01890a5d-ac96-774b-bcce-b302099a8057",
  pub_id: "01890a5d-ac96-774b-bcce-b302099a8058",
  run_id: "01890a5d-ac96-774b-bcce-b302099a8059",
  edition_key: "2027-01-02",
  run_key: "r-20270102-101500",
  page: 1,
  cmd: "state",
  base_rev: null,
  state: { pages: [], text: null },
};

describe("the gateway client", () => {
  let server: Server;
  let url = "";
  const seen: { path: string; good: boolean }[] = [];
  let answer: unknown = { ok: true, result: { rev: 4 }, edits: [], text: null };

  const nonces = new Set<string>();
  /** The gateway's own check: the time within 60 s, a nonce not seen before and the signature over the exact bytes. */
  const verified = (request: IncomingMessage, body: Buffer) => {
    const time = String(request.headers[GATEWAY_TIME_HEADER] ?? "");
    const nonce = String(request.headers[GATEWAY_NONCE_HEADER] ?? "");
    const given = Buffer.from(String(request.headers[GATEWAY_SIGNATURE_HEADER] ?? ""), "hex");
    const want = Buffer.from(signature(V.secret, request.method ?? "", request.url ?? "", time, nonce, body), "hex");
    const fresh = Math.abs(Date.now() / 1000 - Number(time)) <= 60 && /^[0-9a-f]{32}$/.test(nonce);
    const good = fresh && !nonces.has(nonce) && given.length === want.length && timingSafeEqual(given, want);
    if (good) nonces.add(nonce);
    return good;
  };

  beforeAll(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const body = Buffer.concat(chunks);
        const good = verified(request, body);
        seen.push({ path: request.url ?? "", good });
        if (!good) return response.writeHead(401).end();
        if (request.url?.startsWith("/v1/glyphs/")) {
          if (request.url.includes("/000000000000000000000000")) return response.writeHead(404).end();
          return response.end(JSON.stringify({ upem: 1000, glyphs: { "3": "M0 0L10 0Z" } }));
        }
        if (request.url?.startsWith("/v1/raster/")) return response.end(Buffer.from([0xff, 0xd8, 0xff]));
        expect(createHash("sha256").update(body).digest("hex")).toHaveLength(64);
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(answer));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("signs its calls, and reads the answers of the contract", async () => {
    const g = gatewayClient(url, V.secret);
    expect(await g.call(CALL)).toEqual({ ok: true, result: { rev: 4 }, edits: [], text: null });
    const face = "0123456789abcdef01234567";
    expect(await g.glyphs(CALL.org_id, CALL.pub_id, face, "3,4")).toEqual({
      upem: 1000,
      glyphs: { "3": "M0 0L10 0Z" },
    });
    expect(await g.glyphs(CALL.org_id, CALL.pub_id, "0".repeat(24), "3")).toBeNull();
    expect([...(await g.raster(CALL.org_id, CALL.pub_id, face))!]).toEqual([0xff, 0xd8, 0xff]);
    expect(seen.every((s) => s.good)).toBe(true);
    expect(seen.map((s) => s.path)).toContain(`/v1/glyphs/${CALL.org_id}/${CALL.pub_id}/${face}?ids=3,4`);
  });

  it("sends a nonce of its own with each call, so the same call twice at once is no replay", async () => {
    const at = Date.now();
    const g = gatewayClient(url, V.secret, () => at); // the same second, the same body
    const both = await Promise.all([g.call(CALL), g.call(CALL)]);
    expect(both.map((a) => a.ok)).toEqual([true, true]);
  });

  it("is unavailable when its signature is refused, the answer is not the contract's, or nobody answers", async () => {
    const wrong = gatewayClient(url, "ff".repeat(32));
    await expect(wrong.call(CALL)).rejects.toMatchObject({ code: "editor_unavailable" });
    answer = { ok: true, result: {} };
    await expect(gatewayClient(url, V.secret).call(CALL)).rejects.toMatchObject({ code: "editor_unavailable" });
    // a clock 2 minutes off: the gateway refuses it
    const late = gatewayClient(url, V.secret, () => Date.now() - 120_000);
    await expect(late.call(CALL)).rejects.toMatchObject({ code: "editor_unavailable" });
    const nobody = gatewayClient("http://127.0.0.1:9", V.secret);
    await expect(nobody.call(CALL)).rejects.toMatchObject({ code: "editor_unavailable" });
  });
});

describe("the Desk's words and rules", () => {
  it("are the Desk's own messages", () => {
    for (const [code, text] of Object.entries(MESSAGES)) expect(DESK[code], code).toBe(text);
    expect(movedHere(3)).toEqual({
      text: "A story was moved here from page 3: check its place and save the page.",
      code: "m.save.movedHere",
      params: { page: 3 },
    });
  });

  it("note the placement problems as editing.placement does", () => {
    expect(placement([{ kind: "outside" }, { kind: "overlap" }, { kind: "short" }])).toEqual(["outside", "overlap"]);
    expect([placement(null), placement(undefined), placement("x"), placement([3])]).toEqual([
      null,
      null,
      ["unreadable"],
      ["unreadable"],
    ]);
    expect(placement([])).toEqual([]);
  });
});

describe("the gateway's settings", () => {
  const load = (env: Record<string, string>) => loadConfig({ ...PASSWORDS, ...env });
  it("are off by default, and go together", () => {
    expect(load({}).gateway).toBeUndefined();
    expect(load({ PGN_GATEWAY_URL: "http://127.0.0.1:8790", PGN_GATEWAY_SECRET: V.secret }).gateway).toEqual({
      url: "http://127.0.0.1:8790",
      secret: V.secret,
    });
    expect(() => load({ PGN_GATEWAY_URL: "http://127.0.0.1:8790" })).toThrow(ConfigError);
    expect(() => load({ PGN_GATEWAY_URL: "http://127.0.0.1:8790", PGN_GATEWAY_SECRET: "ab".repeat(16) })).toThrow(
      ConfigError,
    );
    expect(() => load({ PGN_GATEWAY_URL: "http://127.0.0.1:8790/v1", PGN_GATEWAY_SECRET: V.secret })).toThrow(
      ConfigError,
    );
    // plain http only to this machine
    expect(() => load({ PGN_GATEWAY_URL: "http://10.0.1.5:8790", PGN_GATEWAY_SECRET: V.secret })).toThrow(ConfigError);
    expect(load({ PGN_GATEWAY_URL: "https://10.0.1.5:8790", PGN_GATEWAY_SECRET: V.secret }).gateway?.url).toBe(
      "https://10.0.1.5:8790",
    );
  });
});
