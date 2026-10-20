import { act } from "react";
import { BrowserRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "../../src/test/render.tsx";
import { WorkspaceRouteProvider, useWorkspaceRouteContext } from "../../src/app/contracts/route-context.ts";
import { SessionProvider } from "../../src/features/auth/SessionProvider.tsx";
import { createMockApplicationEnvironment, type MockApplicationEnvironment } from "../../src/mocks/index.ts";
import { renderUi004 } from "./renderUi004.tsx";

const PUNE = "/org/org-demo-sahyadri/pub/pub-demo-pune-daily/overview";
const URDU = "/org/org-demo-sahyadri/pub/pub-demo-urdu-evening/overview";

function controlledEnvironment() {
  const releases: Array<() => void> = [];
  const environment = createMockApplicationEnvironment({
    delay: () => new Promise<void>((resolve) => { releases.push(resolve); }),
  });
  environment.scenarios.setScenario({ mode: "latency", delayMs: 1, operations: ["organization.list"] });
  return { environment, releases };
}

async function expectPuneSession(environment: MockApplicationEnvironment) {
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
}

describe("WorkspaceRouteProvider stale side-effect protection", () => {
  it("does not let slow route A synchronize after route B becomes current", async () => {
    const { environment, releases } = controlledEnvironment();
    renderUi004(URDU, undefined, environment);
    await waitFor(() => expect(releases).toHaveLength(1));

    await act(async () => {
      window.history.pushState(null, "", PUNE);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await waitFor(() => expect(releases).toHaveLength(2));
    releases[1]!();
    expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeInTheDocument();
    releases[0]!();
    await act(async () => {});

    await expectPuneSession(environment);
  });

  it("does not synchronize an old route after the session changes", async () => {
    const { environment, releases } = controlledEnvironment();
    renderUi004(URDU, undefined, environment);
    await waitFor(() => expect(releases).toHaveLength(1));

    await environment.session.signIn({ userId: "user-demo-konkan-reviewer" });
    releases[0]!();
    await act(async () => {});

    await expect(environment.session.getSession()).resolves.toMatchObject({
      ok: true,
      value: { status: "signed-in", session: { userId: "user-demo-konkan-reviewer" } },
    });
  });

  it("does not synchronize an old route after logout", async () => {
    const { environment, releases } = controlledEnvironment();
    renderUi004(URDU, undefined, environment);
    await waitFor(() => expect(releases).toHaveLength(1));

    await environment.session.signOut();
    releases[0]!();
    await act(async () => {});

    await expect(environment.session.getSession()).resolves.toEqual({
      ok: true,
      value: { status: "signed-out" },
    });
  });

  it("does not synchronize an old route after reset", async () => {
    const { environment, releases } = controlledEnvironment();
    renderUi004(URDU, undefined, environment);
    await waitFor(() => expect(releases).toHaveLength(1));

    environment.reset();
    releases[0]!();
    await act(async () => {});

    await expectPuneSession(environment);
  });

  it("does not let a cross-organization sync override a reset that lands mid-sequence", async () => {
    // Navigating to another granted organization's publication makes the
    // provider synchronize both the active organization and publication.
    // A reset landing between those steps must stay authoritative.
    const releases: Array<() => void> = [];
    const environment = createMockApplicationEnvironment({
      delay: () => new Promise<void>((resolve) => { releases.push(resolve); }),
    });
    // Start in Konkan so the next navigation genuinely crosses organizations.
    renderUi004(
      "/org/org-demo-konkan/pub/pub-demo-ratnagiri-tide/overview",
      undefined,
      environment
    );
    await screen.findByRole("heading", { level: 1, name: "Overview" });
    await waitFor(async () => {
      await expect(environment.session.getSession()).resolves.toMatchObject({
        ok: true,
        value: { session: { activeOrganizationId: "org-demo-konkan" } },
      });
    });

    // Delay the identity lookup the provider performs while committing the
    // organization step, so a reset can land before the publication step.
    environment.scenarios.setScenario({ mode: "latency", delayMs: 1, operations: ["user.get"] });
    await act(async () => {
      window.history.pushState(null, "", URDU);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await waitFor(() => expect(releases.length).toBeGreaterThan(0));

    environment.reset();
    releases.forEach((release) => { release(); });
    await act(async () => {});

    // Reset restores Sahyadri / Pune Daily. A stale publication step would
    // have moved the session on to Urdu Evening instead.
    await expectPuneSession(environment);
  });

  it("allows only the retried generation to synchronize context", async () => {
    const { environment, releases } = controlledEnvironment();
    window.history.pushState(null, "", URDU);

    function Probe() {
      const { state, retry } = useWorkspaceRouteContext();
      return <div><output>{state.status}</output><button onClick={retry}>Retry resolution</button></div>;
    }

    render(
      <BrowserRouter>
        <SessionProvider
          session={environment.session}
          users={environment.users}
          invalidatePendingMutations={environment.invalidatePendingSessionMutations}
        >
          <Routes>
            <Route path="/org/:orgId/pub/:pubId/overview" element={
              <WorkspaceRouteProvider
                workspace={environment.workspace}
                releases={[]}
                getSessionMutationGeneration={environment.getSessionMutationGeneration}
              >
                <Probe />
              </WorkspaceRouteProvider>
            } />
          </Routes>
        </SessionProvider>
      </BrowserRouter>
    );

    await waitFor(() => expect(releases).toHaveLength(1));
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry resolution" }));
    await waitFor(() => expect(releases).toHaveLength(2));
    releases[1]!();
    await waitFor(() => expect(releases).toHaveLength(3));
    releases[2]!();
    expect(await screen.findByText("allowed")).toBeInTheDocument();
    releases[0]!();
    await act(async () => {});

    await expect(environment.session.getSession()).resolves.toMatchObject({
      ok: true,
      value: { status: "signed-in", session: { activePublicationId: "pub-demo-urdu-evening" } },
    });
  });
});
