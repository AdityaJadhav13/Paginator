/**
 * Fictional data for the session test double: accounts to sign in with, each one's organisations as the API's /me
 * gives them (organisation role; roles and grants per publication), each organisation's two-step rule, invitations
 * in each state, a password-reset token, and the two-step codes. Every name and address is invented; the addresses use
 * the reserved `.example` domain. Organisation and publication names come from the UI003 seed (seed.ts), so they live
 * in one place. Private to src/mocks: tests read it through the controller's `fixtures`.
 */
import type { InvitationDto } from "../services/index.ts";
import type { MockSessionPreset } from "./create-mock-session-environment.ts";

const SESSION_SEED_VERSION = "l2g-session-seed-v1" as const;
const FIXTURE_KIND = "test-double-only" as const;

export interface MockAccount {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly password: string;
  readonly emailVerified: boolean;
  readonly twoFactorEnabled: boolean;
}

/** One organisation of an account: ids and roles only (names from seed.ts). */
export interface MockOrgRole {
  readonly organizationId: string;
  readonly orgRole: "owner" | "admin" | "member";
  readonly publications: readonly {
    readonly publicationId: string;
    readonly roles: readonly string[];
    readonly grants: readonly string[];
  }[];
}

export interface MockInvitation extends InvitationDto {
  readonly id: string;
  /** The address it was sent to: the API keeps it, and never shows it on the invitation page. */
  readonly email: string;
  /** The organisation it joins (a fictional one of its own). */
  readonly organizationId: string;
  readonly publicationId: string;
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
      twoFactorEnabled: false,
    },
    {
      userId: "user-demo-konkan-reviewer",
      name: "Konkan Demo Reviewer",
      email: "reviewer@konkan.example",
      password: "fictional reviewer password",
      emailVerified: true,
      twoFactorEnabled: false,
    },
    {
      userId: "user-demo-unconfirmed",
      name: "Unconfirmed Demo Reporter",
      email: "reporter@sahyadri.example",
      password: "fictional reporter password",
      emailVerified: false,
      twoFactorEnabled: false,
    },
    {
      userId: "user-demo-sahyadri-owner",
      name: "Sahyadri Demo Owner",
      email: "owner@sahyadri.example",
      password: "fictional owner password",
      emailVerified: true,
      twoFactorEnabled: true,
    },
    {
      userId: "user-demo-sahyadri-subeditor",
      name: "Sahyadri Demo Sub-editor",
      email: "subeditor@sahyadri.example",
      password: "fictional sub-editor password",
      emailVerified: true,
      twoFactorEnabled: false,
    },
  ] satisfies readonly MockAccount[],
  organizations: {
    "user-demo-sahyadri-editor": [
      {
        organizationId: "org-demo-sahyadri",
        orgRole: "admin",
        publications: [
          { publicationId: "pub-demo-pune-daily", roles: ["editor"], grants: ["page_approve"] },
          { publicationId: "pub-demo-urdu-evening", roles: ["editor"], grants: [] },
        ],
      },
      {
        organizationId: "org-demo-konkan",
        orgRole: "member",
        publications: [{ publicationId: "pub-demo-ratnagiri-tide", roles: ["viewer"], grants: [] }],
      },
    ],
    "user-demo-konkan-reviewer": [
      {
        organizationId: "org-demo-konkan",
        orgRole: "member",
        publications: [{ publicationId: "pub-demo-ratnagiri-tide", roles: ["viewer"], grants: [] }],
      },
    ],
    "user-demo-sahyadri-owner": [
      {
        organizationId: "org-demo-sahyadri",
        orgRole: "owner",
        publications: [
          { publicationId: "pub-demo-pune-daily", roles: ["chief_editor"], grants: [] },
          { publicationId: "pub-demo-urdu-evening", roles: ["chief_editor"], grants: [] },
        ],
      },
    ],
    "user-demo-sahyadri-subeditor": [
      {
        organizationId: "org-demo-sahyadri",
        orgRole: "member",
        publications: [{ publicationId: "pub-demo-pune-daily", roles: ["sub_editor"], grants: [] }],
      },
    ],
  } satisfies Readonly<Record<string, readonly MockOrgRole[]>>,
  /** The organisation roles each organisation requires two-step for (org_settings.mfa_required_roles). */
  twoStepRoles: { "org-demo-sahyadri": ["owner"], "org-demo-konkan": [] } as Readonly<Record<string, readonly string[]>>,
  invitations: [
    {
      id: "6f1c2e3a-4b5d-4e6f-8a7b-9c0d1e2f3a4b",
      email: "new.designer@sahyadri.example",
      organizationId: "org-demo-daily",
      publicationId: "pub-demo-daily",
      organizationName: "The Sahyadri Daily",
      inviterName: "Ravi Kulkarni",
      roles: ["member", "page_designer"],
      expiresAt: "2026-10-28T12:00:00.000Z",
      state: "pending",
    },
    {
      id: "7a2d3f4b-5c6e-4f70-9b8c-0d1e2f3a4b5c",
      email: "late@sahyadri.example",
      organizationId: "org-demo-daily",
      publicationId: "pub-demo-daily",
      organizationName: "The Sahyadri Daily",
      inviterName: "Ravi Kulkarni",
      roles: ["member", "reporter"],
      expiresAt: "2026-10-14T12:00:00.000Z",
      state: "expired",
    },
    {
      id: "8b3e4a5c-6d7f-4081-ac9d-1e2f3a4b5c6d",
      email: "editor@sahyadri.example",
      organizationId: "org-demo-daily",
      publicationId: "pub-demo-daily",
      organizationName: "The Sahyadri Daily",
      inviterName: "Ravi Kulkarni",
      roles: ["admin"],
      expiresAt: "2026-10-28T12:00:00.000Z",
      state: "accepted",
    },
    {
      id: "9c4f5b6d-7e80-4192-bdae-2f3a4b5c6d7e",
      email: "withdrawn@sahyadri.example",
      organizationId: "org-demo-daily",
      publicationId: "pub-demo-daily",
      organizationName: "The Sahyadri Daily",
      inviterName: "Ravi Kulkarni",
      roles: ["member", "viewer"],
      expiresAt: "2026-10-28T12:00:00.000Z",
      state: "revoked",
    },
  ] satisfies readonly MockInvitation[],
  /** A reset link's token for editor@sahyadri.example; it works once. */
  resetToken: { token: "fictional-reset-token", email: "editor@sahyadri.example" },
  /** The code the fictional authenticator app shows, and each account's backup codes (each works once). */
  totpCode: "123456",
  backupCodes: ["FICTA-11111", "FICTB-22222", "FICTC-33333"],
  /** What turning two-step on answers (a fictional secret). */
  totpUri: "otpauth://totp/Pageinator:{email}?secret=JBSWY3DPEHPK3PXP&issuer=Pageinator",
} as const;

