import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen } from "../../src/test/render.tsx";
import { createMockApplicationEnvironment } from "../../src/mocks/index.ts";
import { renderUi004, signInWithForm } from "./renderUi004.tsx";

const PUNE = "/org/org-demo-sahyadri/pub/pub-demo-pune-daily/overview";

describe("UI004 temporary-failure announcements", () => {
  it("keeps initial session and workspace failures non-live", async () => {
    const sessionEnvironment = createMockApplicationEnvironment();
    sessionEnvironment.scenarios.setScenario({ mode: "failure", operations: ["session.get"] });
    const sessionView = renderUi004("/login", undefined, sessionEnvironment);
    expect(await screen.findByText("Something went wrong on our side")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    sessionView.unmount();

    const workspaceEnvironment = createMockApplicationEnvironment();
    workspaceEnvironment.scenarios.setScenario({ mode: "failure", operations: ["organization.list"] });
    renderUi004(PUNE, undefined, workspaceEnvironment);
    expect(await screen.findByText("The workspace could not be loaded. Check your connection, then try again.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("announces a user-triggered sign-in failure assertively", async () => {
    const environment = createMockApplicationEnvironment();
    renderUi004("/login", "signed-out", environment);
    await screen.findByLabelText("Email address");
    environment.scenarios.setScenario({ mode: "failure", operations: ["session.signIn"] });
    await signInWithForm(userEvent.setup(), environment.sessionController.fixtures.accounts.editor);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong on our side");
    expect(alert).toHaveTextContent("Reference: mock-request");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("makes a failed retry assertive without duplicate alerts", async () => {
    const environment = createMockApplicationEnvironment();
    environment.scenarios.setScenario({ mode: "failure", operations: ["organization.list"] });
    renderUi004(PUNE, undefined, environment);
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await userEvent.setup().click(retry);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The workspace could not be loaded. Check your connection, then try again.");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });
});
