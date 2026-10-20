/**
 * Canonical fictional seed for UI003.
 *
 * This module is private to the mock adapter boundary. Its metadata and
 * arrays are never part of a product service DTO or public mock barrel.
 */
import type {
  EditionDto,
  OrganizationDto,
  PublicationDto,
  UserDto,
} from "../services/index.ts";

const SEED_VERSION = "ui003-seed-v1" as const;
const FIXTURE_KIND = "ui003-demo-only" as const;

export interface MockSeedSnapshot {
  readonly seedVersion: typeof SEED_VERSION;
  readonly fixtureKind: typeof FIXTURE_KIND;
  readonly users: readonly UserDto[];
  readonly organizations: readonly OrganizationDto[];
  readonly publications: readonly PublicationDto[];
  readonly editions: readonly EditionDto[];
}

const CANONICAL_SEED: MockSeedSnapshot = {
  seedVersion: SEED_VERSION,
  fixtureKind: FIXTURE_KIND,
  users: [
    { id: "user-demo-sahyadri-editor", displayName: "Sahyadri Demo Editor" },
    { id: "user-demo-konkan-reviewer", displayName: "Konkan Demo Reviewer" },
  ],
  organizations: [
    { id: "org-demo-sahyadri", name: "Sahyadri Media Cooperative" },
    { id: "org-demo-konkan", name: "Konkan Coastal Press" },
  ],
  publications: [
    {
      id: "pub-demo-pune-daily",
      orgId: "org-demo-sahyadri",
      name: "Pune Daily Ledger",
      locale: "en-IN",
      direction: "ltr",
    },
    {
      id: "pub-demo-urdu-evening",
      orgId: "org-demo-sahyadri",
      name: "Deccan Evening Record",
      locale: "ur-IN",
      direction: "rtl",
    },
    {
      id: "pub-demo-ratnagiri-tide",
      orgId: "org-demo-konkan",
      name: "Ratnagiri Tide",
      locale: "en-IN",
      direction: "ltr",
    },
  ],
  editions: [
    {
      id: "edition-demo-001",
      publicationId: "pub-demo-pune-daily",
      label: "edition-demo-001",
    },
    {
      id: "edition-demo-urdu-001",
      publicationId: "pub-demo-urdu-evening",
      label: "edition-demo-urdu-001",
    },
    {
      id: "edition-demo-002",
      publicationId: "pub-demo-ratnagiri-tide",
      label: "edition-demo-002",
    },
  ],
};

function cloneRecords<T extends object>(records: readonly T[]): T[] {
  return records.map((record) => ({ ...record }));
}

/** @internal Creates the private per-environment snapshot. */
export function createCanonicalSeed(): MockSeedSnapshot {
  return {
    seedVersion: CANONICAL_SEED.seedVersion,
    fixtureKind: CANONICAL_SEED.fixtureKind,
    users: cloneRecords(CANONICAL_SEED.users),
    organizations: cloneRecords(CANONICAL_SEED.organizations),
    publications: cloneRecords(CANONICAL_SEED.publications),
    editions: cloneRecords(CANONICAL_SEED.editions),
  };
}
