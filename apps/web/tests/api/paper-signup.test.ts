/**
 * The real paper sign-up service over a recording fetch: the application POSTed with `X-Pageinator: 1`, a quick sender
 * held until the API's minimum fill time, each refusal turned into its outcome, the confirmation link, and the paper's
 * details read with the API's own schema. Fictional data only.
 */
import { describe, expect, it } from "vitest";
import { CONTACT_MIN_FILL_MS, type PaperSignupRequest } from "@pageinator/contracts";
import { createApiClient } from "../../src/api/client.ts";
import { createApiPaperSignupService } from "../../src/api/paper-signup-service.ts";
import { fakeFetch, json, type Answer } from "./fake-fetch.ts";

const APPLICATION: PaperSignupRequest = {
  paperName: "Kalpitpur Samachar",
  ownerName: "Asha Kalpit",
  email: "asha@example.test",
  language: "mr",
  website: "",
  filledInMs: 60_000,
};

function service(answer: Answer) {
  const { fetch, calls } = fakeFetch(() => answer);
  const waits: number[] = [];
  const signup = createApiPaperSignupService(createApiClient({ fetch }), async (ms) => {
    waits.push(ms);
  });
  return { signup, calls, waits };
}

const refusal = (status: number, code: string, details?: { field: string; message: string }[]) =>
  json(status, { error: { code, message: "m", requestId: "r", ...(details ? { details } : {}) } });

describe("applying", () => {
  it("POSTs the application with X-Pageinator, holding a quick sender until the minimum fill time", async () => {
    const { signup, calls, waits } = service(json(200, { received: true }));
    expect(await signup.apply(APPLICATION)).toEqual({ kind: "sent" });
    expect([calls[0]?.url, calls[0]?.method, calls[0]?.headers.get("X-Pageinator")]).toEqual([
      "/api/v1/signup/paper",
      "POST",
      "1",
    ]);
    expect(waits).toEqual([]);
    await signup.apply({ ...APPLICATION, filledInMs: 1000 });
    expect(waits).toEqual([CONTACT_MIN_FILL_MS + 250 - 1000]);
    expect((calls[1]?.body as { filledInMs: number }).filledInMs).toBe(CONTACT_MIN_FILL_MS + 250);
  });

  it.each([
    [refusal(429, "signup_limit"), { kind: "busy" }],
    [refusal(429, "slow_down"), { kind: "busy" }],
    [refusal(400, "invalid_request", [{ field: "body.email", message: "x" }]), { kind: "invalid", fields: ["email"] }],
    [refusal(500, "server_error"), { kind: "failed" }],
    [new TypeError("Failed to fetch"), { kind: "failed" }],
  ] as const)("turns each refusal into its outcome", async (answer, expected) => {
    expect(await service(answer).signup.apply(APPLICATION)).toEqual(expected);
  });
});

describe("the confirmation link and the paper's details", () => {
  it.each([
    [json(200, { state: "waiting" }), "waiting"],
    [refusal(404, "not_found"), "invalid"],
    [refusal(400, "invalid_request"), "invalid"],
    [refusal(500, "server_error"), "failed"],
  ] as const)("confirms a token", async (answer, expected) => {
    const { signup, calls } = service(answer);
    expect(await signup.confirm("t".repeat(43))).toBe(expected);
    expect([calls[0]?.url, calls[0]?.body]).toEqual(["/api/v1/signup/paper/confirm", { token: "t".repeat(43) }]);
  });

  it("reads the paper's details, and refuses an answer it cannot read", async () => {
    const paper = { name: "Kalpitpur Samachar", languages: ["mr"], primaryLanguage: "mr" };
    const { signup, calls } = service(json(200, paper));
    expect(await signup.paper("o1", "p1")).toEqual({ ok: true, value: paper });
    expect(calls[0]?.url).toBe("/api/v1/orgs/o1/pubs/p1/paper");
    const odd = await service(json(200, { name: 1 })).signup.paper("o1", "p1");
    expect(odd.ok).toBe(false);
  });
});
