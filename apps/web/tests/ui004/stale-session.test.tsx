import { describe, expect, it } from "vitest";
import { act } from "react";
import userEvent from "@testing-library/user-event";
import { screen, render, waitFor } from "../../src/test/render.tsx";
import type { ApiProblem, ServiceResult, SessionService, SessionSnapshot } from "../../src/services/index.ts";
import { SessionProvider, useSession } from "../../src/features/auth/SessionProvider.tsx";
import { createMockApplicationEnvironment } from "../../src/mocks/index.ts";

type Answer = ServiceResult<SessionSnapshot, ApiProblem>;

function signedIn(id: string, name: string): Answer {
  return {
    ok: true,
    value: { status: "signed-in", session: { user: { id, name, email: `${id}@example.test`, emailVerified: true, twoFactorEnabled: false } } },
  };
}

function Probe() {
  const { state, signIn } = useSession();
  return (
    <div>
      <output>{state.status === "ready" ? state.session.user.name : state.status}</output>
      <button onClick={() => void signIn({ email: "a@example.test", password: "password a", rememberMe: true })}>A</button>
      <button onClick={() => void signIn({ email: "b@example.test", password: "password b", rememberMe: true })}>B</button>
    </div>
  );
}

const fixtures = createMockApplicationEnvironment().sessionController.fixtures;
const REVIEWER = { email: fixtures.accounts.reviewer.email, password: fixtures.accounts.reviewer.password, rememberMe: true };
const EDITOR = { email: fixtures.accounts.editor.email, password: fixtures.accounts.editor.password, rememberMe: true };

describe("SessionProvider stale completion protection", () => {
  it("does not let an older sign-in answer overwrite a newer one", async () => {
    const resolvers = new Map<string, (result: Answer) => void>();
    const service: SessionService = {
      async getSession() { return { ok: true, value: { status: "signed-out" } }; },
      signIn({ email }) { return new Promise((resolve) => resolvers.set(email, resolve)); },
      async verifyTwoStep() { return { ok: true, value: { status: "signed-out" } }; },
      async signOut() { return { ok: true, value: { status: "signed-out" } }; },
    };
    render(<SessionProvider session={service}><Probe /></SessionProvider>);
    expect(await screen.findByText("signed-out")).toBeInTheDocument();
    screen.getByRole("button", { name: "A" }).click();
    screen.getByRole("button", { name: "B" }).click();
    await act(async () => { resolvers.get("b@example.test")?.(signedIn("user-b", "User B")); });
    expect(await screen.findByText("User B")).toBeInTheDocument();
    await act(async () => { resolvers.get("a@example.test")?.(signedIn("user-a", "User A")); });
    expect(screen.getByText("User B")).toBeInTheDocument();
  });

  it("leaves the state as it was when a sign-in fails", async () => {
    const service: SessionService = {
      async getSession() { return { ok: true, value: { status: "signed-out" } }; },
      async signIn() {
        return { ok: false, error: { kind: "answer", status: 401, code: "INVALID_EMAIL_OR_PASSWORD", message: "" } };
      },
      async verifyTwoStep() { return { ok: true, value: { status: "signed-out" } }; },
      async signOut() { return { ok: true, value: { status: "signed-out" } }; },
    };
    render(<SessionProvider session={service}><Probe /></SessionProvider>);
    expect(await screen.findByText("signed-out")).toBeInTheDocument();
    await act(async () => { screen.getByRole("button", { name: "A" }).click(); });
    expect(screen.getByText("signed-out")).toBeInTheDocument();
  });

  it("keeps the session signed out when a slow sign-in finishes after sign-out", async () => {
    let release!: () => void;
    const environment = createMockApplicationEnvironment({
      delay: () => new Promise<void>((resolve) => { release = resolve; }),
    });
    environment.scenarios.setScenario({ mode: "latency", delayMs: 1, operations: ["session.signIn"] });

    const oldSignIn = environment.session.signIn(REVIEWER);
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
    environment.scenarios.setScenario({ mode: "latency", delayMs: 1, operations: ["session.signIn"] });

    const older = environment.session.signIn(EDITOR);
    const newer = environment.session.signIn(REVIEWER);
    await waitFor(() => expect(releases).toHaveLength(2));
    releases[1]!();
    await newer;
    releases[0]!();
    await older;

    await expect(environment.session.getSession()).resolves.toMatchObject({
      ok: true,
      value: { status: "signed-in", session: { user: { id: "user-demo-konkan-reviewer" } } },
    });
  });

  it("keeps reset authoritative when a pending sign-in completes", async () => {
    let release!: () => void;
    const environment = createMockApplicationEnvironment({
      delay: () => new Promise<void>((resolve) => { release = resolve; }),
    });
    environment.scenarios.setScenario({ mode: "latency", delayMs: 1, operations: ["session.signIn"] });

    const pending = environment.session.signIn(REVIEWER);
    await waitFor(() => expect(release).toBeTypeOf("function"));
    environment.reset();
    release();
    await pending;

    await expect(environment.session.getSession()).resolves.toMatchObject({
      ok: true,
      value: { status: "signed-in", session: { user: { id: "user-demo-sahyadri-editor" } } },
    });
    await expect(environment.access.getAccess({ userId: "user-demo-sahyadri-editor" })).resolves.toMatchObject({
      value: { activeOrganizationId: "org-demo-sahyadri", activePublicationId: "pub-demo-pune-daily" },
    });
  });

  it("invalidates an actual pending sign-in when the provider unmounts", async () => {
    let release!: () => void;
    let pending!: Promise<Answer>;
    const environment = createMockApplicationEnvironment({
      delay: () => new Promise<void>((resolve) => { release = resolve; }),
    });

    function ActualServiceProbe() {
      const { state, signIn } = useSession();
      return (
        <div>
          <output>{state.status === "ready" ? state.session.user.name : state.status}</output>
          <button onClick={() => { pending = signIn(REVIEWER); }}>Switch</button>
        </div>
      );
    }

    const view = render(
      <SessionProvider
        session={environment.session}
        access={environment.access}
        invalidatePendingMutations={environment.invalidatePendingSessionMutations}
      >
        <ActualServiceProbe />
      </SessionProvider>
    );
    expect(await screen.findByText("Sahyadri Demo Editor")).toBeInTheDocument();
    environment.scenarios.setScenario({ mode: "latency", delayMs: 1, operations: ["session.signIn"] });
    await userEvent.setup().click(screen.getByRole("button", { name: "Switch" }));
    await waitFor(() => expect(release).toBeTypeOf("function"));
    view.unmount();
    release();
    await pending;

    await expect(environment.session.getSession()).resolves.toMatchObject({
      ok: true,
      value: { status: "signed-in", session: { user: { id: "user-demo-sahyadri-editor" } } },
    });
  });

  it("marks the session expired when the API answers signed_out", async () => {
    const environment = createMockApplicationEnvironment();
    function ExpiryProbe() {
      const { state } = useSession();
      return <output>{state.status === "signed-out" ? `signed-out expired=${String(state.expired)}` : state.status}</output>;
    }
    render(
      <SessionProvider session={environment.session} access={environment.access} onSignedOut={environment.onSignedOut}>
        <ExpiryProbe />
      </SessionProvider>
    );
    expect(await screen.findByText("ready")).toBeInTheDocument();
    environment.sessionController.endSession();
    await act(async () => {
      await environment.account.acceptInvitation({ invitationId: fixtures.invitations.pending.id, idempotencyKey: "k" });
    });
    expect(screen.getByText("signed-out expired=true")).toBeInTheDocument();
  });
});
