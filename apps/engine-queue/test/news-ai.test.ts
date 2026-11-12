// The news finder's Claude client (src/news/ai.ts) against recorded-shape answers through the SDK's fetch seam (no
// network, no real key): the request it sends, stop_reason read before content, a fallback's answer, typed errors;
// and the budget guard and the rupee cost.
import { describe, expect, it } from "vitest";
import { AiStop, AnthropicAi, Budget, costInr, retryable } from "../src/news/ai.ts";
import { FakeAiClient } from "./news/fake-ai.ts";

type Sent = { url: string; headers: Headers; body: Record<string, unknown> };

/** One streamed answer: its text blocks (a {fallback} entry is a switch of model), its stop reason and usage. */
function answer(
  blocks: (string | { fallback: string })[],
  stop: string,
  extra: Record<string, unknown> = {},
): Response {
  const events: unknown[] = [
    {
      type: "message_start",
      message: {
        id: "msg_fictional",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1000, output_tokens: 1, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 },
      },
    },
  ];
  blocks.forEach((b, index) => {
    if (typeof b === "string") {
      events.push({ type: "content_block_start", index, content_block: { type: "text", text: "" } });
      events.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: b } });
    } else {
      events.push({
        type: "content_block_start",
        index,
        content_block: {
          type: "fallback",
          from: { model: "claude-opus-5-5" },
          to: { model: b.fallback },
          trigger: { type: "refusal", category: "cyber" },
        },
      });
    }
    events.push({ type: "content_block_stop", index });
  });
  events.push({
    type: "message_delta",
    delta: { stop_reason: stop, stop_sequence: null, ...extra },
    usage: { output_tokens: 500 },
  });
  events.push({ type: "message_stop" });
  const sse = events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function client(reply: () => Response) {
  const sent: Sent[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    sent.push({
      url,
      headers: new Headers(init.headers),
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    });
    return reply();
  }) as unknown as typeof globalThis.fetch;
  return { ai: new AnthropicAi({ apiKey: "sk-fictional", model: "claude-opus-5-5", inrPerUsd: 88, fetch }), sent };
}

const draftInput = {
  title: "Sundarpur dam",
  language: "mr" as const,
  length: "short" as const,
  houseStyle: "Short sentences. Numbers in Marathi digits.",
  sources: [{ site: "The Fictional Gazette", title: "Dam opened", text: "The gates were opened." }],
};
const stopOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof AiStop ? [e.code, e.usage?.purpose ?? null] : e),
  );

