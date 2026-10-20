import { describe, expect, it } from "vitest";
import type { ServiceResult } from "../../src/services/index.ts";
import { createMockServiceEnvironment } from "../../src/mocks/index.ts";

function valueOf<T>(result: ServiceResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`Expected success, received ${result.error.code}`);
  }
  return result.value;
}

describe("UI003 canonical seed", () => {
  it("exposes the exact deterministic users, organizations, publications, and editions", async () => {
    const { users, workspace } = createMockServiceEnvironment();

    expect(
      await Promise.all([
        users.getUser({ userId: "user-demo-sahyadri-editor" }),
        users.getUser({ userId: "user-demo-konkan-reviewer" }),
      ])
    ).toEqual([
      {
        ok: true,
        value: {
          id: "user-demo-sahyadri-editor",
          displayName: "Sahyadri Demo Editor",
        },
      },
      {
        ok: true,
        value: {
          id: "user-demo-konkan-reviewer",
          displayName: "Konkan Demo Reviewer",
        },
      },
    ]);

    const organizations = valueOf(await workspace.listOrganizations());
    expect(organizations).toEqual([
      { id: "org-demo-sahyadri", name: "Sahyadri Media Cooperative" },
      { id: "org-demo-konkan", name: "Konkan Coastal Press" },
    ]);

    const sahyadriPublications = valueOf(
      await workspace.listPublications({ organizationId: "org-demo-sahyadri" })
    );
    const konkanPublications = valueOf(
      await workspace.listPublications({ organizationId: "org-demo-konkan" })
    );
    expect([...sahyadriPublications, ...konkanPublications]).toEqual([
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
    ]);

    const editionInputs = [
      ["org-demo-sahyadri", "pub-demo-pune-daily", "edition-demo-001"],
      ["org-demo-sahyadri", "pub-demo-urdu-evening", "edition-demo-urdu-001"],
      ["org-demo-konkan", "pub-demo-ratnagiri-tide", "edition-demo-002"],
    ] as const;
    const editions = await Promise.all(
      editionInputs.map(([organizationId, publicationId, editionId]) =>
        workspace.getEdition({ organizationId, publicationId, editionId })
      )
    );
    expect(editions.map(valueOf)).toEqual([
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
    ]);
  });

  it("keeps all overlapping UI002 context identities field-for-field compatible", async () => {
    const { workspace } = createMockServiceEnvironment();
    const organizations = valueOf(await workspace.listOrganizations());
    const publications = [
      ...valueOf(
        await workspace.listPublications({ organizationId: "org-demo-sahyadri" })
      ),
      ...valueOf(await workspace.listPublications({ organizationId: "org-demo-konkan" })),
    ];
    const existingEditions = await Promise.all([
      workspace.getEdition({
        organizationId: "org-demo-sahyadri",
        publicationId: "pub-demo-pune-daily",
        editionId: "edition-demo-001",
      }),
      workspace.getEdition({
        organizationId: "org-demo-konkan",
        publicationId: "pub-demo-ratnagiri-tide",
        editionId: "edition-demo-002",
      }),
    ]);

    expect({ organizations, publications, editions: existingEditions.map(valueOf) }).toEqual({
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
          id: "edition-demo-002",
          publicationId: "pub-demo-ratnagiri-tide",
          label: "edition-demo-002",
        },
      ],
    });
  });
});

