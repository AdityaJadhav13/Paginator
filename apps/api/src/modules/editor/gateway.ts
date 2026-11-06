// The API's client of the edit gateway (packages/contracts/src/editor.ts; docs/product/10-l2-newsroom-plan.md §2.4):
// every request signed with HMAC-SHA256 over gatewaySigningText (method, path with query, Unix time, a random nonce,
// the body's SHA-256), the secret given as hex. A gateway that cannot be reached, answers what is not its contract, or refuses the
// signature is editor_unavailable (503) to the web; the engine's own refusals come back as EditAnswer.
import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  EditAnswer,
  type EditCall,
  GATEWAY_NONCE_HEADER,
  GATEWAY_SIGNATURE_HEADER,
  GATEWAY_TIME_HEADER,
  GlyphOutlines,
  PressTestPage,
  gatewaySigningText,
} from "@pageinator/contracts";
import { ApiError } from "../../http/errors.ts";

/** The Desk's longest wait (editing.py OPEN_TIMEOUT_S: the first open of a page may measure its stories). */
export const CALL_TIMEOUT_MS = 900_000;
const FILE_TIMEOUT_MS = 30_000;
/** The press test page: a cold make takes seconds (6–60 s measured), then the gateway keeps it. Its own limits (engine
 * 300 s, check 300 s) are longer, so a stuck make is 503 here while the gateway finishes and keeps it for the next try. */
const PRESS_TEST_TIMEOUT_MS = 300_000;

export type Gateway = {
  call(call: EditCall): Promise<EditAnswer>;
  glyphs(org: string, pub: string, face: string, ids: string): Promise<GlyphOutlines | null>;
  raster(org: string, pub: string, key: string): Promise<Buffer | null>;
  /** The G2 press test page (print-profiles.ts); its 500 {"error"} is editor_unavailable with that reason. */
  pressTest(): Promise<PressTestPage>;
};

/** The X-Pgn-Signature of a request. */
export function signature(
  secretHex: string,
  method: string,
  path: string,
  time: string,
  nonce: string,
  body: Buffer | string,
) {
  const bodySha = createHash("sha256").update(body).digest("hex");
  return createHmac("sha256", Buffer.from(secretHex, "hex"))
    .update(gatewaySigningText(method, path, time, nonce, bodySha))
    .digest("hex");
}

const unavailable = (why: string) => Object.assign(new ApiError("editor_unavailable"), { reason: why });

export function gatewayClient(url: string, secretHex: string, now: () => number = Date.now): Gateway {
  async function send(method: "GET" | "POST", path: string, body: string, timeoutMs: number) {
    const time = String(Math.floor(now() / 1000));
    const nonce = randomBytes(16).toString("hex");
    try {
      return await fetch(new URL(path, url), {
        method,
        headers: {
          [GATEWAY_TIME_HEADER]: time,
          [GATEWAY_NONCE_HEADER]: nonce,
          [GATEWAY_SIGNATURE_HEADER]: signature(secretHex, method, path, time, nonce, body),
          ...(method === "POST" ? { "content-type": "application/json" } : {}),
        },
        ...(method === "POST" ? { body } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw unavailable(error instanceof Error ? error.message : String(error));
    }
  }
  const file = (org: string, pub: string, name: string) =>
    `/${encodeURIComponent(org)}/${encodeURIComponent(pub)}/${name}`;
  return {
    async call(call) {
      const reply = await send("POST", "/v1/call", JSON.stringify(call), CALL_TIMEOUT_MS);
      const parsed = EditAnswer.safeParse(await reply.json().catch(() => null));
      if (!parsed.success) throw unavailable(`the gateway answered ${reply.status} outside its contract`);
      return parsed.data;
    },
    async glyphs(org, pub, face, ids) {
      const reply = await send("GET", `/v1/glyphs${file(org, pub, face)}?ids=${ids}`, "", FILE_TIMEOUT_MS);
      if (reply.status === 404) return null;
      const parsed = GlyphOutlines.safeParse(reply.ok ? await reply.json().catch(() => null) : null);
      if (!parsed.success) throw unavailable(`the gateway answered ${reply.status} for glyphs`);
      return parsed.data;
    },
    async raster(org, pub, key) {
      const reply = await send("GET", `/v1/raster${file(org, pub, `${key}.jpg`)}`, "", FILE_TIMEOUT_MS);
      if (reply.status === 404) return null;
      if (!reply.ok) throw unavailable(`the gateway answered ${reply.status} for a raster`);
      try {
        return Buffer.from(await reply.arrayBuffer());
      } catch (error) {
        throw unavailable(error instanceof Error ? error.message : String(error));
      }
    },
    async pressTest() {
      const reply = await send("GET", "/v1/press-test", "", PRESS_TEST_TIMEOUT_MS);
      const body: unknown = await reply.json().catch(() => null);
      const parsed = PressTestPage.safeParse(reply.ok ? body : null);
      if (parsed.success) return parsed.data;
      const said = (body as { error?: unknown } | null)?.error;
      throw unavailable(
        `the gateway answered ${reply.status} for the press test${typeof said === "string" ? `: ${said}` : ""}`,
      );
    },
  };
}