const PRESET_USERS: Readonly<Record<Exclude<MockSessionPreset, "signed-out">, string>> = {
  "sahyadri-editor": "user-demo-sahyadri-editor",
  "konkan-reviewer": "user-demo-konkan-reviewer",
  "sahyadri-owner": "user-demo-sahyadri-owner",
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

/** Every account's organisations, as fresh copies. */
export function createOrgRoles(): Map<string, MockOrgRole[]> {
  const roles = SESSION_SEED.organizations as Readonly<Record<string, readonly MockOrgRole[]>>;
  return new Map(
    Object.entries(roles).map(([userId, orgs]) => [
      userId,
      orgs.map((org) => ({
        ...org,
        publications: org.publications.map((p) => ({ ...p, roles: [...p.roles], grants: [...p.grants] })),
      })),
    ]),
  );
}

export function twoStepRolesOf(organizationId: string): readonly string[] {
  return SESSION_SEED.twoStepRoles[organizationId] ?? [];
}

export function createInvitations(): MockInvitation[] {
  return SESSION_SEED.invitations.map((invitation) => ({ ...invitation, roles: [...invitation.roles] }));
}

export function resetTokenFixture(): { readonly token: string; readonly email: string } {
  return { ...SESSION_SEED.resetToken };
}

export function twoStepFixtures(): { totpCode: string; backupCodes: string[]; totpUri: string } {
  return {
    totpCode: SESSION_SEED.totpCode,
    backupCodes: [...SESSION_SEED.backupCodes],
    totpUri: SESSION_SEED.totpUri,
  };
}