describe("the Claude client", () => {
  it("sends structured output, effort, the cached system prompt and house style, and the default fallback", async () => {
    const { ai, sent } = client(() => answer(['{"headline":"धरण","body":"दरवाजे उघडले."}'], "end_turn"));
    const got = await ai.draft(draftInput);
    expect(got.value).toEqual({ headline: "धरण", body: "दरवाजे उघडले." });
    expect(got.usage).toEqual({
      purpose: "draft",
      model: "claude-opus-5-5",
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_tokens: 2000,
      cache_write_tokens: 0,
      // (1000 × 4 + 500 × 20 + 2000 × 0.2) / 1e6 dollars × 88
      cost_inr: 1.2672,
    });
    const [request] = sent;
    expect(request?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(request?.headers.get("anthropic-beta")).toBe("server-side-fallback-2026-07-01");
    const body = request?.body ?? {};
    expect(body).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", stream: true });
    expect(body).not.toHaveProperty("thinking");
    expect(body).not.toHaveProperty("temperature");
    const config = body["output_config"] as { effort: string; format: { type: string; schema: object } };
    expect(config.effort).toBe("medium");
    expect(config.format.type).toBe("json_schema");
    expect(config.format.schema).toMatchObject({ type: "object", required: ["headline", "body"] });
    const system = body["system"] as { text: string; cache_control?: unknown }[];
    expect(system).toHaveLength(2);
    expect(system[0]?.cache_control).toBeUndefined();
    expect(system[1]).toMatchObject({ cache_control: { type: "ephemeral" } });
    expect(system[1]?.text).toContain("Numbers in Marathi digits");
  });

  it("asks for grouping and photos at low effort, the photos as image addresses", async () => {
    const { ai, sent } = client(() => answer(['{"order":[1,0]}'], "end_turn"));
    await ai.rankPhotos({
      title: "Dam",
      photos: [
        { thumbUrl: "https://upload.example/a.jpg", title: "a" },
        { thumbUrl: "https://upload.example/b.jpg", title: "b" },
      ],
    });
    const body = sent[0]?.body ?? {};
    expect((body["output_config"] as { effort: string }).effort).toBe("low");
    const content = (body["messages"] as { content: { type: string; source?: unknown }[] }[])[0]?.content ?? [];
    expect(content.filter((c) => c.type === "image").map((c) => c.source)).toEqual([
      { type: "url", url: "https://upload.example/a.jpg" },
      { type: "url", url: "https://upload.example/b.jpg" },
    ]);
  });

  it("reads a refusal and a reply cut short from stop_reason, keeping what they cost", async () => {
    const refused = client(() =>
      answer(['{"head'], "refusal", { stop_details: { type: "refusal", category: "cyber" } }),
    );
    expect(await stopOf(refused.ai.draft(draftInput))).toEqual(["ai.refused", "draft"]);
    const cut = client(() => answer(['{"headline":"धरण","bo'], "max_tokens"));
    expect(await stopOf(cut.ai.draft(draftInput))).toEqual(["ai.max_tokens", "draft"]);
    const odd = client(() => answer(['{"headline":1}'], "end_turn"));
    expect(await stopOf(odd.ai.draft(draftInput))).toEqual(["ai.error", "draft"]);
  });

  it("reads only the answer after a fallback's switch, priced at the dearer model", async () => {
    const { ai } = client(() =>
      answer(['{"headline":"half', { fallback: "claude-opus-4-8" }, '{"headline":"H","body":"B"}'], "end_turn"),
    );
    const got = await ai.draft(draftInput);
    expect(got.value).toEqual({ headline: "H", body: "B" });
    expect(got.usage.model).toBe("claude-opus-4-8");
    expect(got.usage.cost_inr).toBe(
      costInr(["claude-opus-4-8"], { input: 1000, output: 500, cacheRead: 2000, cacheWrite: 0 }, 88),
    );
  });

  it("throws rate limits, overloads and server errors as they are (the queue retries); others are ai.error", async () => {
    const status = (code: number, type: string) => () =>
      new Response(JSON.stringify({ type: "error", error: { type, message: "fictional" } }), {
        status: code,
        headers: { "content-type": "application/json" },
      });
    for (const [code, type] of [
      [429, "rate_limit_error"],
      [529, "overloaded_error"],
      [500, "api_error"],
    ] as const) {
      const thrown = await client(status(code, type))
        .ai.draft(draftInput)
        .catch((e: unknown) => e);
      expect(retryable(thrown), String(code)).toBe(true);
    }
    for (const [code, type] of [
      [400, "invalid_request_error"],
      [401, "authentication_error"],
      [404, "not_found_error"],
    ] as const)
      expect(await stopOf(client(status(code, type)).ai.draft(draftInput)), String(code)).toEqual(["ai.error", null]);
  }, 20_000);
});

describe("the budget", () => {
  it("makes no call with no client, or once the day's budget is spent", async () => {
    const ai = new FakeAiClient({ rankPhotos: { order: [0] } }, 30);
    expect(await stopOf(new Budget(null, 100).run((c) => c.rankPhotos({ title: "", photos: [] })))).toEqual([
      "ai.off",
      null,
    ]);
    expect(await stopOf(new Budget(ai, 0).run((c) => c.rankPhotos({ title: "", photos: [] })))).toEqual([
      "ai.cap",
      null,
    ]);
    const budget = new Budget(ai, 50);
    await budget.run((c) => c.rankPhotos({ title: "", photos: [] }));
    await budget.run((c) => c.rankPhotos({ title: "", photos: [] })); // 20 left before it: allowed, overshoots
    expect(await stopOf(budget.run((c) => c.rankPhotos({ title: "", photos: [] })))).toEqual(["ai.cap", null]);
    expect(budget.usage.map((u) => u.cost_inr)).toEqual([30, 30]);
    expect(ai.asked).toHaveLength(2);
  });

  it("counts what a refused call cost", async () => {
    const { ai } = client(() => answer([""], "refusal"));
    const budget = new Budget(ai, 100);
    await budget.run((c) => c.draft(draftInput)).catch(() => {});
    expect(budget.usage.map((u) => u.purpose)).toEqual(["draft"]);
  });

  it("prices an unknown model as the dearest", () => {
    const tokens = { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 };
    expect(costInr(["claude-opus-5-5"], tokens, 88)).toBe(352);
    expect(costInr(["claude-unknown-9"], tokens, 88)).toBe(880);
  });
});
