/**
 * Account → Security, /account/security (plan §10 PR 14): two-step set up with a QR code, its key and the backup
 * codes, confirmed with the app's first code, which signs out every other device (said before and after); new backup
 * codes and turning it off with the password; the signed-in devices with their own Sign out; the loading, error and
 * offline states; Marathi; axe. On the test double, fictional data only.
 */
import { afterEach, describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "../../src/test/render.tsx";
import { createMockApplicationEnvironment } from "../../src/mocks/index.ts";
import { currentLocation, renderAuth, resetBrowserState, seriousViolations } from "../auth/helpers.tsx";

const fixtures = createMockApplicationEnvironment().sessionController.fixtures;
const { editor, owner } = fixtures.accounts;

afterEach(resetBrowserState);

async function typePassword(user: ReturnType<typeof userEvent.setup>, password: string, submit: string) {
  await user.type(await screen.findByLabelText("Your password"), password);
  await user.click(screen.getByRole("button", { name: submit }));
}

describe("Account security", () => {
  it("sends a signed-out person to sign in, keeping the page", async () => {
    const { container } = renderAuth("/account/security", { preset: "signed-out" });
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    expect(currentLocation(container)).toMatchObject({ pathname: "/login", search: "?returnTo=%2Faccount%2Fsecurity" });
  });

  it("sets two-step up with a QR code, its key and backup codes, and says it signs out every other device", async () => {
    const { environment } = renderAuth("/account/security", { preset: "sahyadri-editor" });
    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { level: 1, name: "Account security" })).toBeInTheDocument();
    expect(screen.getByText(/Two-step sign-in is off\./)).toBeInTheDocument();
    expect(await screen.findByText("Chrome on Android")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Turn on two-step sign-in" }));
    // said before the change
    expect(screen.getByText("Turning it on signs you out on every other device.")).toBeInTheDocument();
    await typePassword(user, "not the password", "Continue");
    expect(await screen.findByText("This password is not right.")).toBeInTheDocument();
    await typePassword(user, editor.password, "Continue");

    const qr = await screen.findByRole("img", { name: "QR code for your authenticator app" });
    expect(qr.tagName.toLowerCase()).toBe("svg");
    expect(qr.querySelector("path")?.getAttribute("d")?.length).toBeGreaterThan(100);
    expect(screen.getByText("If you cannot scan it, type this key into the app: JBSW Y3DP EHPK 3PXP")).toBeInTheDocument();
    expect(screen.getByText("Turning it on signs you out on every other device.")).toBeInTheDocument();
    expect(screen.getByText("FICTD-44444")).toBeInTheDocument();
    expect(screen.getByText("FICTF-66666").closest("ul")).toHaveAttribute("lang", "en");

    await user.type(screen.getByLabelText("Code from the app"), "000000");
    await user.click(screen.getByRole("button", { name: "Turn on" }));
    expect(await screen.findByText("That code is not right")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Code from the app"), fixtures.totpCode);
    await user.click(screen.getByRole("button", { name: "Turn on" }));

    // and said after it: the other device is gone from the list
    expect(await screen.findByText("Two-step sign-in is on. Every other device has been signed out.")).toBeInTheDocument();
    expect(await screen.findByText(/Two-step sign-in is on\. Signing in asks/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Chrome on Android")).not.toBeInTheDocument());
    expect(screen.getByText("No other device is signed in.")).toBeInTheDocument();
    expect(screen.getByText("FICTD-44444")).toBeInTheDocument(); // the codes stay on screen until the person leaves
    expect(environment.sessionController.twoStepState().sessionTwoStep).toBe(true);
  });

  it("asks for a 6-digit code before sending it", async () => {
    renderAuth("/account/security", { preset: "sahyadri-editor" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Turn on two-step sign-in" }));
    await typePassword(user, editor.password, "Continue");
    await user.click(await screen.findByRole("button", { name: "Turn on" }));
    expect(screen.getByLabelText("Code from the app")).toHaveAccessibleDescription(/Enter the 6-digit code\./);
  });

  it("makes new backup codes and turns two-step off with the password, warning of the organisation's rule", async () => {
    renderAuth("/account/security", { preset: "sahyadri-owner" });
    const user = userEvent.setup();
    expect(await screen.findByText(/Two-step sign-in is on\. Signing in asks/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Make new backup codes" }));
    await typePassword(user, owner.password, "Make new backup codes");
    expect(await screen.findByText("New backup codes are ready. The old ones no longer work.")).toBeInTheDocument();
    expect(screen.getByText("FICTG-77777")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Turn off two-step sign-in" }));
    expect(
      screen.getByText(/Without it, your password alone signs you in\. Your role in Sahyadri Media Cooperative needs two-step sign-in\./),
    ).toBeInTheDocument();
    await typePassword(user, owner.password, "Turn off two-step sign-in");
    expect(await screen.findByText("Two-step sign-in is off.")).toBeInTheDocument();
    expect(await screen.findByText("Your role in Sahyadri Media Cooperative needs two-step sign-in.")).toBeInTheDocument();
  });

  it("lists the signed-in devices, marks this one, and signs one out or every other", async () => {
    renderAuth("/account/security", { preset: "sahyadri-editor" });
    const user = userEvent.setup();
    expect(await screen.findByText("Chrome on macOS")).toBeInTheDocument();
    expect(screen.getByText("This device")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out Chrome on macOS" })).not.toBeInTheDocument();
    expect(screen.getByText("Internet address 192.0.2.15")).toBeInTheDocument();
    expect(screen.getByText("Last active 21 Oct 2026, 6:30 pm")).toBeInTheDocument(); // India's time
    await user.click(screen.getByRole("button", { name: "Sign out Chrome on Android" }));
    expect(await screen.findByText("Chrome on Android is signed out.")).toBeInTheDocument();
    expect(screen.getByText("No other device is signed in.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out on every other device" })).not.toBeInTheDocument();
  });

  it("signs out every other device at once", async () => {
    renderAuth("/account/security", { preset: "sahyadri-editor" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Sign out on every other device" }));
    expect(await screen.findByText("Every other device is signed out.")).toBeInTheDocument();
  });

  it("shows a failure with Retry, and recovers", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setProblem({ kind: "offline" }, ["security.listDevices"]);
    renderAuth("/account/security", { preset: "sahyadri-editor", environment });
    expect(await screen.findByText("You are offline")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(); // there on arrival: not announced
    environment.sessionController.setProblem(null, ["security.listDevices"]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Chrome on macOS")).toBeInTheDocument();
  });

  it("says why and offers Retry when the account or /me cannot be read, instead of loading for ever", async () => {
    const environment = createMockApplicationEnvironment();
    environment.scenarios.setScenario({ mode: "failure", operations: ["access.get"] });
    renderAuth("/account/security", { preset: "sahyadri-editor", environment });
    expect(await screen.findByRole("heading", { level: 1, name: "We could not check whether you are signed in" })).toBeInTheDocument();
    expect(screen.queryByText("Loading your account…")).not.toBeInTheDocument();
    expect(screen.getByText("The workspace could not be loaded. Check your connection, then try again.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/demonstration/i);
    environment.scenarios.setScenario({ mode: "normal" });
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Account security" })).toBeInTheDocument();
  });

  it("is in Marathi when the person chose it, with the page's lang", async () => {
    const { container } = renderAuth("/account/security", { preset: "sahyadri-editor", language: "mr" });
    expect(await screen.findByRole("heading", { level: 1, name: "खाते सुरक्षा" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "दोन टप्प्यांचा प्रवेश सुरू करा" })).toBeInTheDocument();
    expect(await screen.findByText("हे उपकरण")).toBeInTheDocument();
    expect(container.querySelector(".pg-shell")).toHaveAttribute("lang", "mr");
  });

  it("has no serious axe violations: the devices, and the set-up with its QR code", async () => {
    const { container } = renderAuth("/account/security", { preset: "sahyadri-editor" });
    const user = userEvent.setup();
    await screen.findByText("Chrome on Android");
    expect(await seriousViolations(container)).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Turn on two-step sign-in" }));
    await typePassword(user, editor.password, "Continue");
    await screen.findByRole("img", { name: "QR code for your authenticator app" });
    expect(await seriousViolations(container)).toEqual([]);
  });
});
