import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  EditionDto,
  OrganizationDto,
  PublicationDto,
  ServiceError,
  ServiceResult,
  UserDto,
} from "../../src/services/index.ts";
import { createMockServiceEnvironment } from "../../src/mocks/index.ts";

describe("UI003 DTO and service contracts", () => {
  it("defines exactly the four minimal read-only DTO shapes", () => {
    expectTypeOf<UserDto>().toEqualTypeOf<{
      readonly id: string;
      readonly displayName: string;
    }>();
    expectTypeOf<OrganizationDto>().toEqualTypeOf<{
      readonly id: string;
      readonly name: string;
    }>();
    expectTypeOf<PublicationDto>().toEqualTypeOf<{
      readonly id: string;
      readonly orgId: string;
      readonly name: string;
      readonly locale: string;
      readonly direction: "ltr" | "rtl";
    }>();
    expectTypeOf<EditionDto>().toEqualTypeOf<{
      readonly id: string;
      readonly publicationId: string;
      readonly label: string;
    }>();
  });

  it("exposes only the authorized product query methods", () => {
    const environment = createMockServiceEnvironment();
    expect(Object.keys(environment.users)).toEqual(["getUser"]);
    expect(Object.keys(environment.workspace)).toEqual([
      "listOrganizations",
      "getOrganization",
      "listPublications",
      "getPublication",
      "getEdition",
    ]);
  });

  it("all six service operations return promises", async () => {
    const { users, workspace } = createMockServiceEnvironment();
    const calls = [
      users.getUser({ userId: "user-demo-sahyadri-editor" }),
      workspace.listOrganizations(),
      workspace.getOrganization({ organizationId: "org-demo-sahyadri" }),
      workspace.listPublications({ organizationId: "org-demo-sahyadri" }),
      workspace.getPublication({
        organizationId: "org-demo-sahyadri",
        publicationId: "pub-demo-pune-daily",
      }),
      workspace.getEdition({
        organizationId: "org-demo-sahyadri",
        publicationId: "pub-demo-pune-daily",
        editionId: "edition-demo-001",
      }),
    ];

    expect(calls.every((call) => call instanceof Promise)).toBe(true);
    const results = await Promise.all(calls);
    expect(results.every((result) => result.ok)).toBe(true);
  });

  it("uses the exact structured public error vocabulary", async () => {
    expectTypeOf<ServiceResult<UserDto>>().toEqualTypeOf<
      | { readonly ok: true; readonly value: UserDto }
      | { readonly ok: false; readonly error: ServiceError }
    >();

    const environment = createMockServiceEnvironment();
    const unavailable = await environment.users.getUser({ userId: "unknown-user" });
    expect(unavailable).toEqual({
      ok: false,
      error: {
        code: "unavailable",
        resource: "user",
        displayMessage: "This user is not available.",
      },
    });

    environment.scenarios.setScenario({ mode: "denial" });
    expect(await environment.users.getUser({ userId: "unknown-user" })).toEqual({
      ok: false,
      error: {
        code: "denied",
        displayMessage: "This demonstration action is not available in the current context.",
        qualification: "Demonstration only — production authorization is not evaluated here",
      },
    });

    environment.scenarios.setScenario({ mode: "failure" });
    expect(await environment.users.getUser({ userId: "unknown-user" })).toEqual({
      ok: false,
      error: {
        code: "temporary-failure",
        displayMessage: "The demonstration service is temporarily unavailable. Try again.",
      },
    });
  });
});
