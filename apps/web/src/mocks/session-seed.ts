/**
 * Fictional data for the session test double: accounts to sign in with, the placeholder workspace each one may open,
 * invitations in each state, and a password-reset token. Every name and address is invented; the addresses use the
 * reserved `.example` domain. Private to src/mocks: tests read it through the controller's `fixtures`.
 */
import type { InvitationDto, WorkspaceAccessDto } from "../services/index.ts";
import type { MockSessionPreset } from "./create-mock-session-environment.ts";

const SESSION_SEED_VERSION = "l2e-session-seed-v1" as const;
const FIXTURE_KIND = "test-double-only" as const;

export interface MockAccount {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly password: string;
  readonly emailVerified: boolean;
}

export interface MockInvitation extends InvitationDto {
  readonly id: string;
  /** The address it was sent to: the API keeps it, and never shows it on the invitation page. */
  readonly email: string;
}

const SESSION_SEED = {
  seedVersion: SESSION_SEED_VERSION,
  fixtureKind: FIXTURE_KIND,
  accounts: [
    {
      userId: "user-demo-sahyadri-editor",
      name: "Sahyadri Demo Editor",
      email: "editor@sahyadri.example",
      password: "fictional editor password",
      emailVerified: true,
    },
    {
      userId: "user-demo-konkan-reviewer",
      name: "Konkan Demo Reviewer",
      email: "reviewer@konkan.example",
      password: "fictional reviewer password",
      emailVerified: true,
    },
    {
      userId: "user-demo-unconfirmed",
      name: "Unconfirmed Demo Reporter",
      email: "reporter@sahyadri.example",
      password: "fictional reporter password",
      emailVerified: false,
    },
  ] satisfies readonly MockAccount[],
  workspaces: {
    "user-demo-sahyadri-editor": {
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
    "user-demo-konkan-reviewer": {
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
  } satisfies Readonly<Record<string, WorkspaceAccessDto>>,
  invitations: [
    {
      id: "6f1c2e3a-4b5d-4e6f-8a7b-9c0d1e2f3a4b",
      email: "new.designer@sahyadri.example",
      organizationName: "The Sahyadri Daily",
      inviterName: "Ravi Kulkarni",
      roles: ["member", "page_designer"],
      expiresAt: "2026-10-28T12:00:00.000Z",
      state: "pending",
    },
    {
      id: "7a2d3f4b-5c6e-4f70-9b8c-0d1e2f3a4b5c",
      email: "late@sahyadri.example",
      organizationName: "The Sahyadri Daily",
      inviterName: "Ravi Kulkarni",
      roles: ["member", "reporter"],
      expiresAt: "2026-10-14T12:00:00.000Z",
      state: "expired",
    },
    {
      id: "8b3e4a5c-6d7f-4081-ac9d-1e2f3a4b5c6d",
      email: "editor@sahyadri.example",
      organizationName: "The Sahyadri Daily",
      inviterName: "Ravi Kulkarni",
      roles: ["admin"],
      expiresAt: "2026-10-28T12:00:00.000Z",
      state: "accepted",
    },
    {
      id: "9c4f5b6d-7e80-4192-bdae-2f3a4b5c6d7e",
      email: "withdrawn@sahyadri.example",
      organizationName: "The Sahyadri Daily",
      inviterName: "Ravi Kulkarni",
      roles: ["member", "viewer"],
      expiresAt: "2026-10-28T12:00:00.000Z",
      state: "revoked",
    },
  ] satisfies readonly MockInvitation[],
  /** A reset link's token for editor@sahyadri.example; it works once. */
  resetToken: { token: "fictional-reset-token", email: "editor@sahyadri.example" },
} as const;

const PRESET_USERS: Readonly<Record<Exclude<MockSessionPreset, "signed-out">, string>> = {
  "sahyadri-editor": "user-demo-sahyadri-editor",
  "konkan-reviewer": "user-demo-konkan-reviewer",
};

export function userForPreset(preset: Exclude<MockSessionPreset, "signed-out">): string {
  return PRESET_USERS[preset];
}

export function presetForUser(userId: string): Exclude<MockSessionPreset, "signed-out"> | undefined {
  return (Object.keys(PRESET_USERS) as Exclude<MockSessionPreset, "signed-out">[]).find(
    (preset) => PRESET_USERS[preset] === userId,
  );
}

export function createAccounts(): MockAccount[] {
  return SESSION_SEED.accounts.map((account) => ({ ...account }));
}

/** The workspace a fictional person may open, as a fresh copy; undefined for one without a workspace. */
export function workspaceFor(userId: string): WorkspaceAccessDto | undefined {
  const workspace = (SESSION_SEED.workspaces as Readonly<Record<string, WorkspaceAccessDto>>)[userId];
  return workspace
    ? {
        ...workspace,
        access: workspace.access.map((grant) => ({ ...grant, publicationIds: [...grant.publicationIds] })),
      }
    : undefined;
}

export function createInvitations(): MockInvitation[] {
  return SESSION_SEED.invitations.map((invitation) => ({ ...invitation, roles: [...invitation.roles] }));
}

export function resetTokenFixture(): { readonly token: string; readonly email: string } {
  return { ...SESSION_SEED.resetToken };
}
