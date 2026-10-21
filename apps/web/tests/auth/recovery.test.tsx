/**
 * Forgot and reset password (03 §5.1; plan §4.1): one generic answer for every address, the emailed token kept out of
 * the address bar, 12 characters at least, every session ended, and the loading, error and offline states, in English
 * and Marathi, with axe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "../../src/test/render.tsx";
import { createMockApplicationEnvironment } from "../../src/mocks/index.ts";
import { currentLocation, renderAuth, resetBrowserState, seriousViolations } from "./helpers.tsx";

const fixtures = createMockApplicationEnvironment().sessionController.fixtures;

beforeEach(resetBrowserState);
afterEach(() => {
  resetBrowserState();
  vi.restoreAllMocks();
});

describe("Forgot password", () => {
  it("gives the same answer for an address with an account and one without", async () => {
    const answers: string[] = [];
    for (const email of [fixtures.accounts.editor.email, "nobody@sahyadri.example"]) {
      const view = renderAuth("/forgot-password", { preset: "signed-out" });
      const user = userEvent.setup();
      await user.type(await screen.findByLabelText("Email address"), email);
      await user.click(screen.getByRole("button", { name: "Send link" }));
      const answer = await screen.findByRole("alert");
      expect(answer).toHaveTextContent("Check your email");
      expect(answer).toHaveTextContent("If that email address has an account, a link is on its way.");
      answers.push(view.container.querySelector("main")!.innerHTML);
      view.unmount();
    }
    expect(answers[0]).toBe(answers[1]);
  });

  it("checks the address first", async () => {
    const environment = createMockApplicationEnvironment();
    const request = vi.spyOn(environment.account, "requestPasswordReset");
    renderAuth("/forgot-password", { preset: "signed-out", environment });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Send link" }));
    expect(screen.getByText("Enter your email address.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email address")).toHaveFocus();
    expect(request).not.toHaveBeenCalled();
  });

  it("shows offline and server failures, with the server's reference", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setProblem({ kind: "offline" }, ["account.requestPasswordReset"]);
    renderAuth("/forgot-password", { preset: "signed-out", environment });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Email address"), fixtures.accounts.editor.email);
    await user.click(screen.getByRole("button", { name: "Send link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You are offline");

    environment.sessionController.setProblem(
      { kind: "answer", status: 500, code: "server_error", message: "Something went wrong on our side. Try again.", requestId: "req-42" },
      ["account.requestPasswordReset"]
    );
    await user.click(screen.getByRole("button", { name: "Send link" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong on our side"));
    expect(screen.getByRole("alert")).toHaveTextContent("Reference: req-42");
  });

  it("works in Marathi, and has no serious axe violations in either language", async () => {
    const view = renderAuth("/forgot-password", { preset: "signed-out", language: "mr" });
    expect(await screen.findByRole("heading", { level: 1, name: "पासवर्ड विसरलात?" })).toBeInTheDocument();
    expect(await seriousViolations(view.container)).toEqual([]);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("ईमेल पत्ता"), fixtures.accounts.editor.email);
    await user.click(screen.getByRole("button", { name: "दुवा पाठवा" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("तुमचा ईमेल पाहा");
    expect(await seriousViolations(view.container)).toEqual([]);
    view.unmount();
    const english = renderAuth("/forgot-password", { preset: "signed-out" });
    await screen.findByLabelText("Email address");
    expect(await seriousViolations(english.container)).toEqual([]);
  });
});

describe("Reset password", () => {
  const resetPath = `/reset-password?token=${fixtures.resetToken}`;

  it("takes the token out of the address bar and keeps it in the page's history state", async () => {
    const view = renderAuth(resetPath, { preset: "signed-out" });
    expect(await screen.findByRole("heading", { level: 1, name: "Choose a new password" })).toBeInTheDocument();
    await waitFor(() => expect(currentLocation(view.container).search).toBe(""));
    expect(currentLocation(view.container)).toMatchObject({
      pathname: "/reset-password",
      state: { resetToken: fixtures.resetToken },
    });
    expect(screen.getByLabelText("New password")).toBeInTheDocument();
  });

  it("counts the length toward 12 characters, and checks both fields match", async () => {
    renderAuth(resetPath, { preset: "signed-out" });
    const user = userEvent.setup();
    const password = await screen.findByLabelText("New password");
    expect(password).toHaveAccessibleDescription(/At least 12 characters\. .* 0 of at least 12 characters/);
    await user.type(password, "short one");
    expect(password).toHaveAccessibleDescription(/9 of at least 12 characters/);
    await user.click(screen.getByRole("button", { name: "Set password" }));
    expect(screen.getByText("Use at least 12 characters.")).toBeInTheDocument();
    await user.type(password, " is longer");
    expect(password).toHaveAccessibleDescription(/19 characters: long enough/);
    await user.type(screen.getByLabelText("Type the new password again"), "something else entirely");
    await user.click(screen.getByRole("button", { name: "Set password" }));
    expect(screen.getByText("The two passwords are not the same.")).toBeInTheDocument();
    expect(screen.getByLabelText("Type the new password again")).toHaveFocus();
  });

  it("sets the password, signs every session out, and points to sign in", async () => {
    const environment = createMockApplicationEnvironment();
    renderAuth(resetPath, { environment });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("New password"), "a brand new long password");
    await user.type(screen.getByLabelText("Type the new password again"), "a brand new long password");
    await user.click(screen.getByRole("button", { name: "Set password" }));
    const done = await screen.findByRole("alert");
    expect(done).toHaveTextContent("Your new password is set");
    expect(done).toHaveTextContent("Every device that was signed in has been signed out.");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(await environment.session.getSession()).toEqual({ ok: true, value: { status: "signed-out" } });
  });

  it("clears the spent token from the history entry, and a refused one too (review F4)", async () => {
    for (const [token, outcome] of [
      [fixtures.resetToken, "Your new password is set"],
      ["not-the-token", "This link cannot be used"],
    ] as const) {
      const view = renderAuth(`/reset-password?token=${token}`, { preset: "signed-out" });
      await waitFor(() => expect(currentLocation(view.container).state).toEqual({ resetToken: token }));
      const user = userEvent.setup();
      await user.type(await screen.findByLabelText("New password"), "a brand new long password");
      await user.type(screen.getByLabelText("Type the new password again"), "a brand new long password");
      await user.click(screen.getByRole("button", { name: "Set password" }));
      expect(await screen.findByText(outcome)).toBeInTheDocument();
      await waitFor(() => expect(currentLocation(view.container).state).toBeNull());
      expect(currentLocation(view.container)).toMatchObject({ pathname: "/reset-password", search: "" });
      expect(screen.getByText(outcome)).toBeInTheDocument();
      view.unmount();
    }
  });

  it("says a used or expired link cannot be used, and offers a new one", async () => {
    for (const path of ["/reset-password?error=INVALID_TOKEN", "/reset-password", "/reset-password?token=not-the-token"]) {
      const view = renderAuth(path, { preset: "signed-out" });
      if (path.endsWith("not-the-token")) {
        const user = userEvent.setup();
        await user.type(await screen.findByLabelText("New password"), "a brand new long password");
        await user.type(screen.getByLabelText("Type the new password again"), "a brand new long password");
        await user.click(screen.getByRole("button", { name: "Set password" }));
      }
      expect(await screen.findByText("This link cannot be used")).toBeInTheDocument();
      expect(screen.getByText("It has expired, or it was already used. Ask for a new link.")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Ask for a new link" })).toHaveAttribute("href", "/forgot-password");
      view.unmount();
    }
  });

  it("shows the server's own refusal of the password on the field, and a network failure above the form", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setProblem({ kind: "answer", status: 400, code: "PASSWORD_TOO_LONG", message: "Password too long" }, ["account.resetPassword"]);
    renderAuth(resetPath, { preset: "signed-out", environment });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("New password"), "a brand new long password");
    await user.type(screen.getByLabelText("Type the new password again"), "a brand new long password");
    await user.click(screen.getByRole("button", { name: "Set password" }));
    expect(await screen.findByText("Use at most 128 characters.")).toBeInTheDocument();
    environment.sessionController.setProblem({ kind: "network" }, ["account.resetPassword"]);
    await user.click(screen.getByRole("button", { name: "Set password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Pageinator cannot be reached");
  });

  it("works in Marathi, with no serious axe violations", async () => {
    const view = renderAuth(resetPath, { preset: "signed-out", language: "mr" });
    expect(await screen.findByRole("heading", { level: 1, name: "नवीन पासवर्ड निवडा" })).toBeInTheDocument();
    const form = view.container.querySelector("form")!;
    expect(within(form).getByLabelText("नवीन पासवर्ड")).toHaveAccessibleDescription(/किमान 12 अक्षरे/);
    expect(await seriousViolations(view.container)).toEqual([]);
    await userEvent.setup().click(screen.getByRole("button", { name: "पासवर्ड लागू करा" }));
    expect(screen.getByText("तुमचा पासवर्ड लिहा.")).toBeInTheDocument();
    expect(await seriousViolations(view.container)).toEqual([]);
  });
});
