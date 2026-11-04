// A fake Claude for the news finder's tests: each method answers from its script (a value, or an error to throw),
// records what it was asked, and reports a fixed usage. No network, no key.
import type { AiUsage } from "@pageinator/contracts";
import type {
  AiClient,
  AiResult,
  DraftInput,
  DraftOut,
  GroupInput,
  GroupOut,
  RankInput,
  RankOut,
  RewriteInput,
} from "../../src/news/ai.ts";

type Answer<I, T> = T | Error | ((input: I) => T | Error);
export type Script = {
  group?: Answer<GroupInput, GroupOut>;
  draft?: Answer<DraftInput, DraftOut>;
  rewrite?: Answer<RewriteInput, DraftOut>;
  rankPhotos?: Answer<RankInput, RankOut>;
};

export const usage = (purpose: AiUsage["purpose"], cost_inr = 2): AiUsage => ({
  purpose,
  model: "claude-opus-5-5",
  input_tokens: 1000,
  output_tokens: 500,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  cost_inr,
});

export class FakeAiClient implements AiClient {
  readonly model = "claude-opus-5-5";
  readonly asked: { method: keyof Script; input: unknown }[] = [];
  readonly #script: Script;
  readonly #cost: number;
  constructor(script: Script, cost = 2) {
    this.#script = script;
    this.#cost = cost;
  }
  #answer<I, T>(method: keyof Script, purpose: AiUsage["purpose"], input: I): Promise<AiResult<T>> {
    this.asked.push({ method, input });
    const scripted = this.#script[method] as Answer<I, T> | undefined;
    if (scripted === undefined) return Promise.reject(new Error(`the fake was not given a ${method} answer`));
    const out = typeof scripted === "function" ? (scripted as (i: I) => T | Error)(input) : scripted;
    if (out instanceof Error) return Promise.reject(out);
    return Promise.resolve({ value: out, usage: usage(purpose, this.#cost) });
  }
  group(input: GroupInput) {
    return this.#answer<GroupInput, GroupOut>("group", "group", input);
  }
  draft(input: DraftInput) {
    return this.#answer<DraftInput, DraftOut>("draft", "draft", input);
  }
  rewrite(input: RewriteInput) {
    return this.#answer<RewriteInput, DraftOut>("rewrite", "rewrite", input);
  }
  rankPhotos(input: RankInput) {
    return this.#answer<RankInput, RankOut>("rankPhotos", "photos", input);
  }
}
