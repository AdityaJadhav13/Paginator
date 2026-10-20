import { describe, expect, it } from "vitest";
import type {
  SessionSnapshot,
  SimulatedAccessGrantDto,
  SimulatedProfileDto,
  SimulatedSessionDto,
  SimulatedSessionService,
} from "../../src/services/index.ts";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Assert<Value extends true> = Value;

type ProfileContract = Assert<Equal<SimulatedProfileDto, { readonly userId: string }>>;
type GrantContract = Assert<Equal<SimulatedAccessGrantDto, {
  readonly organizationId: string;
  readonly role: "editor" | "reviewer";
  readonly publicationIds: readonly string[];
}>>;
type SessionContract = Assert<Equal<SimulatedSessionDto, {
  readonly userId: string;
  readonly access: readonly SimulatedAccessGrantDto[];
  readonly activeOrganizationId: string;
  readonly activePublicationId: string;
}>>;
type SnapshotContract = Assert<Equal<SessionSnapshot,
  | { readonly status: "signed-out" }
  | { readonly status: "signed-in"; readonly session: SimulatedSessionDto }
>>;
type ServiceMethods = Assert<Equal<keyof SimulatedSessionService,
  | "listProfiles"
  | "getSession"
  | "signIn"
  | "signOut"
  | "selectOrganization"
  | "selectPublication"
>>;

describe("UI004 minimal service contracts", () => {
  it("compile with the exact readonly DTO fields, unions, and six service methods", () => {
    const assertions: [ProfileContract, GrantContract, SessionContract, SnapshotContract, ServiceMethods] = [
      true, true, true, true, true,
    ];
    expect(assertions).toEqual([true, true, true, true, true]);
  });

  it("declares no production identity, token, expiry, or capability fields", async () => {
    const modules = import.meta.glob("/src/services/session-dtos.ts", {
      eager: true,
      query: "?raw",
      import: "default",
    }) as Record<string, string>;
    const source = Object.values(modules)[0] ?? "";
    expect(source).not.toMatch(/email|password|token|expiry|provider|capabilit|billing|membership|avatar|timezone/i);
  });
});
