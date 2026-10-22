/**
 * Two-step at sign-in, /mfa (plan §4.4, §10 PR 14): after a right password the person enters the app's code or a
 * backup code, may trust the device for 30 days, and goes back to where they were; a wrong code, too many, and an
 * expired sign-in each say so. Marathi and axe. On the test double, fictional data only.
 */
import { afterEach, describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen } from "../../src/test/render.tsx";
import { createMockApplicationEnvironment } from "../../src/mocks/index.ts";
import { currentLocation, renderAuth, resetBrowserState, seriousViolations } from "../auth/helpers.tsx";

const fixtures = createMockApplicationEnvironment().sessionController.fixtures;
const { owner } = fixtures.accounts;

afterEach(resetBrowserState);

async function signInAsOwner(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText("Email address"), owner.email);
  await user.type(screen.getByLabelText("Password"), owner.password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  return screen.findByRole("heading", { level: 1, name: "Two-step sign-in" });
}

describe("Two-step at sign-in", () => {
  it("asks for the app's code after the password, then opens the organisation", async () => {
    const { container, environment } = renderAuth("/login", { preset: "signed-out" });
    const user = userEvent.setup();
    await signInAsOwner(user);
    expect(currentLocation(container).pathname).toBe("/mfa");
    expect(screen.getByText("Enter the 6-digit code from your authenticator app.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(screen.getByLabelText("Code from the app")).toHaveAccessibleDescription(/Enter the 6-digit code\./);

    await user.type(screen.getByLabelText("Code from the app"), "000000");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That code is not right");

    await user.type(screen.getByLabelText("Code from the app"), fixtures.totpCode);
    await user.click(screen.getByRole("checkbox", { name: "Trust this device for 30 days" }));
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Sahyadri Media Cooperative" })).toBeInTheDocument();
    expect(currentLocation(container).pathname).toBe("/org/org-demo-sahyadri");
    expect(environment.sessionController.twoStepState()).toEqual({ sessionTwoStep: true, trustedDevice: true });
  });

  it("keeps the page the person was going to", async () => {
    const { container } = renderAuth(`/login?returnTo=${encodeURIComponent("/org/org-demo-sahyadri/team")}`, { preset: "signed-out" });
    const user = userEvent.setup();
    await signInAsOwner(user);
    expect(currentLocation(container).search).toBe("?returnTo=%2Forg%2Forg-demo-sahyadri%2Fteam");
    await user.type(screen.getByLabelText("Code from the app"), fixtures.totpCode);
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Team" })).toBeInTheDocument();
    expect(currentLocation(container).pathname).toBe("/org/org-demo-sahyadri/team");
  });

  it("takes a backup code once", async () => {
    const { environment } = renderAuth("/login", { preset: "signed-out" });
    const user = userEvent.setup();
    await signInAsOwner(user);
    await user.click(screen.getByRole("button", { name: "Use a backup code instead" }));
    expect(screen.getByLabelText("Backup code")).toHaveFocus();
    await user.type(screen.getByLabelText("Backup code"), fixtures.backupCodes[0]!);
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Sahyadri Media Cooperative" })).toBeInTheDocument();

    await environment.session.signOut();
    await environment.session.signIn({ email: owner.email, password: owner.password, rememberMe: false });
    expect(await environment.session.verifyTwoStep({ code: fixtures.backupCodes[0]!, kind: "backup", trustDevice: false })).toMatchObject({
      ok: false,
      error: { code: "INVALID_BACKUP_CODE" },
    });
  });

  it("says when there were too many wrong codes, and offers to sign in again", async () => {
    renderAuth("/login", { preset: "signed-out" });
    const user = userEvent.setup();
    await signInAsOwner(user);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await user.type(screen.getByLabelText("Code from the app"), "111111");
      await user.click(screen.getByRole("button", { name: "Verify" }));
      await screen.findByRole("alert");
    }
    expect(screen.getByRole("alert")).toHaveTextContent("Too many wrong codes");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });

  it("says when the sign-in it belongs to has expired", async () => {
    renderAuth("/mfa", { preset: "signed-out" });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Code from the app"), fixtures.totpCode);
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This sign-in has expired");
  });

  it("is in Marathi, and has no serious axe violations", async () => {
    const { container } = renderAuth("/mfa", { preset: "signed-out", language: "mr" });
    expect(await screen.findByRole("heading", { level: 1, name: "दोन टप्प्यांचा प्रवेश" })).toBeInTheDocument();
    expect(screen.getByLabelText("ॲपमधील कोड")).toBeInTheDocument();
    expect(container.querySelector(".pg-shell")).toHaveAttribute("lang", "mr");
    expect(await seriousViolations(container)).toEqual([]);
  });
});
