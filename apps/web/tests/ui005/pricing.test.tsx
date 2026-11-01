/** Pricing honesty (03 §4.2 /pricing): pilot pricing by conversation; no price, plan, tier, trial or purchase control. */
import { describe, it, expect } from "vitest";
import { screen, within } from "../../src/test/render.tsx";
import { text } from "../../src/features/public/content.ts";
import { LANGUAGES, renderPublic } from "./renderPublic.tsx";

for (const language of LANGUAGES) {
  describe(`/pricing in ${language}`, () => {
    async function pricingMain() {
      const { container } = renderPublic("/pricing", "signed-out", language);
      await screen.findByRole("heading", { level: 1, name: text("pricing-title", language) });
      return within(container).getByRole("main");
    }

    it("says it is not for sale, pricing for a pilot is by conversation, and plans come after the pilot", async () => {
      const main = await pricingMain();
      expect(main).toHaveTextContent(text("pricing-lead", language));
      expect(main).toHaveTextContent(text("pricing-later", language));
      expect(main).toHaveTextContent(text("pricing-excluded-body", language));
    });

    it("shows no price, figure, currency or per-unit wording", async () => {
      const main = await pricingMain();
      const shown = main.textContent ?? "";
      expect(shown).not.toMatch(/[$€£₹¥%]|[0-9०-९]/);
      if (language === "en") {
        expect(shown).not.toMatch(/\bper (seat|month|year|user|edition)\b|\bfree\b|\btrial\b|starting at/i);
        expect(shown).not.toMatch(/most popular|recommended|best value/i);
      }
    });

    it("offers no purchase, selection or trial control, and no form", async () => {
      const main = await pricingMain();
      for (const control of main.querySelectorAll("a, button")) {
        expect(control.textContent ?? "").not.toMatch(/\b(choose|select|buy|subscribe|upgrade|get started|trial|checkout)\b/i);
      }
      expect(main.querySelector("form, input")).toBeNull();
      expect(main.querySelector(".pg-public__tier")).toBeNull();
    });
  });
}
