/**
 * UI001 demonstration fixtures.
 *
 * All data is STATIC, DETERMINISTIC, and FICTIONAL.
 * fixtureKind: "ui001-demo-only" — these fixtures define no production schema.
 * They must NEVER be imported from src/ui/** (durable foundation code).
 *
 * See UI001 §10 for fixture definitions and qualification requirements.
 */

export const FIXTURE_KIND = "ui001-demo-only" as const;

// ── Organization fixture ────────────────────────────────────────────

export interface OrgFixture {
  readonly fixtureKind: typeof FIXTURE_KIND;
  readonly id: string;
  readonly name: string;
  readonly qualification: string;
}

export const ORG_SAHYADRI: OrgFixture = {
  fixtureKind: FIXTURE_KIND,
  id: "org-demo-sahyadri",
  name: "Sahyadri Media Cooperative",
  qualification: "Fictional organization context",
} as const;

// ── Publication fixtures ────────────────────────────────────────────

export interface PublicationFixture {
  readonly fixtureKind: typeof FIXTURE_KIND;
  readonly id: string;
  readonly name: string;
  readonly locale: string;
  readonly direction: "ltr" | "rtl";
  readonly qualification: string;
}

export const PUB_PUNE_DAILY: PublicationFixture = {
  fixtureKind: FIXTURE_KIND,
  id: "pub-demo-pune-daily",
  name: "Pune Daily Ledger",
  locale: "en-IN",
  direction: "ltr",
  qualification: "Fictional publication context",
} as const;

export const PUB_URDU_EVENING: PublicationFixture = {
  fixtureKind: FIXTURE_KIND,
  id: "pub-demo-urdu-evening",
  name: "Deccan Evening Record",
  locale: "ur-IN",
  direction: "rtl",
  qualification: "Fictional publication context; RTL display demonstration",
} as const;

// ── Capability fixtures ─────────────────────────────────────────────

export interface CapabilityFixture {
  readonly fixtureKind: typeof FIXTURE_KIND;
  readonly capability: string;
  readonly description: string;
  readonly allowed: true;
  readonly disclaimer: string;
}

export interface DeniedCapabilityFixture {
  readonly fixtureKind: typeof FIXTURE_KIND;
  readonly capability: string;
  readonly description: string;
  readonly allowed: false;
  readonly denialReason: string;
  readonly disclaimer: string;
}

/**
 * Required disclaimer text for all capability fixtures.
 * Must appear on every capability card. (UI001 §4 rule 5, §10.2)
 */
export const CAPABILITY_DISCLAIMER =
  "Demonstration only — production authorization is not evaluated here" as const;

export const CAP_EDITION_VIEW: CapabilityFixture = {
  fixtureKind: FIXTURE_KIND,
  capability: "demo.edition.view",
  description: "View this demonstration edition",
  allowed: true,
  disclaimer: CAPABILITY_DISCLAIMER,
} as const;

export const CAP_EDITION_EDIT: CapabilityFixture = {
  fixtureKind: FIXTURE_KIND,
  capability: "demo.edition.edit-intention",
  description: "Edit a fictional intention",
  allowed: true,
  disclaimer: CAPABILITY_DISCLAIMER,
} as const;

export const CAP_CANDIDATE_APPROVE_DENIED: DeniedCapabilityFixture = {
  fixtureKind: FIXTURE_KIND,
  capability: "demo.candidate.approve",
  description: "Approval demonstration unavailable for this role",
  allowed: false,
  denialReason: "Approval demonstration unavailable for this role",
  disclaimer: CAPABILITY_DISCLAIMER,
} as const;

export const CAP_PUBLICATION_SETTINGS_DENIED: DeniedCapabilityFixture = {
  fixtureKind: FIXTURE_KIND,
  capability: "demo.publication.settings",
  description: "Settings demonstration unavailable in this context",
  allowed: false,
  denialReason: "Settings demonstration unavailable in this context",
  disclaimer: CAPABILITY_DISCLAIMER,
} as const;

// ── Revision, proof, and candidate identifiers ─────────────────────
//
// These strings are opaque display examples and define no production format.

export const REV_018 = "demo-rev-018" as const;
export const REV_019 = "demo-rev-019" as const;
export const PROOF_018_A = "demo-proof-018-a" as const;
export const CANDIDATE_042 = "demo-candidate-042" as const;
