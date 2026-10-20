/**
 * UI005 public content model (§19.1).
 *
 * Every user-visible sentence on the five public surfaces lives here as a
 * typed record carrying the architecture document it traces to. Components
 * read records by id via `t()`; a component that inlines a user-visible
 * sentence violates AC-14.
 *
 * This module exists so claim governance is a diff of one file rather than
 * an audit of six components, and so `tests/ui005/claims.test.ts` can scan
 * every sentence the product says in public (§19.4).
 */

/** The architecture document a claim traces to. */
export type ContentSource =
  | "MASTER_BUILD_SPEC"
  | "PHASE_1_ANALYSIS"
  | "PHASE_15_UI_FIRST"
  | "IMPLEMENTATION_ROADMAP"
  | "DECISION_REGISTER"
  | "UI005_SPEC";

export interface ContentRecord {
  /** Stable, kebab-case. Referenced literally by at least one component. */
  readonly id: string;
  /** The exact rendered sentence or phrase. */
  readonly text: string;
  readonly source: ContentSource;
  /** Where in `source` the claim comes from — e.g. "§5 workflow sentence", "R02". */
  readonly sourceRef: string;
}

const RECORDS: readonly ContentRecord[] = [
  // ── Shared: calls to action ──────────────────────────────────────────
  {
    id: "cta-primary-signed-out",
    text: "Enter the demonstration",
    source: "UI005_SPEC",
    sourceRef: "§20.1 primary CTA table",
  },
  {
    id: "cta-primary-signed-in",
    text: "Open your demonstration workspace",
    source: "UI005_SPEC",
    sourceRef: "§20.1 primary CTA table",
  },
  {
    id: "cta-secondary-workflow",
    text: "See the workflow",
    source: "UI005_SPEC",
    sourceRef: "§20.2 secondary CTA vocabulary",
  },
  {
    id: "cta-secondary-workflow-full",
    text: "Read the full workflow",
    source: "UI005_SPEC",
    sourceRef: "§20.2 secondary CTA vocabulary",
  },
  {
    id: "cta-secondary-pricing",
    text: "Read the packaging note",
    source: "UI005_SPEC",
    sourceRef: "§20.2 secondary CTA vocabulary",
  },
  {
    id: "cta-secondary-security",
    text: "Security posture and limits",
    source: "UI005_SPEC",
    sourceRef: "§20.2 secondary CTA vocabulary",
  },
  {
    id: "cta-secondary-contact",
    text: "Contact",
    source: "UI005_SPEC",
    sourceRef: "§20.2 secondary CTA vocabulary",
  },

  // ── Shared: closing band ─────────────────────────────────────────────
  {
    id: "closing-standing",
    text: "The demonstration",
    source: "UI005_SPEC",
    sourceRef: "§12 region 7",
  },
  {
    id: "closing-title",
    text: "Look at the build itself",
    source: "UI005_SPEC",
    sourceRef: "§12 region 7",
  },
  {
    id: "closing-body",
    text: "It runs entirely in your browser. Nothing is sent, nothing is stored and nothing is charged.",
    source: "DECISION_REGISTER",
    sourceRef: "D10 labeled UI simulation",
  },

  // ── Shared: the standing simulation qualification ────────────────────
  {
    id: "qualification-standing",
    text: "This is a working demonstration. No content is published, composed, validated, or printed by it today.",
    source: "DECISION_REGISTER",
    sourceRef: "D10 no live publishing/backend/AI/payment capability",
  },

  // ── Shared: what actually works today (§7.3) ─────────────────────────
  {
    id: "today-standing",
    text: "Current state",
    source: "UI005_SPEC",
    sourceRef: "§7.3",
  },
  {
    id: "today-title",
    text: "What actually works today",
    source: "UI005_SPEC",
    sourceRef: "§7.3",
  },
  {
    id: "today-lead",
    text: "Three things in this build are real and operable. Everything else is an explicitly labeled placeholder.",
    source: "DECISION_REGISTER",
    sourceRef: "D10 labeled UI simulation",
  },
  {
    id: "today-item-sign-in",
    text: "A fictional sign-in that selects one of two demonstration profiles. No credentials are requested and no account is created.",
    source: "UI005_SPEC",
    sourceRef: "§7.3 item 1",
  },
  {
    id: "today-item-navigation",
    text: "Scoped navigation across two fictional organizations and three fictional publications, one of which reads right to left.",
    source: "UI005_SPEC",
    sourceRef: "§7.3 item 2",
  },
  {
    id: "today-item-placeholders",
    text: "A workspace in which every feature surface is a labeled placeholder naming the unit that will build it.",
    source: "UI005_SPEC",
    sourceRef: "§7.3 item 3",
  },
  {
    id: "today-closing",
    text: "No content is ingested, no edition is generated, no page is composed, no file is validated and nothing is archived.",
    source: "UI005_SPEC",
    sourceRef: "§7.3 closing paragraph",
  },

  // ── Homepage: hero ───────────────────────────────────────────────────
  {
    id: "home-hero-title",
    text: "Newspaper production, end to end",
    source: "PHASE_1_ANALYSIS",
    sourceRef: "R01 newspaper/media B2B production OS",
  },
  {
    id: "home-hero-lead-1",
    text: "Pageinator is being built as one connected production system for newspaper and media organizations.",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§5 workflow sentence",
  },
  {
    id: "home-hero-lead-2",
    text: "It spans authorized discovery, edition generation, browser editing, deterministic validation, press handoff and archive retrieval.",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§5 workflow sentence",
  },

  // ── Homepage: workflow band ──────────────────────────────────────────
  {
    id: "home-workflow-standing",
    text: "The workflow",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§5 workflow sentence",
  },
  {
    id: "home-workflow-title",
    text: "Seven stages, one edition",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§5 workflow sentence",
  },
  {
    id: "home-workflow-lead",
    text: "Each stage below is the shape the product is being built to take. None of them describes what runs today.",
    source: "IMPLEMENTATION_ROADMAP",
    sourceRef: "RM02 no production claims",
  },

  // ── Homepage: structure ──────────────────────────────────────────────
  {
    id: "home-structure-standing",
    text: "Why this is hard",
    source: "UI005_SPEC",
    sourceRef: "§12 region 4",
  },
  {
    id: "home-structure-title",
    text: "A newspaper page is a constraint problem",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§ layout: newspaper columns/linked flows, fixed ad constraints",
  },
  {
    id: "home-structure-body-1",
    text: "A page is not a document. Columns, gutters, linked flows and reserved advertising space constrain every editorial decision before a word is set.",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§ layout: templates/masters/styles, fixed ad constraints",
  },
  {
    id: "home-structure-body-2",
    text: "Pageinator is organized around that structure rather than around a general document canvas. Overset text, headline copyfit and bounded regeneration are the problems it is being built to hold.",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§ layout: overset/continuation, headline/copyfit policy",
  },

  // ── Homepage: deliberate limits ──────────────────────────────────────
  {
    id: "limits-standing",
    text: "Deliberate limits",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§5 non-goals",
  },
  {
    id: "limits-title",
    text: "What Pageinator will not be",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§5 non-goals",
  },
  {
    id: "limit-dashboard-name",
    text: "Not a generic dashboard",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§5 non-goals",
  },
  {
    id: "limit-dashboard-body",
    text: "The unit of work is an edition on a deadline, not a card on a board.",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§5 non-goals",
  },
  {
    id: "limit-indesign-name",
    text: "Not a full InDesign clone",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§5 non-goals",
  },
  {
    id: "limit-indesign-body",
    text: "The browser editor targets newspaper composition, not general-purpose page design.",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§5 non-goals",
  },
  {
    id: "limit-press-name",
    text: "Not automatic press control",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§5 non-goals, manual press handoff",
  },
  {
    id: "limit-press-body",
    text: "Manual press handoff is the proposed pilot. Pageinator never drives a printing press.",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§5 non-goals, manual press handoff",
  },
  {
    id: "limit-republication-name",
    text: "Not unrestricted republication",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§5 non-goals",
  },
  {
    id: "limit-republication-body",
    text: "Every source carries its own permission policy. Discovery is not a licence to publish.",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§ discovery: connector/entitlement policy",
  },
  {
    id: "limit-oracle-name",
    text: "Not a truth oracle",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§5 non-goals",
  },
  {
    id: "limit-oracle-body",
    text: "Relevance signals are explainable rankings. They are not probabilities that a claim is true.",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§ discovery: scores are not truth probabilities",
  },
  {
    id: "limit-crm-name",
    text: "Not an ad-sales CRM",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§5 non-goals",
  },
  {
    id: "limit-crm-body",
    text: "Advertisements arrive as reserved space and fixed artwork, not as a pipeline to be sold against.",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§5 non-goals",
  },

  // ── Homepage: provisional ────────────────────────────────────────────
  {
    id: "home-provisional-standing",
    text: "Open questions",
    source: "DECISION_REGISTER",
    sourceRef: "OP09 open",
  },
  {
    id: "home-provisional-title",
    text: "Two decisions that are still open",
    source: "DECISION_REGISTER",
    sourceRef: "OP09 open; R02 packaging unvalidated",
  },
  {
    id: "home-provisional-pricing-title",
    text: "Packaging is not decided",
    source: "PHASE_1_ANALYSIS",
    sourceRef: "R02 packaging, buyer and price unvalidated",
  },
  {
    id: "home-provisional-pricing-body",
    text: "Who buys Pageinator, how it is packaged and what it would cost are open decisions. Nothing is for sale.",
    source: "DECISION_REGISTER",
    sourceRef: "OP09 paying buyer, packaging and account policy",
  },
  {
    id: "home-provisional-security-title",
    text: "Security posture and its limits",
    source: "PHASE_1_ANALYSIS",
    sourceRef: "R39 truthful and provisional claims",
  },
  {
    id: "home-provisional-security-body",
    text: "This build holds no customer data, transmits nothing and carries no certification of any kind.",
    source: "PHASE_15_UI_FIRST",
    sourceRef: "Route map: no invented certifications",
  },

  // ── Features page ────────────────────────────────────────────────────
  {
    id: "features-title",
    text: "What Pageinator is being built to do",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§5 workflow sentence",
  },
  {
    id: "features-lead-1",
    text: "The seven stages below describe the product's intended shape, stage by stage.",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§5 workflow sentence",
  },
  {
    id: "features-lead-2",
    text: "None of them is implemented yet. Each names the constraint it must respect and the unit that will build it.",
    source: "IMPLEMENTATION_ROADMAP",
    sourceRef: "RM02 no production claims",
  },
  {
    id: "features-stages-standing",
    text: "Stage by stage",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§5 workflow sentence",
  },
  {
    id: "features-constraint-label",
    text: "The constraint",
    source: "UI005_SPEC",
    sourceRef: "§15 stage composition",
  },

  // ── Pricing page ─────────────────────────────────────────────────────
  {
    id: "pricing-title",
    text: "Illustrative packaging",
    source: "PHASE_15_UI_FIRST",
    sourceRef: "Route map: no binding pricing",
  },
  {
    id: "pricing-lead-1",
    text: "Nothing on this page is purchasable.",
    source: "DECISION_REGISTER",
    sourceRef: "D10 no payment capability",
  },
  {
    id: "pricing-lead-2",
    text: "Packaging, buyer and price are open decisions, and this page exists only to show the shape a subscription might take.",
    source: "PHASE_1_ANALYSIS",
    sourceRef: "R02 packaging, buyer and price unvalidated",
  },
  {
    id: "pricing-open-standing",
    text: "Before you read further",
    source: "UI005_SPEC",
    sourceRef: "§16.2 open-decision block",
  },
  {
    id: "pricing-open-title",
    text: "Packaging is an open decision",
    source: "DECISION_REGISTER",
    sourceRef: "OP09 open",
  },
  {
    id: "pricing-open-1",
    text: "Who pays for Pageinator, what a subscription would include and what it would cost are not decided.",
    source: "DECISION_REGISTER",
    sourceRef: "OP09 paying buyer, packaging and account policy",
  },
  {
    id: "pricing-open-2",
    text: "This build has no payment capability. There is no checkout, no invoice and no way to buy anything here.",
    source: "DECISION_REGISTER",
    sourceRef: "D10 no payment capability in initial backlog",
  },
  {
    id: "pricing-open-3",
    text: "The tiers below are a hypothesis about scope. They are not an offer and they are not a commitment.",
    source: "PHASE_15_UI_FIRST",
    sourceRef: "Route map: no binding pricing",
  },
  {
    id: "pricing-tiers-standing",
    text: "A packaging hypothesis",
    source: "PHASE_1_ANALYSIS",
    sourceRef: "R02 subscription business, packaging unvalidated",
  },
  {
    id: "pricing-tiers-title",
    text: "Three shapes a subscription might take",
    source: "PHASE_1_ANALYSIS",
    sourceRef: "R02 subscription business, packaging unvalidated",
  },
  {
    id: "pricing-tier-caption",
    text: "Illustrative — not an offer",
    source: "UI005_SPEC",
    sourceRef: "§16.2 tier caption",
  },
  {
    id: "pricing-tier-price",
    text: "Not priced",
    source: "UI005_SPEC",
    sourceRef: "§16.2 price presentation",
  },
  {
    id: "pricing-scope-heading",
    text: "Scope this tier would cover",
    source: "UI005_SPEC",
    sourceRef: "§16.2 tier scope boundaries",
  },
  {
    id: "pricing-tier-single-name",
    text: "Single publication",
    source: "PHASE_15_UI_FIRST",
    sourceRef: "Publication workspace scope",
  },
  {
    id: "pricing-tier-single-intent",
    text: "One masthead, one production team, one press configuration.",
    source: "PHASE_15_UI_FIRST",
    sourceRef: "Publication workspace scope",
  },
  {
    id: "pricing-tier-single-scope-1",
    text: "One publication and its editions",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§ access: publications are nested authorization scopes",
  },
  {
    id: "pricing-tier-single-scope-2",
    text: "Owned and manually entered content",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§ discovery: start with owned content",
  },
  {
    id: "pricing-tier-single-scope-3",
    text: "One print profile",
    source: "PHASE_15_UI_FIRST",
    sourceRef: "Publication settings: print profiles",
  },
  {
    id: "pricing-tier-group-name",
    text: "Publication group",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§ access: organization is the tenant",
  },
  {
    id: "pricing-tier-group-intent",
    text: "Several mastheads under one organization, sharing brand and press configuration.",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§ access: publications nested under the organization",
  },
  {
    id: "pricing-tier-group-scope-1",
    text: "Multiple publications in one organization",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§ access: organization is the tenant",
  },
  {
    id: "pricing-tier-group-scope-2",
    text: "Scoped roles across those publications",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§ access: membership and publication grants",
  },
  {
    id: "pricing-tier-group-scope-3",
    text: "Shared brand and print profiles",
    source: "PHASE_15_UI_FIRST",
    sourceRef: "Publication settings: brand, print profiles",
  },
  {
    id: "pricing-tier-network-name",
    text: "Publishing network",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§ access: tenant-qualified references",
  },
  {
    id: "pricing-tier-network-intent",
    text: "Multiple organizations with separate tenancy and separate archive retention.",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§ access: tenant-qualified references prevent cross-attachment",
  },
  {
    id: "pricing-tier-network-scope-1",
    text: "Multiple organizations, isolated from each other",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§ access: cross-tenant isolation",
  },
  {
    id: "pricing-tier-network-scope-2",
    text: "Separate archive retention per organization",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§ archive: retention and dependency retention",
  },
  {
    id: "pricing-tier-network-scope-3",
    text: "Contracted source connectors",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§ discovery: contracted feed/CMS/RSS connectors",
  },
  {
    id: "pricing-excluded-standing",
    text: "Not included",
    source: "UI005_SPEC",
    sourceRef: "§16.2 what is not included",
  },
  {
    id: "pricing-excluded-title",
    text: "What is not being offered",
    source: "UI005_SPEC",
    sourceRef: "§16.2 what is not included",
  },
  {
    id: "pricing-excluded-body",
    text: "There is no trial, no invoice, no contract, no refund policy and no committed availability, because no service is being sold.",
    source: "DECISION_REGISTER",
    sourceRef: "D10 no payment capability in initial backlog",
  },

  // ── Security page ────────────────────────────────────────────────────
  {
    id: "security-title",
    text: "Security posture and current limits",
    source: "PHASE_1_ANALYSIS",
    sourceRef: "R39 security claims must be truthful and provisional",
  },
  {
    id: "security-lead-1",
    text: "This page describes design intent and current reality, kept separate on purpose.",
    source: "PHASE_1_ANALYSIS",
    sourceRef: "R39 truthful and provisional",
  },
  {
    id: "security-lead-2",
    text: "Pageinator holds no customer data today.",
    source: "DECISION_REGISTER",
    sourceRef: "D10 no backend capability in initial backlog",
  },
  {
    id: "security-true-standing",
    text: "Current reality",
    source: "UI005_SPEC",
    sourceRef: "§17.2 block 2",
  },
  {
    id: "security-true-title",
    text: "What is true today",
    source: "UI005_SPEC",
    sourceRef: "§17.2 block 2",
  },
  {
    id: "security-true-1",
    text: "This build runs entirely in your browser. There is no server, no database and no identity provider behind it.",
    source: "DECISION_REGISTER",
    sourceRef: "D10 labeled UI simulation",
  },
  {
    id: "security-true-2",
    text: "All fictional data lives in memory for the duration of a page view. Reloading the page discards it.",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§5 fixtures are deterministic and resettable",
  },
  {
    id: "security-true-3",
    text: "Nothing is transmitted. Nothing is written to local storage, session storage, IndexedDB or a cookie.",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§5 no real credentials, network crawling or cloud uploads",
  },
  {
    id: "security-true-4",
    text: "There is no account, credential or session token. Signing in selects a fictional profile and nothing else.",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§5 no real credentials",
  },
  {
    id: "security-intent-standing",
    text: "Design intent",
    source: "UI005_SPEC",
    sourceRef: "§17.2 block 3",
  },
  {
    id: "security-intent-title",
    text: "How tenancy is intended to work",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§ access: organization is the tenant",
  },
  {
    id: "security-intent-lead",
    text: "The following describes the model Pageinator is being built toward. None of it is an implemented control today.",
    source: "IMPLEMENTATION_ROADMAP",
    sourceRef: "RM03 backend foundation not started",
  },
  {
    id: "security-intent-1",
    text: "The organization will be the tenant, and publications will be nested authorization scopes within it.",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§ access: organization is the tenant",
  },
  {
    id: "security-intent-2",
    text: "Tenant-qualified references will prevent attaching another organization's story, font, advertisement, asset or archive member.",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§ access: tenant-qualified references",
  },
  {
    id: "security-intent-3",
    text: "Sharing across publications will be explicit rather than implied by proximity.",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§ access: sharing across publications is explicit",
  },
  {
    id: "security-intent-4",
    text: "Deduplication across tenants must never disclose that a record exists elsewhere.",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§ access: cross-tenant dedup must not disclose existence",
  },
  {
    id: "security-nonleak-standing",
    text: "One demonstrable property",
    source: "UI005_SPEC",
    sourceRef: "§17.2 block 4",
  },
  {
    id: "security-nonleak-title",
    text: "Inaccessible context is generic by construction",
    source: "UI005_SPEC",
    sourceRef: "§17.2 block 4",
  },
  {
    id: "security-nonleak-body-1",
    text: "In this build, an unknown identifier and a real identifier belonging to another organization produce identical output.",
    source: "UI005_SPEC",
    sourceRef: "§17.2 block 4; UI002 §8.1 rule 2",
  },
  {
    id: "security-nonleak-body-2",
    text: "That is a property of the simulation's interface, checked by its own tests. It is not a production authorization control.",
    source: "UI005_SPEC",
    sourceRef: "§17.2 block 4",
  },
  {
    id: "security-limits-standing",
    text: "Current limits",
    source: "UI005_SPEC",
    sourceRef: "§17.2 block 5",
  },
  {
    id: "security-limits-title",
    text: "What is not true today",
    source: "UI005_SPEC",
    sourceRef: "§17.2 block 5",
  },
  {
    id: "security-limit-assessment",
    text: "No certification, audit, attestation or third-party assessment of any kind.",
    source: "PHASE_15_UI_FIRST",
    sourceRef: "Route map: no invented certifications",
  },
  {
    id: "security-limit-testing",
    text: "No penetration test and no compliance programme.",
    source: "IMPLEMENTATION_ROADMAP",
    sourceRef: "RM16 hardening not started",
  },
  {
    id: "security-limit-encryption",
    text: "No encryption-at-rest claim, because nothing is at rest.",
    source: "DECISION_REGISTER",
    sourceRef: "D10 no backend capability",
  },
  {
    id: "security-limit-availability",
    text: "No availability commitment, no service-level agreement and no incident-response programme.",
    source: "IMPLEMENTATION_ROADMAP",
    sourceRef: "RM16 hardening not started",
  },
  {
    id: "security-limit-processing",
    text: "No data-processing agreement and no sub-processor list, because no data is processed.",
    source: "DECISION_REGISTER",
    sourceRef: "D10 no backend capability",
  },
  {
    id: "security-report-standing",
    text: "Reporting",
    source: "UI005_SPEC",
    sourceRef: "§17.2 block 6",
  },
  {
    id: "security-report-title",
    text: "Where a security note would go",
    source: "UI005_SPEC",
    sourceRef: "§17.2 block 6",
  },
  {
    id: "security-report-body",
    text: "The contact page is where such a note would belong. That form does not send anything, and no one is notified.",
    source: "UI005_SPEC",
    sourceRef: "§17.2 block 6; §18 non-sending behavior",
  },

  // ── Contact page ─────────────────────────────────────────────────────
  {
    id: "contact-title",
    text: "Contact",
    source: "UI005_SPEC",
    sourceRef: "§11 route table",
  },
  {
    id: "contact-lead",
    text: "There is no way to reach anyone from this build. The form below is part of the demonstration.",
    source: "UI005_SPEC",
    sourceRef: "§18.2 standing qualification",
  },
  {
    id: "contact-qualification",
    text: "This form does not send anything. There is no address behind it, no ticketing system, and no one is notified. It exists so the contact step of the journey is complete and honest.",
    source: "UI005_SPEC",
    sourceRef: "§18.2 standing qualification",
  },
  {
    id: "contact-form-standing",
    text: "Demonstration form",
    source: "UI005_SPEC",
    sourceRef: "§18.1 form behavior",
  },
  {
    id: "contact-form-title",
    text: "Write something and see what happens",
    source: "UI005_SPEC",
    sourceRef: "§18.1 form behavior",
  },
  {
    id: "contact-label-name",
    text: "Name",
    source: "UI005_SPEC",
    sourceRef: "§18.1 fields",
  },
  {
    id: "contact-label-organization",
    text: "Organization",
    source: "UI005_SPEC",
    sourceRef: "§18.1 fields",
  },
  {
    id: "contact-label-reach",
    text: "How to reach you",
    source: "UI005_SPEC",
    sourceRef: "§18.1 fields",
  },
  {
    id: "contact-label-message",
    text: "Message",
    source: "UI005_SPEC",
    sourceRef: "§18.1 fields",
  },
  {
    id: "contact-description-optional",
    text: "Optional. Nothing here is validated, transmitted or retained.",
    source: "UI005_SPEC",
    sourceRef: "§18.1 fields",
  },
  {
    id: "contact-description-message",
    text: "Required only so the demonstration has something to acknowledge.",
    source: "UI005_SPEC",
    sourceRef: "§18.1 fields",
  },
  {
    id: "contact-submit",
    text: "Preview the acknowledgement",
    source: "UI005_SPEC",
    sourceRef: "§18.1 submission behavior",
  },
  {
    id: "contact-error-message-required",
    text: "Enter a message to see the acknowledgement.",
    source: "UI005_SPEC",
    sourceRef: "§18.1 empty-submission behavior",
  },
  {
    id: "contact-acknowledgement-heading",
    text: "Nothing was sent",
    source: "UI005_SPEC",
    sourceRef: "§18.1 acknowledgement",
  },
  {
    id: "contact-acknowledgement-body",
    text: "Your text was not transmitted and was not stored. It has been cleared from this page and will be gone when you close the tab.",
    source: "UI005_SPEC",
    sourceRef: "§18.1 acknowledgement",
  },

  // ── Workflow stages (§13.1) ──────────────────────────────────────────
  {
    id: "workflow-ingest-name",
    text: "Ingest",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§ discovery: check permitted access/storage before fetching",
  },
  {
    id: "workflow-ingest-description",
    text: "Authorized discovery and import from owned content and contracted sources.",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§ discovery: check permitted access/storage before fetching",
  },
  {
    id: "workflow-ingest-constraint",
    text: "Permitted access and storage must be checked before fetching, not only after extraction. Copied wire reports do not count as independent corroboration.",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§ discovery: check permitted access/storage before fetching",
  },
  {
    id: "workflow-organize-name",
    text: "Organize",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§ newsroom: observation/event is not an approved story",
  },
  {
    id: "workflow-organize-description",
    text: "Selecting and preparing stories, media and advertisements for one edition.",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§ newsroom: observation/event is not an approved story",
  },
  {
    id: "workflow-organize-constraint",
    text: "An observation or event grouping is not an approved publishable story. Readiness must report concrete missing inputs, not an uncalibrated percentage.",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§ newsroom: observation/event is not an approved story",
  },
  {
    id: "workflow-generate-name",
    text: "Generate",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§ layout: bounded regeneration preserving locks; no hidden dropped text",
  },
  {
    id: "workflow-generate-description",
    text: "Producing an editable edition from the selected content and the publication's templates.",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§ layout: bounded regeneration preserving locks; no hidden dropped text",
  },
  {
    id: "workflow-generate-constraint",
    text: "Regeneration must stay bounded and preserve locks. No text may be silently dropped.",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§ layout: bounded regeneration preserving locks; no hidden dropped text",
  },
  {
    id: "workflow-edit-name",
    text: "Edit",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "RM12: UI sample remains distinct until each capability qualified",
  },
  {
    id: "workflow-edit-description",
    text: "Professional editing of the composed edition in the browser.",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "RM12: UI sample remains distinct until each capability qualified",
  },
  {
    id: "workflow-edit-constraint",
    text: "The sample editor stays distinct from the production editor until each capability is independently qualified.",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "RM12: UI sample remains distinct until each capability qualified",
  },
  {
    id: "workflow-validate-name",
    text: "Validate",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "RM11 preflight: failure-closed behavior",
  },
  {
    id: "workflow-validate-description",
    text: "Deterministic validation of the composed edition against a press profile.",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "RM11 preflight: failure-closed behavior",
  },
  {
    id: "workflow-validate-constraint",
    text: "Validation must fail closed. An unqualified profile or revision blocks release rather than warning.",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "RM11 preflight: failure-closed behavior",
  },
  {
    id: "workflow-export-name",
    text: "Export",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§5 non-goals: no automatic printing-press control",
  },
  {
    id: "workflow-export-description",
    text: "Producing the final document for inspection, approval and press handoff.",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§5 non-goals: no automatic printing-press control",
  },
  {
    id: "workflow-export-constraint",
    text: "Manual press handoff is the proposed pilot. Pageinator must never drive a printing press.",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§5 non-goals: no automatic printing-press control",
  },
  {
    id: "workflow-archive-name",
    text: "Archive",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§ archive: immutable release manifests; retention not assumed",
  },
  {
    id: "workflow-archive-description",
    text: "Retaining and retrieving the exact published edition.",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§ archive: immutable release manifests; retention not assumed",
  },
  {
    id: "workflow-archive-constraint",
    text: "Release manifests must be immutable. Permanent retention is not assumed.",
    source: "MASTER_BUILD_SPEC",
    sourceRef: "§ archive: immutable release manifests; retention not assumed",
  },

  // ── Workflow availability vocabulary (§13.2) ─────────────────────────
  /*
   * The three permitted availability labels. They are governed copy like
   * every other rendered sentence: a label is the strongest capability
   * claim a stage makes, so it may not live outside this module.
   */
  {
    id: "availability-demonstrated",
    text: "You can try this in the demonstration",
    source: "UI005_SPEC",
    sourceRef: "§13.2 availability vocabulary",
  },
  {
    id: "availability-routed",
    text: "Reserved in the current build",
    source: "UI005_SPEC",
    sourceRef: "§13.2 availability vocabulary",
  },
  {
    id: "availability-planned",
    text: "Not built",
    source: "UI005_SPEC",
    sourceRef: "§13.2 availability vocabulary",
  },

  /*
   * Rendered through `format()` so the whole sentence is governed here
   * rather than assembled from a fragment plus a JSX interpolation. The
   * unit itself still comes from the durable route table, never a copy.
   */
  {
    id: "features-owner-caption",
    text: "Reserved for {unit}.",
    source: "UI005_SPEC",
    sourceRef: "§15 stage composition; unit read from OWNING_UNIT",
  },

  // ── Page geometry figure (§14) ───────────────────────────────────────
  {
    id: "figure-caption",
    text: "Illustration of newspaper page structure. This is a diagram, not output produced by Pageinator.",
    source: "UI005_SPEC",
    sourceRef: "§14.2 required caption",
  },
  {
    id: "figure-alt",
    text: "A schematic newspaper page: outer margins, a six-column grid with gutters, a reserved advertisement rectangle in one corner, and an arrow marking text flowing from one column region to another.",
    source: "UI005_SPEC",
    sourceRef: "§14.2 accessible description",
  },
  {
    id: "figure-label-grid",
    text: "Column grid",
    source: "UI005_SPEC",
    sourceRef: "§14.2 permitted region labels",
  },
  {
    id: "figure-label-ad",
    text: "Reserved ad",
    source: "UI005_SPEC",
    sourceRef: "§14.2 permitted region labels",
  },
  {
    id: "figure-label-flow",
    text: "Linked flow",
    source: "UI005_SPEC",
    sourceRef: "§14.2 permitted region labels",
  },
];

