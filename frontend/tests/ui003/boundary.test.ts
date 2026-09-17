import { describe, expect, it, vi } from "vitest";
import * as publicMocks from "../../src/mocks/index.ts";

const serviceModules = import.meta.glob("/src/services/**/*.{ts,tsx}", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const mockModules = import.meta.glob("/src/mocks/**/*.{ts,tsx}", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function importsIn(source: string): string[] {
  return [...source.matchAll(/\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g)].map(
    (match) => match[1]!
  );
}

describe("UI003 replaceable boundaries", () => {
  it("keeps product service contracts independent of mocks, frameworks, apps, demos, and storage", () => {
    const forbidden = /(?:^|\/)(?:mocks|react|app|apps|demo|features|storage)(?:\/|$)/;
    const violations = Object.entries(serviceModules).flatMap(([path, source]) =>
      importsIn(withoutComments(source))
        .filter((specifier) => forbidden.test(specifier))
        .map((specifier) => `${path} -> ${specifier}`)
    );

    expect(violations).toEqual([]);
  });

  it("keeps mocks pointed inward to services and their own directory", () => {
    const violations = Object.entries(mockModules).flatMap(([path, source]) =>
      importsIn(withoutComments(source))
        .filter(
          (specifier) =>
            !specifier.startsWith("../services/") && !specifier.startsWith("./")
        )
        .map((specifier) => `${path} -> ${specifier}`)
    );

    expect(violations).toEqual([]);
  });

  it("exports only the factory at runtime and keeps seed storage private", () => {
    expect(Object.keys(publicMocks)).toEqual(["createMockServiceEnvironment"]);

    const publicBarrel = mockModules["/src/mocks/index.ts"] ?? "";
    expect(publicBarrel).not.toMatch(/seed|createCanonicalSeed|MockSeedSnapshot/);
  });

  it("does not touch forbidden runtime APIs during normal service operations", async () => {
    const fetchSpy = vi.fn();
    const xhrSpy = vi.fn();
    const webSocketSpy = vi.fn();
    const localStorageSpies = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(),
    };
    const sessionStorageSpies = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(),
    };
    const indexedDbSpies = {
      open: vi.fn(),
      deleteDatabase: vi.fn(),
      databases: vi.fn(),
    };
    const serviceWorkerGet = vi.fn();
    const originalServiceWorker = Object.getOwnPropertyDescriptor(
      Navigator.prototype,
      "serviceWorker"
    );

    try {
      vi.stubGlobal("fetch", fetchSpy);
      vi.stubGlobal("XMLHttpRequest", xhrSpy);
      vi.stubGlobal("WebSocket", webSocketSpy);
      vi.stubGlobal("localStorage", localStorageSpies);
      vi.stubGlobal("sessionStorage", sessionStorageSpies);
      vi.stubGlobal("indexedDB", indexedDbSpies);
      Object.defineProperty(Navigator.prototype, "serviceWorker", {
        configurable: true,
        get: serviceWorkerGet,
      });

      const cookieGetSpy = vi.spyOn(Document.prototype, "cookie", "get");
      const cookieSetSpy = vi.spyOn(Document.prototype, "cookie", "set");
      const randomSpy = vi.spyOn(Math, "random");
      const dateNowSpy = vi.spyOn(Date, "now");
      const randomUuidSpy = vi.spyOn(globalThis.crypto, "randomUUID");
      const timerSpy = vi.spyOn(globalThis, "setTimeout");

      const { users, workspace } = publicMocks.createMockServiceEnvironment();
      const results = await Promise.all([
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
      ]);

      expect(results.every((result) => result.ok)).toBe(true);
      const forbiddenApiSpies = [
        fetchSpy,
        xhrSpy,
        webSocketSpy,
        ...Object.values(localStorageSpies),
        ...Object.values(sessionStorageSpies),
        ...Object.values(indexedDbSpies),
        serviceWorkerGet,
        cookieGetSpy,
        cookieSetSpy,
        randomSpy,
        dateNowSpy,
        randomUuidSpy,
        timerSpy,
      ];
      for (const spy of forbiddenApiSpies) {
        expect(spy).not.toHaveBeenCalled();
      }
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      if (originalServiceWorker) {
        Object.defineProperty(
          Navigator.prototype,
          "serviceWorker",
          originalServiceWorker
        );
      } else {
        Reflect.deleteProperty(Navigator.prototype, "serviceWorker");
      }
    }
  });

  it("contains no network, persistence, nondeterminism, production schema, or release scope", () => {
    const sources = Object.values({ ...serviceModules, ...mockModules })
      .map(withoutComments)
      .join("\n");
    const forbiddenPatterns = [
      /\bfetch\s*\(/,
      /\bXMLHttpRequest\b/,
      /\bWebSocket\b/,
      /\blocalStorage\b/,
      /\bsessionStorage\b/,
      /\bindexedDB\b/,
      /\bdocument\.cookie\b/,
      /\bserviceWorker\b/,
      /\bMath\.random\b/,
      /\bDate\.now\b/,
      /\bcrypto\.randomUUID\b/,
      /\bEditableDocument\b/,
      /\bResolvedDocument\b/,
      /\bReleaseDto\b/,
      /\bArchiveDto\b/,
      /\bMembership\b/,
      /\bCapability\b/,
    ];

    expect(forbiddenPatterns.filter((pattern) => pattern.test(sources))).toEqual([]);
  });
});
