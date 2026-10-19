/**
 * Security honesty (UI005 §28 "Security" row; AC-30 – AC-32).
 */
import { describe, it, expect } from "vitest";
import { screen, within } from "../../src/test/render.tsx";
import { renderPublic } from "./renderPublic.tsx";

const HEADING = "Security posture and current limits";

/**
 * The §17.3 vocabulary. Each entry must be absent as a *claim*; the
 * denial sentences under "What is not true today" are matched separately
 * below, so a term is only searched for outside that block.
 */
const FORBIDDEN_CLAIMS = [
  "SOC 2",
  "SOC2",
  "ISO 27001",
  "ISO27001",
  "GDPR-compliant",
  "HIPAA",
  "PCI",
  "FedRAMP",
  "CCPA-compliant",
  "certified",
  "accredited",
  "bank-grade",
  "military-grade",
  "enterprise-grade",
  "zero-trust",
  "end-to-end encrypted",
];

async function securityMain() {
  const { container } = renderPublic("/security");
  await screen.findByRole("heading", { level: 1, name: HEADING });
  return within(container).getByRole("main");
}

describe("Security claims are truthful and provisional", () => {
  it("makes no certification, audit or attestation claim (AC-30)", async () => {
    const main = await securityMain();

    // Remove the denial block before scanning: those sentences exist to
    // deny the very words they contain.
    const limits = main.querySelector(".pg-public__band--ink");
    expect(limits).not.toBeNull();
    const withoutDenials = (main.textContent ?? "").replace(limits!.textContent ?? "", "");

    for (const term of FORBIDDEN_CLAIMS) {
      expect(withoutDenials.toLowerCase()).not.toContain(term.toLowerCase());
    }
    expect(withoutDenials).not.toMatch(/\b99\.\d+%|\bSLA\b|\buptime\b/i);
  });

  it("renders the limits block with the same weight as design intent (AC-31)", async () => {
    const main = await securityMain();

    const limitsHeading = within(main).getByRole("heading", {
      level: 2,
      name: "What is not true today",
    });
    const intentHeading = within(main).getByRole("heading", {
      level: 2,
      name: "How tenancy is intended to work",
    });

    // Same heading level and same typographic role: neither is fine print.
    expect(limitsHeading.className).toBe(intentHeading.className);

    for (const denial of [
      "No certification, audit, attestation or third-party assessment of any kind.",
      "No penetration test and no compliance programme.",
      "No encryption-at-rest claim, because nothing is at rest.",
      "No availability commitment, no service-level agreement and no incident-response programme.",
      "No data-processing agreement and no sub-processor list, because no data is processed.",
    ]) {
      expect(main).toHaveTextContent(denial);
    }
  });

  it("states that nothing is transmitted or stored and no credential exists (AC-32)", async () => {
    const main = await securityMain();

    expect(main).toHaveTextContent("This build runs entirely in your browser.");
    expect(main).toHaveTextContent("Nothing is transmitted.");
    expect(main).toHaveTextContent(
      "There is no account, credential or session token."
    );
  });

  it("labels the tenancy model as intent rather than an implemented control", async () => {
    const main = await securityMain();
    expect(main).toHaveTextContent(
      "None of it is an implemented control today."
    );
  });

  it("renders no security-theatre imagery", async () => {
    const main = await securityMain();
    // The page geometry figure belongs to the homepage; the security page
    // carries no graphic at all, and certainly no badge or shield.
    expect(main.querySelector("svg")).toBeNull();
    expect(main.querySelector("img")).toBeNull();
    expect(main.textContent ?? "").not.toMatch(/🔒|🛡|✅/u);
  });
});