const BY_ID = new Map(RECORDS.map((record) => [record.id, record]));

/** Every content record, for the §19.4 governance scan. */
export const CONTENT_RECORDS: readonly ContentRecord[] = RECORDS;

/**
 * Reads one record's text. Throws on an unknown id so a typo surfaces as a
 * test failure rather than as an empty region in production.
 */
export function t(id: string): string {
  const record = BY_ID.get(id);
  if (!record) throw new Error(`Unknown public content id: ${id}`);
  return record.text;
}

/**
 * Reads a record whose text carries `{name}` placeholders and substitutes
 * them, returning one complete string.
 *
 * This exists so a sentence with a variable part is still one governed
 * sentence. Writing `Reserved for {unit}` in JSX would put the words
 * "Reserved for" outside this module and split the rendered sentence into
 * two text nodes, which is exactly what the governance test rejects.
 */
export function format(id: string, params: Readonly<Record<string, string>>): string {
  return t(id).replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) {
      throw new Error(`Missing parameter "${name}" for public content id: ${id}`);
    }
    return value;
  });
}

/** Every rendered string `format()` can produce, for the governance scan. */
export function expandedContentTexts(
  params: Readonly<Record<string, readonly string[]>>
): readonly string[] {
  const out: string[] = [];
  for (const record of RECORDS) {
    const names = [...record.text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
    if (names.length === 0) continue;
    if (names.length > 1) {
      throw new Error(`Multi-parameter content is not supported: ${record.id}`);
    }
    for (const value of params[names[0]!] ?? []) {
      out.push(format(record.id, { [names[0]!]: value }));
    }
  }
  return out;
}
