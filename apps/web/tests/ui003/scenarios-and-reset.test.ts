import { describe, expect, it, vi } from "vitest";
import type { ServiceResult } from "../../src/services/index.ts";
import {
  createMockServiceEnvironment,
  type MockServiceEnvironment,
  type MockScenario,
} from "../../src/mocks/index.ts";

async function publicSnapshot(environment: MockServiceEnvironment) {
  const { users, workspace } = environment;
  return {
    users: await Promise.all([
      users.getUser({ userId: "user-demo-sahyadri-editor" }),
      users.getUser({ userId: "user-demo-konkan-reviewer" }),
    ]),
    organizations: await workspace.listOrganizations(),
    publications: await Promise.all([
      workspace.listPublications({ organizationId: "org-demo-sahyadri" }),
      workspace.listPublications({ organizationId: "org-demo-konkan" }),
    ]),
    editions: await Promise.all([
      workspace.getEdition({
        organizationId: "org-demo-sahyadri",
        publicationId: "pub-demo-pune-daily",
        editionId: "edition-demo-001",
      }),
      workspace.getEdition({
        organizationId: "org-demo-sahyadri",
        publicationId: "pub-demo-urdu-evening",
        editionId: "edition-demo-urdu-001",
      }),
      workspace.getEdition({
        organizationId: "org-demo-konkan",
        publicationId: "pub-demo-ratnagiri-tide",
        editionId: "edition-demo-002",
      }),
    ]),
  };
}

function expectSuccess<T>(result: ServiceResult<T>): asserts result is { ok: true; value: T } {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`Expected success, received ${result.error.code}`);
  }
}

describe("UI003 scenario behavior", () => {
  it("keeps normal mode immediate and preserves ordinary known and unknown lookup results", async () => {
    const delay = vi.fn(async () => undefined);
    const { workspace, scenarios } = createMockServiceEnvironment({ delay });

    expect(scenarios.getScenario()).toEqual({ mode: "normal" });
    expect(
      await workspace.getOrganization({ organizationId: "org-demo-sahyadri" })
    ).toMatchObject({ ok: true, value: { id: "org-demo-sahyadri" } });
    expect(
      await workspace.getOrganization({ organizationId: "unknown-organization" })
    ).toEqual({
      ok: false,
      error: {
        code: "unavailable",
        resource: "organization",
        displayMessage: "This organization is not available.",
      },
    });
    expect(delay).not.toHaveBeenCalled();
  });

  it("holds a targeted latency call at the injected delay boundary and then returns the normal value", async () => {
    let releaseDelay: (() => void) | undefined;
    const delay = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseDelay = resolve;
        })
    );
    const normal = createMockServiceEnvironment();
    const delayed = createMockServiceEnvironment({ delay });
    delayed.scenarios.setScenario({
      mode: "latency",
      delayMs: 275,
      operations: ["edition.get"],
    });

    let settled = false;
    const pending = delayed.workspace
      .getEdition({
        organizationId: "org-demo-sahyadri",
        publicationId: "pub-demo-pune-daily",
        editionId: "edition-demo-001",
      })
      .then((result) => {
        settled = true;
        return result;
      });
    await Promise.resolve();

    expect(delay).toHaveBeenCalledOnce();
    expect(delay).toHaveBeenCalledWith(275);
    expect(settled).toBe(false);
    expect(
      await delayed.workspace.getOrganization({ organizationId: "org-demo-sahyadri" })
    ).toMatchObject({ ok: true });

    expect(releaseDelay).toBeTypeOf("function");
    releaseDelay?.();
    expect(await pending).toEqual(
      await normal.workspace.getEdition({
        organizationId: "org-demo-sahyadri",
        publicationId: "pub-demo-pune-daily",
        editionId: "edition-demo-001",
      })
    );
  });

  it("applies targeted failure before lookup and leaves untargeted operations normal", async () => {
    const environment = createMockServiceEnvironment();
    environment.scenarios.setScenario({
      mode: "failure",
      operations: ["publication.get"],
    });
    const expectedFailure = {
      ok: false,
      error: {
        code: "temporary-failure",
        displayMessage: "The demonstration service is temporarily unavailable. Try again.",
      },
    };

    const known = await environment.workspace.getPublication({
      organizationId: "org-demo-sahyadri",
      publicationId: "pub-demo-pune-daily",
    });
    const unknown = await environment.workspace.getPublication({
      organizationId: "unknown-organization",
      publicationId: "unknown-publication",
    });
    expect(known).toEqual(expectedFailure);
    expect(unknown).toEqual(expectedFailure);
    expect(await environment.workspace.listOrganizations()).toMatchObject({ ok: true });
  });

  it("applies untargeted denial before lookup with the exact demonstration qualification", async () => {
    const environment = createMockServiceEnvironment();
    environment.scenarios.setScenario({ mode: "denial" });
    const expectedDenial = {
      ok: false,
      error: {
        code: "denied",
        displayMessage: "This demonstration action is not available in the current context.",
        qualification: "Demonstration only — production authorization is not evaluated here",
      },
    };

    expect(
      await environment.users.getUser({ userId: "user-demo-sahyadri-editor" })
    ).toEqual(expectedDenial);
    expect(await environment.users.getUser({ userId: "unknown-user" })).toEqual(
      expectedDenial
    );
    expect(
      await environment.workspace.getEdition({
        organizationId: "unknown-organization",
        publicationId: "unknown-publication",
        editionId: "unknown-edition",
      })
    ).toEqual(expectedDenial);
  });

  it("rejects malformed scenario configuration immediately", () => {
    const { scenarios } = createMockServiceEnvironment();
    const invalidScenarios = [
      { mode: "latency", delayMs: -1 },
      { mode: "latency", delayMs: 1.5 },
      { mode: "latency", delayMs: 10_001 },
      { mode: "latency", delayMs: Number.NaN },
      { mode: "failure", operations: ["unknown.operation"] },
      { mode: "normal", operations: ["user.get"] },
      { mode: "denial", delayMs: 5 },
    ] as unknown as readonly MockScenario[];

    for (const scenario of invalidScenarios) {
      expect(() => scenarios.setScenario(scenario)).toThrow();
    }
    expect(scenarios.getScenario()).toEqual({ mode: "normal" });
  });
});

