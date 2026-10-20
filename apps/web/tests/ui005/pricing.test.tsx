/**
 * Pricing honesty (UI005 §28 "Pricing" row; AC-22 – AC-27).
 */
import { describe, it, expect } from "vitest";
import { screen, within } from "../../src/test/render.tsx";
import { renderPublic } from "./renderPublic.tsx";

const HEADING = "Illustrative packaging";

async function pricingMain() {
  const { container } = renderPublic("/pricing");
  await screen.findByRole("heading", { level: 1, name: HEADING });
  return within(container).getByRole("main");
}

describe("Pricing presents a hypothesis, not an offer", () => {
  it("renders exactly three tiers, each with the illustrative caption (AC-23)", async () => {
    const main = await pricingMain();
    const tiers = main.querySelectorAll(".pg-public__tier");

    expect(tiers).toHaveLength(3);
    for (const tier of tiers) {
      expect(tier).toHaveTextContent("Illustrative — not an offer");
    }
  });

  it('renders "Not priced" in every tier and no price anywhere (AC-24)', async () => {
    const main = await pricingMain();
    const tiers = main.querySelectorAll(".pg-public__tier");

    for (const tier of tiers) {
      expect(tier).toHaveTextContent("Not priced");
    }

    const text = main.textContent ?? "";
    expect(text).not.toMatch(/[$€£₹¥]/);
    expect(text).not.toMatch(/%/);
    expect(text).not.toMatch(/\d/);
    expect(text).not.toMatch(/\bper (seat|month|year|user|edition)\b/i);
    // A price prefix, not the ordinary English word: digits and currency
    // symbols are already banned outright above.
    expect(text).not.toMatch(/\bfrom\s*[$€£₹¥\d]/i);
    expect(text).not.toMatch(/\bstarting at\b/i);
    expect(text.toLowerCase()).not.toContain("free");
  });

  it("puts the open-decision block before the first tier (AC-22)", async () => {
    const main = await pricingMain();
    const openBlock = within(main).getByRole("heading", {
      level: 2,
      name: "Packaging is an open decision",
    });
    const firstTier = main.querySelector(".pg-public__tier");

    expect(firstTier).not.toBeNull();
    expect(
      openBlock.compareDocumentPosition(firstTier!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("offers no purchase, selection or trial control (AC-25)", async () => {
    const main = await pricingMain();

    for (const control of main.querySelectorAll("a, button")) {
      const name = control.textContent ?? "";
      expect(name).not.toMatch(
        /\b(choose|select|buy|subscribe|upgrade|get started|start (a )?(free )?trial|checkout)\b/i
      );
    }
    expect(main.querySelector('input[type="number"]')).toBeNull();
    expect(main.querySelector("form")).toBeNull();
  });

  it("gives every tier identical treatment, with none elevated (AC-26)", async () => {
    const main = await pricingMain();
    const tiers = Array.from(main.querySelectorAll(".pg-public__tier"));

    // Identical class lists: no tier may carry a highlight modifier.
    const classLists = tiers.map((tier) => tier.className);
    expect(new Set(classLists).size).toBe(1);

    const text = main.textContent ?? "";
    expect(text).not.toMatch(/most popular|recommended|best value|popular choice/i);
  });

  it("states that packaging, buyer and price are open and nothing can be bought (AC-27)", async () => {
    const main = await pricingMain();

    expect(main).toHaveTextContent("Nothing on this page is purchasable.");
    expect(main).toHaveTextContent(
      "Who pays for Pageinator, what a subscription would include and what it would cost are not decided."
    );
    expect(main).toHaveTextContent("This build has no payment capability.");
    expect(main).toHaveTextContent("What is not being offered");
  });
});
