/** Security honesty (03 §4.2 /security): true today, planned, and not true today, kept apart and of equal weight. */
import { describe, it, expect } from "vitest";
import { screen, within } from "../../src/test/render.tsx";
import { text } from "../../src/features/public/content.ts";
import { LANGUAGES, contactAnswered, renderPublic } from "./renderPublic.tsx";

const FORBIDDEN_CLAIMS = [
  "SOC 2",
  "ISO 27001",
  "GDPR-compliant",
  "HIPAA",
  "PCI",
  "FedRAMP",
  "certified",
  "accredited",
  "bank-grade",
  "military-grade",
  "enterprise-grade",
  "zero-trust",
  "end-to-end encrypted",
];

async function securityMain(language: "en" | "mr" = "en", connection: "connected" | "notConnected" = "connected") {
  const { container, environment } = renderPublic("/security", "signed-out", language);
  environment.contactController.setConnection(connection);
  await screen.findByRole("heading", { level: 1, name: text("security-title", language) });
  await contactAnswered(environment);
  return within(container).getByRole("main");
}

describe("/security", () => {
  it("makes no certification or compliance claim outside the denials", async () => {
    const main = await securityMain();
    const limits = main.querySelector(".pg-public__band--ink:not(.pg-public__closing)");
    expect(limits).not.toBeNull();
    const withoutDenials = (main.textContent ?? "").replace(limits?.textContent ?? "", "");
    for (const term of FORBIDDEN_CLAIMS) expect(withoutDenials.toLowerCase()).not.toContain(term.toLowerCase());
    expect(withoutDenials).not.toMatch(/\b99\.\d+%|\bSLA\b|\buptime\b/i);
  });

  for (const language of LANGUAGES) {
    it(`keeps true, planned and not-true apart, with the same heading weight, in ${language}`, async () => {
      const main = await securityMain(language);
      const headings = ["security-true-title", "security-plan-title", "security-limits-title"].map((id) =>
        within(main).getByRole("heading", { level: 2, name: text(id, language) }),
      );
      expect(new Set(headings.map((heading) => heading.className)).size).toBe(1);
      for (const id of ["security-limit-hosting", "security-limit-assessment", "security-limit-testing", "security-limit-encryption", "security-limit-availability", "security-limit-processing"]) {
        expect(main).toHaveTextContent(text(id, language));
      }
      await within(main).findByText(text("security-contact", language));
      for (const id of ["security-separate", "security-audit", "security-two-step", "security-contact"]) {
        expect(main).toHaveTextContent(text(id, language));
      }
      expect(main).toHaveTextContent(text("security-india", language));
    });
  }

  it("says hosting in India is planned and that no paper's data is hosted yet", async () => {
    const main = await securityMain();
    expect(main).toHaveTextContent("Hosting in India is planned");
    expect(main).toHaveTextContent("No paper's data is hosted yet");
    expect(main).not.toHaveTextContent(/data (is )?stored in India/i);
  });

  for (const language of LANGUAGES) {
    it(`points a security report to the contact form, intent preset, in ${language}`, async () => {
      const main = await securityMain(language);
      expect(within(main).getByRole("heading", { level: 2, name: text("security-report-title", language) })).toBeInTheDocument();
      expect(within(main).getByRole("link", { name: text("cta-report", language) })).toHaveAttribute("href", "/contact?intent=other");
    });

    it(`says nothing of reporting through a form that is not connected, in ${language}`, async () => {
      const main = await securityMain(language, "notConnected");
      expect(main).toHaveTextContent(text("security-contact-off", language));
      expect(main).not.toHaveTextContent(text("security-report-title", language));
      expect(main).not.toHaveTextContent(text("security-report-body", language));
      expect(within(main).queryByRole("link", { name: text("cta-report", language) })).toBeNull();
    });
  }

  it("shows no security-theatre imagery", async () => {
    const main = await securityMain();
    expect(main.querySelector("svg, img")).toBeNull();
    expect(main.textContent ?? "").not.toMatch(/🔒|🛡|✅/u);
  });
});
