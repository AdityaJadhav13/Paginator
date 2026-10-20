import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen } from "../../src/test/render.tsx";
import { createMockApplicationEnvironment } from "../../src/mocks/index.ts";
import { renderUi004 } from "./renderUi004.tsx";

const PUNE = "/org/org-demo-sahyadri/pub/pub-demo-pune-daily/overview";

describe("UI004 temporary-failure announcements", () => {
  it("keeps initial session and workspace failures non-live", async () => {
    const sessionEnvironment = createMockApplicationEnvironment();
    sessionEnvironment.scenarios.setScenario({ mode: "failure", operations: ["user.get"] });
    const sessionView = renderUi004("/login", undefined, sessionEnvironment);
    expect(await screen.findByText("The demonstration service is temporarily unavailable. Try again.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    sessionView.unmount();

    const workspaceEnvironment = createMockApplicationEnvironment();
    workspaceEnvironment.scenarios.setScenario({ mode: "failure", operations: ["organization.list"] });
    renderUi004(PUNE, undefined, workspaceEnvironment);
    expect(await screen.findByText("The demonstration service is temporarily unavailable. Try again.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("announces a user-triggered session failure assertively", async () => {
    const environment = createMockApplicationEnvironment();
    renderUi004("/login", "signed-out", environment);
    const profile = await screen.findByRole("button", { name: "Sahyadri Demo Editor" });
    environment.scenarios.setScenario({ mode: "failure", operations: ["user.get"] });
    await userEvent.setup().click(profile);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The demonstration service is temporarily unavailable. Try again.");
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
    expect(alert).toHaveTextContent("The demonstration service is temporarily unavailable. Try again.");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });
});
