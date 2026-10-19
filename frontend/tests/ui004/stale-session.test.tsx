import { describe, expect, it } from "vitest";
import { act } from "react";
import userEvent from "@testing-library/user-event";
import { screen, render, waitFor } from "../../src/test/render.tsx";
import type { ServiceResult, SessionSnapshot, SimulatedSessionService, UserQueryService } from "../../src/services/index.ts";
import { SessionProvider, useSession } from "../../src/features/auth/SessionProvider.tsx";
import { createMockApplicationEnvironment } from "../../src/mocks/index.ts";

const users: UserQueryService = {
  async getUser({ userId }) {
    return { ok: true, value: { id: userId, displayName: userId === "user-a" ? "User A" : "User B" } };
  },
};

function Probe() {
  const { state, signIn } = useSession();
  return <div><output>{state.status === "ready" ? state.user.displayName : state.status}</output><button onClick={() => void signIn("user-a")}>A</button><button onClick={() => void signIn("user-b")}>B</button></div>;
}

describe("SessionProvider stale completion protection", () => {
  it("does not let an older profile request overwrite a newer one", async () => {
    const resolvers = new Map<string, (result: ServiceResult<SessionSnapshot>) => void>();
    const service: SimulatedSessionService = {
      async listProfiles() { return { ok: true, value: [{ userId: "user-a" }, { userId: "user-b" }] }; },
      async getSession() { return { ok: true, value: { status: "signed-out" } }; },
      signIn({ userId }) { return new Promise((resolve) => resolvers.set(userId, resolve)); },
      async signOut() { return { ok: true, value: { status: "signed-out" } }; },
      async selectOrganization() { return { ok: true, value: { status: "signed-out" } }; },
      async selectPublication() { return { ok: true, value: { status: "signed-out" } }; },
    };
    render(<SessionProvider session={service} users={users}><Probe /></SessionProvider>);
    expect(await screen.findByText("signed-out")).toBeInTheDocument();
    screen.getByRole("button", { name: "A" }).click();
    screen.getByRole("button", { name: "B" }).click();
    const snapshot = (userId: string): ServiceResult<SessionSnapshot> => ({ ok: true, value: { status: "signed-in", session: { userId, access: [{ organizationId: "org", role: "editor", publicationIds: ["pub"] }], activeOrganizationId: "org", activePublicationId: "pub" } } });
    await act(async () => { resolvers.get("user-b")?.(snapshot("user-b")); });
    expect(await screen.findByText("User B")).toBeInTheDocument();
    await act(async () => { resolvers.get("user-a")?.(snapshot("user-a")); });
    expect(screen.getByText("User B")).toBeInTheDocument();
  });

  it("keeps the session signed out when a slow sign-in finishes after sign-out", async () => {
    let release!: () => void;
    const environment = createMockApplicationEnvironment({
      delay: () => new Promise<void>((resolve) => { release = resolve; }),
    });
    environment.scenarios.setScenario({ mode: "latency", delayMs: 1, operations: ["user.get"] });

    const oldSignIn = environment.session.signIn({ userId: "user-demo-konkan-reviewer" });
    await waitFor(() => expect(release).toBeTypeOf("function"));
    await environment.session.signOut();
    release();
    await oldSignIn;

    await expect(environment.session.getSession()).resolves.toEqual({
      ok: true,
      value: { status: "signed-out" },
    });
  });

  it("keeps the newer sign-in when an older sign-in completes last", async () => {
    const releases: Array<() => void> = [];
    const environment = createMockApplicationEnvironment({
      delay: () => new Promise<void>((resolve) => { releases.push(resolve); }),
    });
    environment.sessionController.setPreset("signed-out");
    environment.scenarios.setScenario({ mode: "latency", delayMs: 1, operations: ["user.get"] });

    const older = environment.session.signIn({ userId: "user-demo-sahyadri-editor" });
    const newer = environment.session.signIn({ userId: "user-demo-konkan-reviewer" });
    await waitFor(() => expect(releases).toHaveLength(2));
    releases[1]!();
    await newer;
    releases[0]!();
    await older;

    await expect(environment.session.getSession()).resolves.toMatchObject({
      ok: true,
      value: { status: "signed-in", session: { userId: "user-demo-konkan-reviewer" } },
    });
  });

  it("keeps reset authoritative when a pending mutation completes", async () => {
    let release!: () => void;
    const environment = createMockApplicationEnvironment({
      delay: () => new Promise<void>((resolve) => { release = resolve; }),
    });
    environment.scenarios.setScenario({ mode: "latency", delayMs: 1, operations: ["user.get"] });

    const pending = environment.session.signIn({ userId: "user-demo-konkan-reviewer" });
    await waitFor(() => expect(release).toBeTypeOf("function"));
    environment.reset();
    release();
    await pending;

    await expect(environment.session.getSession()).resolves.toMatchObject({
      ok: true,
      value: {
        status: "signed-in",
        session: {
          userId: "user-demo-sahyadri-editor",
          activeOrganizationId: "org-demo-sahyadri",
          activePublicationId: "pub-demo-pune-daily",
        },
      },
    });
  });

  it("invalidates an actual pending session mutation when the provider unmounts", async () => {
    let release!: () => void;
    let pending!: Promise<ServiceResult<SessionSnapshot>>;
    const environment = createMockApplicationEnvironment({
      delay: () => new Promise<void>((resolve) => { release = resolve; }),
    });

    function ActualServiceProbe() {
      const { state, signIn } = useSession();
      return (
        <div>
          <output>{state.status === "ready" ? state.user.displayName : state.status}</output>
          <button onClick={() => { pending = signIn("user-demo-konkan-reviewer"); }}>Switch</button>
        </div>
      );
    }

    const view = render(
      <SessionProvider
        session={environment.session}
        users={environment.users}
        invalidatePendingMutations={environment.invalidatePendingSessionMutations}
      >
        <ActualServiceProbe />
      </SessionProvider>
    );
    expect(await screen.findByText("Sahyadri Demo Editor")).toBeInTheDocument();
    environment.scenarios.setScenario({ mode: "latency", delayMs: 1, operations: ["user.get"] });
    await userEvent.setup().click(screen.getByRole("button", { name: "Switch" }));
    await waitFor(() => expect(release).toBeTypeOf("function"));
    view.unmount();
    release();
    await pending;

    await expect(environment.session.getSession()).resolves.toMatchObject({
      ok: true,
      value: { status: "signed-in", session: { userId: "user-demo-sahyadri-editor" } },
    });
  });
});