describe("UI003 hierarchical scoping and non-leakage", () => {
  it("resolves records only through the correct organization/publication chain", async () => {
    const { workspace } = createMockServiceEnvironment();

    expect(
      await workspace.getOrganization({ organizationId: "org-demo-sahyadri" })
    ).toEqual({
      ok: true,
      value: { id: "org-demo-sahyadri", name: "Sahyadri Media Cooperative" },
    });
    expect(
      await workspace.getPublication({
        organizationId: "org-demo-sahyadri",
        publicationId: "pub-demo-urdu-evening",
      })
    ).toMatchObject({ ok: true, value: { direction: "rtl", locale: "ur-IN" } });
    expect(
      await workspace.getEdition({
        organizationId: "org-demo-sahyadri",
        publicationId: "pub-demo-urdu-evening",
        editionId: "edition-demo-urdu-001",
      })
    ).toMatchObject({ ok: true, value: { id: "edition-demo-urdu-001" } });
  });

  it("makes unknown and wrong-organization publication results indistinguishable", async () => {
    const { workspace } = createMockServiceEnvironment();
    const unavailablePublication = {
      ok: false,
      error: {
        code: "unavailable",
        resource: "publication",
        displayMessage: "This publication is not available in this organization.",
      },
    };

    const cases = await Promise.all([
      workspace.getPublication({
        organizationId: "org-demo-sahyadri",
        publicationId: "unknown-publication",
      }),
      workspace.getPublication({
        organizationId: "org-demo-sahyadri",
        publicationId: "pub-demo-ratnagiri-tide",
      }),
      workspace.getPublication({
        organizationId: "org-demo-konkan",
        publicationId: "unknown-publication",
      }),
      workspace.getPublication({
        organizationId: "org-demo-konkan",
        publicationId: "pub-demo-pune-daily",
      }),
    ]);

    expect(cases).toEqual(Array.from({ length: 4 }, () => unavailablePublication));
    const serialized = JSON.stringify(cases);
    expect(serialized).not.toContain("Ratnagiri");
    expect(serialized).not.toContain("Pune");
    expect(serialized).not.toContain("pub-demo-");
  });

  it("makes unknown, same-org wrong-publication, and cross-org edition results indistinguishable", async () => {
    const { workspace } = createMockServiceEnvironment();
    const inputs = [
      "unknown-edition",
      "edition-demo-urdu-001",
      "edition-demo-002",
    ] as const;
    const results = await Promise.all(
      inputs.map((editionId) =>
        workspace.getEdition({
          organizationId: "org-demo-sahyadri",
          publicationId: "pub-demo-pune-daily",
          editionId,
        })
      )
    );

    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    expect(results[0]).toEqual({
      ok: false,
      error: {
        code: "unavailable",
        resource: "edition",
        displayMessage: "This edition is not available in this publication.",
      },
    });
    expect(JSON.stringify(results)).not.toContain("edition-demo-");
  });

  it("does not reveal an edition through a publication owned by another organization", async () => {
    const { workspace } = createMockServiceEnvironment();
    const unknownPublication = await workspace.getEdition({
      organizationId: "org-demo-sahyadri",
      publicationId: "unknown-publication",
      editionId: "unknown-edition",
    });
    const foreignPublication = await workspace.getEdition({
      organizationId: "org-demo-sahyadri",
      publicationId: "pub-demo-ratnagiri-tide",
      editionId: "edition-demo-002",
    });

    expect(foreignPublication).toEqual(unknownPublication);
    expect(foreignPublication).toEqual({
      ok: false,
      error: {
        code: "unavailable",
        resource: "publication",
        displayMessage: "This publication is not available in this organization.",
      },
    });
    const serialized = JSON.stringify(foreignPublication);
    expect(serialized).not.toContain("pub-demo-ratnagiri-tide");
    expect(serialized).not.toContain("edition-demo-002");
    expect(serialized).not.toContain("Konkan");
  });

  it("stops at missing parent context and never returns a child-derived detail", async () => {
    const { workspace } = createMockServiceEnvironment();

    expect(
      await workspace.listPublications({ organizationId: "" })
    ).toMatchObject({ ok: false, error: { resource: "organization" } });
    expect(
      await workspace.getPublication({
        organizationId: "unknown-org",
        publicationId: "pub-demo-pune-daily",
      })
    ).toMatchObject({ ok: false, error: { resource: "organization" } });
    expect(
      await workspace.getEdition({
        organizationId: "org-demo-sahyadri",
        publicationId: "",
        editionId: "edition-demo-001",
      })
    ).toMatchObject({ ok: false, error: { resource: "publication" } });
    expect(
      await workspace.getEdition({
        organizationId: "org-demo-sahyadri",
        publicationId: "pub-demo-pune-daily",
        editionId: "",
      })
    ).toMatchObject({ ok: false, error: { resource: "edition" } });
  });
});
