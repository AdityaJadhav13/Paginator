import { describe, expect, it, vi } from "vitest";
import { createMockApplicationEnvironment } from "../../src/mocks/index.ts";

describe("UI004 simulated session service", () => {
  it("exposes exactly six promise-returning methods", async () => {
    const { session } = createMockApplicationEnvironment();
    expect(Object.keys(session).sort()).toEqual([
      "getSession", "listProfiles", "selectOrganization", "selectPublication", "signIn", "signOut",
    ]);
    await expect(session.getSession()).resolves.toMatchObject({ ok: true });
  });

  it("starts with the exact Sahyadri editor session and canonical UI003 identity", async () => {
    const environment = createMockApplicationEnvironment();
    const result = await environment.session.getSession();
    expect(result).toEqual({
      ok: true,
      value: {
        status: "signed-in",
        session: {
          userId: "user-demo-sahyadri-editor",
          access: [
            { organizationId: "org-demo-sahyadri", role: "editor", publicationIds: ["pub-demo-pune-daily", "pub-demo-urdu-evening"] },
            { organizationId: "org-demo-konkan", role: "reviewer", publicationIds: ["pub-demo-ratnagiri-tide"] },
          ],
          activeOrganizationId: "org-demo-sahyadri",
          activePublicationId: "pub-demo-pune-daily",
        },
      },
    });
    await expect(environment.users.getUser({ userId: "user-demo-sahyadri-editor" })).resolves.toMatchObject({ ok: true, value: { displayName: "Sahyadri Demo Editor" } });
  });

  it("uses the exact reviewer grant and supports local sign-out during UI003 failure", async () => {
    const environment = createMockApplicationEnvironment();
    const signedIn = await environment.session.signIn({ userId: "user-demo-konkan-reviewer" });
    expect(signedIn).toMatchObject({ ok: true, value: { status: "signed-in", session: { activeOrganizationId: "org-demo-konkan", activePublicationId: "pub-demo-ratnagiri-tide", access: [{ role: "reviewer" }] } } });
    environment.scenarios.setScenario({ mode: "failure", operations: ["user.get"] });
    await expect(environment.session.signOut()).resolves.toEqual({ ok: true, value: { status: "signed-out" } });
  });

  it("returns indistinguishable denials without mutation for invalid selections", async () => {
    const environment = createMockApplicationEnvironment();
    const before = await environment.session.getSession();
    const results = await Promise.all([
      environment.session.selectOrganization({ organizationId: "org-unknown" }),
      environment.session.selectPublication({ organizationId: "org-demo-sahyadri", publicationId: "pub-unknown" }),
      environment.session.selectPublication({ organizationId: "org-demo-sahyadri", publicationId: "pub-demo-ratnagiri-tide" }),
    ]);
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    expect(await environment.session.getSession()).toEqual(before);
  });

  it("rejects non-canonical profiles and validates controller presets", async () => {
    const environment = createMockApplicationEnvironment();
    await expect(environment.session.signIn({ userId: "user-unknown" })).resolves.toMatchObject({ ok: false, error: { code: "denied" } });
    expect(() => environment.sessionController.setPreset("invalid" as never)).toThrow(RangeError);
  });

  it("defensively copies profiles, sessions, grants, and publication arrays", async () => {
    const environment = createMockApplicationEnvironment();
    const profiles = await environment.session.listProfiles();
    const snapshot = await environment.session.getSession();
    expect(profiles.ok && snapshot.ok && snapshot.value.status === "signed-in").toBe(true);
    if (!profiles.ok || !snapshot.ok || snapshot.value.status !== "signed-in") return;
    (profiles.value as { userId: string }[])[0]!.userId = "mutated";
    (snapshot.value.session as { userId: string }).userId = "mutated";
    (snapshot.value.session.access as unknown as { organizationId: string; publicationIds: string[] }[])[0]!.organizationId = "mutated";
    (snapshot.value.session.access[0]!.publicationIds as string[])[0] = "mutated";
    const profilesAgain = await environment.session.listProfiles();
    expect(profilesAgain.ok && profilesAgain.value[0]?.userId).toBe("user-demo-sahyadri-editor");
    const snapshotAgain = await environment.session.getSession();
    expect(snapshotAgain).toMatchObject({ ok: true, value: { session: { userId: "user-demo-sahyadri-editor" } } });
    if (snapshotAgain.ok && snapshotAgain.value.status === "signed-in") {
      expect(snapshotAgain.value.session.access[0]).toMatchObject({ organizationId: "org-demo-sahyadri", publicationIds: ["pub-demo-pune-daily", "pub-demo-urdu-evening"] });
    }
  });

  it("resets atomically, repeatedly, and independently", async () => {
    const first = createMockApplicationEnvironment();
    const second = createMockApplicationEnvironment();
    await first.session.signOut();
    first.scenarios.setScenario({ mode: "denial", operations: ["organization.list"] });
    first.reset();
    first.reset();
    expect(await first.session.getSession()).toEqual(await second.session.getSession());
    expect(first.scenarios.getScenario()).toEqual({ mode: "normal" });
    expect(second.sessionController.getPreset()).toBe("sahyadri-editor");
  });

  it("normal operations call no forbidden network, persistence, or nondeterministic APIs", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const randomSpy = vi.spyOn(Math, "random");
    const nowSpy = vi.spyOn(Date, "now");
    const localSpy = vi.spyOn(Storage.prototype, "setItem");
    const storageReadSpy = vi.spyOn(Storage.prototype, "getItem");
    const indexedDbOpen = vi.fn();
    vi.stubGlobal("indexedDB", { open: indexedDbOpen });
    const cryptoSpy = vi.spyOn(crypto, "getRandomValues");
    const xhrSpy = vi.spyOn(XMLHttpRequest.prototype, "open");
    const originalWebSocket = globalThis.WebSocket;
    const webSocketSpy = vi.fn();
    vi.stubGlobal("WebSocket", webSocketSpy);
    try {
      const environment = createMockApplicationEnvironment();
      await environment.session.listProfiles();
      await environment.session.getSession();
      await environment.session.selectPublication({ organizationId: "org-demo-sahyadri", publicationId: "pub-demo-urdu-evening" });
      await environment.session.selectOrganization({ organizationId: "org-demo-konkan" });
      await environment.session.signOut();
      await environment.session.signIn({ userId: "user-demo-sahyadri-editor" });
      for (const spy of [fetchSpy, randomSpy, nowSpy, localSpy, storageReadSpy, indexedDbOpen, cryptoSpy, xhrSpy, webSocketSpy]) expect(spy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      globalThis.WebSocket = originalWebSocket;
      vi.restoreAllMocks();
    }
  });
});
