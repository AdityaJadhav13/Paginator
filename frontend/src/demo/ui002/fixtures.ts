/**
 * UI002 demonstration fixtures.
 *
 * All data is STATIC, DETERMINISTIC, and FICTIONAL.
 * fixtureKind: "ui002-demo-only" — these fixtures define no production
 * schema and are never imported by durable `src/app/**` code (only by
 * this feature's own disposable route assembly, `routeTree.tsx`).
 *
 * These IDs establish scoped presentation context only. They are not
 * tenant keys, API paths, database identifiers, or an authorization
 * boundary (UI002 §8).
 *
 * Organization B and its publication/edition exist specifically to
 * prove cross-organization isolation: `pub-demo-ratnagiri-tide`
 * belongs to `org-demo-konkan`, not `org-demo-sahyadri`, so a request
 * for it while scoped to `org-demo-sahyadri` must render exactly like
 * a completely nonexistent publication id (§8.1 rule 2).
 */
import type {
  OrgFixtureLike,
  PublicationFixtureLike,
  EditionFixtureLike,
  ReleaseFixtureLike,
  WorkspaceFixtureSet,
} from "../../app/contracts/route-context.ts";

export const FIXTURE_KIND = "ui002-demo-only" as const;

export interface Ui002OrgFixture extends OrgFixtureLike {
  readonly fixtureKind: typeof FIXTURE_KIND;
}
export interface Ui002PublicationFixture extends PublicationFixtureLike {
  readonly fixtureKind: typeof FIXTURE_KIND;
}
export interface Ui002EditionFixture extends EditionFixtureLike {
  readonly fixtureKind: typeof FIXTURE_KIND;
}
export interface Ui002ReleaseFixture extends ReleaseFixtureLike {
  readonly fixtureKind: typeof FIXTURE_KIND;
}

export const ORG_SAHYADRI: Ui002OrgFixture = {
  fixtureKind: FIXTURE_KIND,
  id: "org-demo-sahyadri",
  name: "Sahyadri Media Cooperative",
};

export const ORG_KONKAN: Ui002OrgFixture = {
  fixtureKind: FIXTURE_KIND,
  id: "org-demo-konkan",
  name: "Konkan Coastal Press",
};

export const PUB_PUNE_DAILY: Ui002PublicationFixture = {
  fixtureKind: FIXTURE_KIND,
  id: "pub-demo-pune-daily",
  orgId: ORG_SAHYADRI.id,
  name: "Pune Daily Ledger",
  locale: "en-IN",
  direction: "ltr",
};

export const PUB_URDU_EVENING: Ui002PublicationFixture = {
  fixtureKind: FIXTURE_KIND,
  id: "pub-demo-urdu-evening",
  orgId: ORG_SAHYADRI.id,
  name: "Deccan Evening Record",
  locale: "ur-IN",
  direction: "rtl",
};

export const PUB_RATNAGIRI_TIDE: Ui002PublicationFixture = {
  fixtureKind: FIXTURE_KIND,
  id: "pub-demo-ratnagiri-tide",
  orgId: ORG_KONKAN.id,
  name: "Ratnagiri Tide",
  locale: "en-IN",
  direction: "ltr",
};

export const EDITION_001: Ui002EditionFixture = {
  fixtureKind: FIXTURE_KIND,
  id: "edition-demo-001",
  publicationId: PUB_PUNE_DAILY.id,
  label: "edition-demo-001",
};

export const EDITION_002: Ui002EditionFixture = {
  fixtureKind: FIXTURE_KIND,
  id: "edition-demo-002",
  publicationId: PUB_RATNAGIRI_TIDE.id,
  label: "edition-demo-002",
};

export const RELEASE_001: Ui002ReleaseFixture = {
  fixtureKind: FIXTURE_KIND,
  id: "release-demo-001",
  publicationId: PUB_PUNE_DAILY.id,
  label: "release-demo-001",
};

export const UI002_FIXTURES: WorkspaceFixtureSet = {
  organizations: [ORG_SAHYADRI, ORG_KONKAN],
  publications: [PUB_PUNE_DAILY, PUB_URDU_EVENING, PUB_RATNAGIRI_TIDE],
  editions: [EDITION_001, EDITION_002],
  releases: [RELEASE_001],
};
