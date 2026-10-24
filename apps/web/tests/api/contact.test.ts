/**
 * The real contact service over a recording fetch: GET /api/v1/contact read with the API's own schema, the message
 * POSTed with `X-Pageinator: 1`, a quick sender held until the API's minimum fill time, and each refusal turned into
 * its own outcome. Fictional data only.
 */
import { describe, expect, it } from "vitest";
import { CONTACT_MIN_FILL_MS, type ContactRequest } from "@pageinator/contracts";
import { createApiClient } from "../../src/api/client.ts";
import { createApiContactService } from "../../src/api/contact-service.ts";
import { fakeFetch, json, type Answer } from "./fake-fetch.ts";

const MESSAGE: ContactRequest = {
  name: "Asha Kalpit",
  email: "asha@example.test",
  intent: "demo",
  language: "en",
  filledInMs: 60_000,
};

function service(answer: Answer) {
  const { fetch, calls } = fakeFetch(() => answer);
  const waits: number[] = [];
  const contact = createApiContactService(createApiClient({ fetch }), async (ms) => {
    waits.push(ms);
  });
  return { contact, calls, waits };
}

const refusal = (status: number, code: string, details?: { field: string; message: string }[]) =>
  json(status, { error: { code, message: "m", requestId: "r", ...(details ? { details } : {}) } });

describe("whether the form is connected", () => {
  it.each([
    [json(200, { connected: true }), "connected"],
    [json(200, { connected: false }), "notConnected"],
    [json(200, { connected: "yes" }), "unknown"],
    [json(500, {}), "unknown"],
    [new TypeError("Failed to fetch"), "unknown"],
  ] as const)("reads GET /api/v1/contact", async (answer, expected) => {
    const { contact, calls } = service(answer);
    expect(await contact.connection()).toBe(expected);
    expect(calls[0]?.url).toBe("/api/v1/contact");
    expect(calls[0]?.method).toBe("GET");
  });
});

describe("sending", () => {
  it("POSTs the message with X-Pageinator, at once when it took longer than the minimum", async () => {
    const { contact, calls, waits } = service(json(200, { received: true }));
    expect(await contact.send(MESSAGE)).toEqual({ kind: "sent" });
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.headers.get("X-Pageinator")).toBe("1");
    expect(calls[0]?.body).toEqual(MESSAGE);
    expect(waits).toEqual([]);
  });

  it("holds a quick sender until the minimum fill time has passed, and says the time it really took", async () => {
    const { contact, calls, waits } = service(json(200, { received: true }));
    await contact.send({ ...MESSAGE, filledInMs: 1000 });
    expect(waits).toEqual([CONTACT_MIN_FILL_MS + 250 - 1000]);
    expect((calls[0]?.body as { filledInMs: number }).filledInMs).toBe(CONTACT_MIN_FILL_MS + 250);
  });

  it.each([
    [refusal(503, "contact_unavailable"), { kind: "unavailable" }],
    [refusal(503, "contact_send_failed"), { kind: "sendFailed" }],
    [refusal(500, "server_error"), { kind: "sendFailed" }],
    [refusal(429, "contact_limit"), { kind: "busy" }],
    [refusal(429, "slow_down"), { kind: "busy" }],
    [refusal(403, "bad_origin"), { kind: "refused" }],
    [refusal(400, "invalid_request", [{ field: "body.email", message: "x" }, { field: "body.intent", message: "y" }]), { kind: "invalid", fields: ["email", "intent"] }],
    [new TypeError("Failed to fetch"), { kind: "failed" }],
  ] as const)("turns each answer into its outcome (%#)", async (answer, outcome) => {
    const { contact } = service(answer);
    expect(await contact.send(MESSAGE)).toEqual(outcome);
  });
});
