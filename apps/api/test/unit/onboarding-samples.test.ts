// The test edition's fictional stories (src/modules/onboarding/sample-stories.ts): enough for the profile's 4-page plan.
import { describe, expect, it } from "vitest";
import { SAMPLE_STORIES_EN, sampleStoriesFor } from "../../src/modules/onboarding/sample-stories.ts";

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

describe("sampleStoriesFor", () => {
  it("gives every sample once without a plan", () => {
    expect(sampleStoriesFor("en")).toEqual(SAMPLE_STORIES_EN);
    expect(sampleStoriesFor("mr").every((s) => /[ऀ-ॿ]/.test(s.headline))).toBe(true);
  });

  it("takes the samples again until the plan's stories and words are there, a repeat never the lead", () => {
    const got = sampleStoriesFor("en", { stories: 20, briefs: 4, words: 3000 });
    expect(got.length).toBeGreaterThanOrEqual(24);
    expect(got.reduce((n, s) => n + words(s.body), 0)).toBeGreaterThanOrEqual(3000 * 1.5); // with headroom
    expect(got.slice(SAMPLE_STORIES_EN.length).some((s) => s.priority === 1)).toBe(false);
  });

  it("stops at 60 stories whatever the plan asks", () => {
    expect(sampleStoriesFor("en", { stories: 500, briefs: 0, words: 10 ** 7 })).toHaveLength(60);
  });
});
