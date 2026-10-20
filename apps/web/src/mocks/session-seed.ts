import type { SimulatedProfileDto, SimulatedSessionDto } from "../services/index.ts";
import type { MockSessionPreset } from "./create-mock-session-environment.ts";

const SESSION_SEED_VERSION = "ui004-session-seed-v1" as const;
const FIXTURE_KIND = "ui004-demo-only" as const;

const SESSION_SEED: {
  readonly seedVersion: typeof SESSION_SEED_VERSION;
  readonly fixtureKind: typeof FIXTURE_KIND;
  readonly sessions: Readonly<Record<Exclude<MockSessionPreset, "signed-out">, SimulatedSessionDto>>;
} = {
  seedVersion: SESSION_SEED_VERSION,
  fixtureKind: FIXTURE_KIND,
  sessions: {
  "sahyadri-editor": {
    userId: "user-demo-sahyadri-editor",
    access: [
      {
        organizationId: "org-demo-sahyadri",
        role: "editor",
        publicationIds: ["pub-demo-pune-daily", "pub-demo-urdu-evening"],
      },
      {
        organizationId: "org-demo-konkan",
        role: "reviewer",
        publicationIds: ["pub-demo-ratnagiri-tide"],
      },
    ],
    activeOrganizationId: "org-demo-sahyadri",
    activePublicationId: "pub-demo-pune-daily",
  },
  "konkan-reviewer": {
    userId: "user-demo-konkan-reviewer",
    access: [
      {
        organizationId: "org-demo-konkan",
        role: "reviewer",
        publicationIds: ["pub-demo-ratnagiri-tide"],
      },
    ],
    activeOrganizationId: "org-demo-konkan",
    activePublicationId: "pub-demo-ratnagiri-tide",
  },
  },
};

export function sessionForPreset(
  preset: Exclude<MockSessionPreset, "signed-out">
): SimulatedSessionDto {
  const session = SESSION_SEED.sessions[preset];
  return {
    ...session,
    access: session.access.map((grant) => ({
      ...grant,
      publicationIds: [...grant.publicationIds],
    })),
  };
}

export function presetForUser(userId: string): Exclude<MockSessionPreset, "signed-out"> | undefined {
  return (Object.keys(SESSION_SEED.sessions) as Exclude<MockSessionPreset, "signed-out">[]).find(
    (preset) => SESSION_SEED.sessions[preset].userId === userId
  );
}

export function createProfileDtos(): SimulatedProfileDto[] {
  return (Object.keys(SESSION_SEED.sessions) as Exclude<MockSessionPreset, "signed-out">[]).map(
    (preset) => ({ userId: SESSION_SEED.sessions[preset].userId })
  );
}