describe("UI003 isolation, copying, and reset", () => {
  it("isolates scenario state between independently created environments", async () => {
    const first = createMockServiceEnvironment();
    const second = createMockServiceEnvironment();
    first.scenarios.setScenario({ mode: "failure" });

    expect(await first.workspace.listOrganizations()).toMatchObject({
      ok: false,
      error: { code: "temporary-failure" },
    });
    expect(await second.workspace.listOrganizations()).toMatchObject({ ok: true });
    first.scenarios.reset();
    expect(first.scenarios.getScenario()).toEqual({ mode: "normal" });
    expect(second.scenarios.getScenario()).toEqual({ mode: "normal" });
  });

  it("returns detached DTOs, arrays, and scenario operation arrays", async () => {
    const environment = createMockServiceEnvironment();
    const organizationsResult = await environment.workspace.listOrganizations();
    expectSuccess(organizationsResult);
    const organizations = organizationsResult.value as Array<{
      id: string;
      name: string;
    }>;
    organizations[0]!.name = "Consumer mutation";
    organizations.push({ id: "consumer-added", name: "Consumer added" });

    const userResult = await environment.users.getUser({
      userId: "user-demo-sahyadri-editor",
    });
    expectSuccess(userResult);
    (userResult.value as { displayName: string }).displayName = "Consumer mutation";

    const publicationsResult = await environment.workspace.listPublications({
      organizationId: "org-demo-sahyadri",
    });
    expectSuccess(publicationsResult);
    const publications = publicationsResult.value as Array<{
      id: string;
      orgId: string;
      name: string;
      locale: string;
      direction: "ltr" | "rtl";
    }>;
    publications[0]!.name = "Consumer mutation";
    publications.push({
      id: "consumer-added",
      orgId: "org-demo-sahyadri",
      name: "Consumer added",
      locale: "en-IN",
      direction: "ltr",
    });

    const editionResult = await environment.workspace.getEdition({
      organizationId: "org-demo-sahyadri",
      publicationId: "pub-demo-pune-daily",
      editionId: "edition-demo-001",
    });
    expectSuccess(editionResult);
    (editionResult.value as { publicationId: string; label: string }).publicationId =
      "consumer-publication";
    (editionResult.value as { publicationId: string; label: string }).label =
      "Consumer mutation";

    environment.scenarios.setScenario({
      mode: "failure",
      operations: ["user.get"],
    });
    const returnedScenario = environment.scenarios.getScenario();
    if (returnedScenario.mode !== "normal" && returnedScenario.operations) {
      (returnedScenario.operations as string[]).push("organization.list");
    }

    expect(await environment.workspace.listOrganizations()).toEqual({
      ok: true,
      value: [
        { id: "org-demo-sahyadri", name: "Sahyadri Media Cooperative" },
        { id: "org-demo-konkan", name: "Konkan Coastal Press" },
      ],
    });
    environment.scenarios.setScenario({ mode: "normal" });
    expect(
      await environment.users.getUser({ userId: "user-demo-sahyadri-editor" })
    ).toMatchObject({
      ok: true,
      value: { displayName: "Sahyadri Demo Editor" },
    });
    expect(
      await environment.workspace.listPublications({
        organizationId: "org-demo-sahyadri",
      })
    ).toEqual({
      ok: true,
      value: [
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
      ],
    });
    expect(
      await environment.workspace.getEdition({
        organizationId: "org-demo-sahyadri",
        publicationId: "pub-demo-pune-daily",
        editionId: "edition-demo-001",
      })
    ).toEqual({
      ok: true,
      value: {
        id: "edition-demo-001",
        publicationId: "pub-demo-pune-daily",
        label: "edition-demo-001",
      },
    });
    expect(environment.scenarios.getScenario()).toEqual({ mode: "normal" });
  });

  it("reset repeatedly restores normal mode and a fresh canonical public snapshot", async () => {
    const environment = createMockServiceEnvironment();
    const canonical = await publicSnapshot(createMockServiceEnvironment());

    environment.scenarios.setScenario({ mode: "denial" });
    environment.scenarios.reset();
    expect(environment.scenarios.getScenario()).toEqual({ mode: "normal" });
    expect(await publicSnapshot(environment)).toEqual(canonical);

    environment.scenarios.setScenario({
      mode: "latency",
      delayMs: 0,
      operations: ["user.get"],
    });
    environment.scenarios.reset();
    expect(await publicSnapshot(environment)).toEqual(canonical);
  });
});
