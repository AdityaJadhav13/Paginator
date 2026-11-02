/**
 * Sign in (03 §5.1; plan §10 PR 13): the form, "Keep me signed in", the generic wrong-credentials answer, an
 * unconfirmed address, the loading, error and offline states, the expired session, the signed-in page, Marathi, and
 * axe. 320 px reflow is checked in a real browser (jsdom has no layout); its stylesheet's rules are checked in
 * layout.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "../../src/test/render.tsx";
import { createMockApplicationEnvironment } from "../../src/mocks/index.ts";
import { currentLocation, renderAuth, resetBrowserState, seriousViolations } from "./helpers.tsx";

const { accounts } = createMockApplicationEnvironment().sessionController.fixtures;

beforeEach(resetBrowserState);
afterEach(() => {
  resetBrowserState();
  vi.restoreAllMocks();
});

async function fill(user: ReturnType<typeof userEvent.setup>, email: string, password: string) {
  await user.type(await screen.findByLabelText("Email address"), email);
  await user.type(screen.getByLabelText("Password"), password);
}

describe("Sign in", () => {
  it("asks for an email address and a password, with Keep me signed in off by default", async () => {
    const { container } = renderAuth("/login", { preset: "signed-out" });
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email address")).toHaveAttribute("autocomplete", "username");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByRole("checkbox", { name: "Keep me signed in" })).not.toBeChecked();
    expect(screen.getByText("Leave this off on a computer that other people use.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Forgot your password?" })).toHaveAttribute("href", "/forgot-password");
    expect(screen.getByRole("link", { name: "How to get an account" })).toHaveAttribute("href", "/signup");
    expect(screen.queryByRole("button", { name: /google|microsoft/i })).not.toBeInTheDocument();
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });

  it("shows the password on request", async () => {
    renderAuth("/login", { preset: "signed-out" });
    const user = userEvent.setup();
    const password = await screen.findByLabelText("Password");
    await user.click(screen.getByRole("checkbox", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("checkbox", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "password");
  });

  it("passes Keep me signed in as rememberMe", async () => {
    const environment = createMockApplicationEnvironment();
    const signIn = vi.spyOn(environment.session, "signIn");
    renderAuth("/login", { preset: "signed-out", environment });
    const user = userEvent.setup();
    await fill(user, `  ${accounts.reviewer.email}  `, accounts.reviewer.password);
    await user.click(screen.getByRole("checkbox", { name: "Keep me signed in" }));
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(1));
    expect(signIn).toHaveBeenCalledWith({ email: accounts.reviewer.email, password: accounts.reviewer.password, rememberMe: true });
  });

  it("checks the fields before sending anything, and moves to the first one that needs attention", async () => {
    const environment = createMockApplicationEnvironment();
    const signIn = vi.spyOn(environment.session, "signIn");
    renderAuth("/login", { preset: "signed-out", environment });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Sign in" }));
    const email = screen.getByLabelText("Email address");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveFocus();
    expect(screen.getByText("Enter your email address.")).toBeInTheDocument();

    await user.type(email, "not an address");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Enter an email address such as name@example.com.")).toBeInTheDocument();

    await user.clear(email);
    await user.type(email, accounts.editor.email);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveFocus();
    expect(signIn).not.toHaveBeenCalled();
  });

  it("says the same thing for an unknown address and a wrong password", async () => {
    const answers: string[] = [];
    for (const [email, password] of [
      ["nobody@sahyadri.example", accounts.editor.password],
      [accounts.editor.email, "not the right password"],
    ] as const) {
      const view = renderAuth("/login", { preset: "signed-out" });
      const user = userEvent.setup();
      await fill(user, email, password);
      await user.click(screen.getByRole("button", { name: "Sign in" }));
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Email address or password is wrong");
      expect(screen.getByLabelText("Password")).toHaveValue("");
      expect(screen.getByLabelText("Password")).toHaveFocus();
      answers.push(alert.outerHTML);
      view.unmount();
    }
    expect(answers[0]).toBe(answers[1]);
  });

  it("sends an unconfirmed address to confirm it, with the address kept", async () => {
    const view = renderAuth("/login", { preset: "signed-out" });
    const user = userEvent.setup();
    await fill(user, accounts.unconfirmed.email, accounts.unconfirmed.password);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Confirm your email address first");
    await user.click(within(alert).getByRole("link", { name: "Send the link again" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Confirm your email address" })).toBeInTheDocument();
    expect(currentLocation(view.container)).toMatchObject({
      pathname: "/verify",
      state: { email: accounts.unconfirmed.email, reason: "unverified" },
    });
  });

  it("goes back to where the person was, or into their workspace", async () => {
    const back = renderAuth(`/login?returnTo=${encodeURIComponent("/org/org-demo-konkan/settings")}`, { preset: "signed-out" });
    const user = userEvent.setup();
    await fill(user, accounts.reviewer.email, accounts.reviewer.password);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Organization settings" })).toBeInTheDocument();
    expect(currentLocation(back.container).pathname).toBe("/org/org-demo-konkan/settings");
    back.unmount();

    const workspace = renderAuth("/login?returnTo=%2F%2Fevil.example", { preset: "signed-out" });
    await fill(user, accounts.reviewer.email, accounts.reviewer.password);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Konkan Coastal Press" })).toBeInTheDocument();
    expect(currentLocation(workspace.container).pathname).toBe("/org/org-demo-konkan");
  });

  it("shows a person without a workspace that they are signed in, and lets them sign out", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.confirmEmail(accounts.unconfirmed.email);
    renderAuth("/login", { preset: "signed-out", environment });
    const user = userEvent.setup();
    await fill(user, accounts.unconfirmed.email, accounts.unconfirmed.password);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { level: 1, name: "You are signed in" })).toBeInTheDocument();
    expect(screen.getByText(`Signed in as ${accounts.unconfirmed.name} (${accounts.unconfirmed.email}).`)).toBeInTheDocument();
    expect(screen.getByText("There is nothing to open yet: the newsroom screens are still being built.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open workspace" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
  });

  it("leaves nothing of a signed-out person's in the form for the next one", async () => {
    // found by the end-to-end smoke: the form outlived the sign-in, and came back filled in after Sign out
    const environment = createMockApplicationEnvironment();
    environment.sessionController.confirmEmail(accounts.unconfirmed.email);
    const signIn = vi.spyOn(environment.session, "signIn");
    renderAuth("/login", { preset: "signed-out", environment });
    const user = userEvent.setup();
    await fill(user, accounts.unconfirmed.email, accounts.unconfirmed.password);
    await user.click(screen.getByRole("checkbox", { name: "Keep me signed in" }));
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await user.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(await screen.findByLabelText("Email address")).toHaveValue("");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: "Keep me signed in" })).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Enter your email address.")).toBeInTheDocument();
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it("keeps the person signed in, and says why, when signing out fails", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setProblem({ kind: "offline" }, ["session.signOut"]);
    renderAuth("/login", { environment });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Sign out" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("You are still signed in");
    expect(alert).toHaveTextContent("You are offline");
    expect(screen.getByRole("heading", { level: 1, name: "You are signed in" })).toBeInTheDocument();
  });
});

describe("Sign in: loading, error and offline states", () => {
  it("shows that it is checking the session first", async () => {
    let release!: () => void;
    const environment = createMockApplicationEnvironment({ delay: () => new Promise<void>((resolve) => { release = resolve; }) });
    environment.sessionController.setPreset("signed-out");
    environment.scenarios.setScenario({ mode: "latency", delayMs: 1, operations: ["session.get"] });
    renderAuth("/login", { environment });
    const checking = await screen.findByText("Checking whether you are signed in…");
    expect(checking.closest('[role="status"]')).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    await act(async () => release());
    expect(await screen.findByLabelText("Email address")).toBeInTheDocument();
  });

  it("says when the session could not be checked, quietly, and can try again", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setProblem({ kind: "network" }, ["session.get"]);
    renderAuth("/login", { environment });
    expect(await screen.findByText("We could not check whether you are signed in")).toBeInTheDocument();
    expect(screen.getByText("Pageinator cannot be reached")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email address")).toBeInTheDocument();
    environment.sessionController.setProblem(null, ["session.get"]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: "You are signed in" })).toBeInTheDocument();
  });

  it("says when the browser is offline, and when a sign-in could not be sent", async () => {
    const environment = createMockApplicationEnvironment();
    renderAuth("/login", { preset: "signed-out", environment });
    await screen.findByLabelText("Email address");
    const onLine = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    await act(async () => { window.dispatchEvent(new Event("offline")); });
    expect(screen.getByText("Nothing can be sent until the connection is back.")).toBeInTheDocument();

    environment.sessionController.setProblem({ kind: "offline" }, ["session.signIn"]);
    const user = userEvent.setup();
    await fill(user, accounts.editor.email, accounts.editor.password);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("You are offline");
    expect(alert).toHaveTextContent("Nothing was sent.");

    onLine.mockReturnValue(true);
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(screen.queryByText("Nothing can be sent until the connection is back.")).not.toBeInTheDocument();
  });

  it("says when there were too many tries", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setProblem({ kind: "answer", status: 429, code: "slow_down", message: "" }, ["session.signIn"]);
    renderAuth("/login", { preset: "signed-out", environment });
    const user = userEvent.setup();
    await fill(user, accounts.editor.email, accounts.editor.password);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many triesWait a few minutes and try again.");
  });

  it("says when this browser did not keep the sign-in", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setProblem({ kind: "answer", status: 200, code: "cookie_refused", message: "" }, ["session.signIn"]);
    renderAuth("/login", { preset: "signed-out", environment });
    const user = userEvent.setup();
    await fill(user, accounts.editor.email, accounts.editor.password);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This browser did not keep your sign-in");
  });

  it("explains a session the API ended, and signs in back to the same place", async () => {
    const environment = createMockApplicationEnvironment();
    const { pending } = environment.sessionController.fixtures.invitations;
    const view = renderAuth(`/invite/${pending.id}`, { environment });
    expect(await screen.findByRole("button", { name: "Join The Sahyadri Daily" })).toBeInTheDocument();
    environment.sessionController.endSession();
    await userEvent.setup().click(screen.getByRole("button", { name: "Join The Sahyadri Daily" }));
    expect(await screen.findByText("Session expired")).toBeInTheDocument();
    expect(screen.getByText("You were signed out for security. Sign in again to continue.")).toBeInTheDocument();
    expect(currentLocation(view.container)).toMatchObject({
      pathname: "/login",
      search: `?returnTo=${encodeURIComponent(`/invite/${pending.id}`)}`,
    });
  });
});

describe("A signed_out answer while the session is still valid", () => {
  // L2-345: a request sent just before the session was replaced (turning two-step on) answers signed_out
  it("keeps the person signed in where they are", async () => {
    const mock = createMockApplicationEnvironment();
    const listeners = new Set<() => void>();
    const environment = {
      ...mock,
      onSignedOut: (listener: () => void) => (listeners.add(listener), () => void listeners.delete(listener)),
    };
    const { pending } = mock.sessionController.fixtures.invitations;
    const view = renderAuth(`/invite/${pending.id}`, { environment });
    expect(await screen.findByRole("button", { name: "Join The Sahyadri Daily" })).toBeInTheDocument();
    act(() => listeners.forEach((listener) => listener()));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(screen.queryByText("Session expired")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Join The Sahyadri Daily" })).toBeInTheDocument();
    expect(currentLocation(view.container).pathname).toBe(`/invite/${pending.id}`);
  });

  it("signs the person out when the re-check itself fails", async () => {
    const mock = createMockApplicationEnvironment();
    const listeners = new Set<() => void>();
    const environment = {
      ...mock,
      onSignedOut: (listener: () => void) => (listeners.add(listener), () => void listeners.delete(listener)),
    };
    const { pending } = mock.sessionController.fixtures.invitations;
    renderAuth(`/invite/${pending.id}`, { environment });
    expect(await screen.findByRole("button", { name: "Join The Sahyadri Daily" })).toBeInTheDocument();
    mock.sessionController.setProblem({ kind: "answer", status: 503, code: "unavailable", message: "" }, ["session.get"]);
    act(() => listeners.forEach((listener) => listener()));
    expect(await screen.findByText("Session expired")).toBeInTheDocument();
  });
});

describe("After a session the API ended", () => {
  // review F1: the redirect ran on every path change while the session stayed expired, trapping the person on /login
  for (const [name, target] of [
    ["Forgot your password?", "/forgot-password"],
    ["How to get an account", "/signup"],
    ["Pageinator", "/"],
  ] as const) {
    it(`lets the person leave the sign-in page: "${name}" goes to ${target}`, async () => {
      const environment = createMockApplicationEnvironment();
      const { pending } = environment.sessionController.fixtures.invitations;
      const view = renderAuth(`/invite/${pending.id}`, { environment });
      const user = userEvent.setup();
      await user.click(await screen.findByRole("button", { name: "Join The Sahyadri Daily" }));
      environment.sessionController.endSession();
      await user.click(screen.getByRole("button", { name: "Join The Sahyadri Daily" }));
      expect(await screen.findByText("Session expired")).toBeInTheDocument();
      await user.click(screen.getByRole("link", { name }));
      await waitFor(() => expect(currentLocation(view.container).pathname).toBe(target));
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
      expect(currentLocation(view.container).pathname).toBe(target);
      expect(screen.queryByText("Session expired")).not.toBeInTheDocument();
    });
  }

  it("shows the notice only on the sign-in page it was sent to, not on a later visit", async () => {
    const environment = createMockApplicationEnvironment();
    const { pending } = environment.sessionController.fixtures.invitations;
    renderAuth(`/invite/${pending.id}`, { environment });
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Join The Sahyadri Daily" });
    environment.sessionController.endSession();
    await user.click(screen.getByRole("button", { name: "Join The Sahyadri Daily" }));
    expect(await screen.findByText("Session expired")).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Forgot your password?" }));
    await user.click(await screen.findByRole("link", { name: "Back to sign in" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByText("Session expired")).not.toBeInTheDocument();
  });
});

describe("Sign in in Marathi", () => {
  it("shows every label, the generic answer and the language switch in Marathi", async () => {
    const view = renderAuth("/login", { preset: "signed-out", language: "mr" });
    expect(await screen.findByRole("heading", { level: 1, name: "प्रवेश" })).toBeInTheDocument();
    expect(screen.getByLabelText("ईमेल पत्ता")).toBeInTheDocument();
    expect(screen.getByLabelText("पासवर्ड")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "माझा प्रवेश चालू ठेवा" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "पासवर्ड विसरलात?" })).toBeInTheDocument();
    expect(view.container.querySelector(".pg-shell--auth")).toHaveAttribute("lang", "mr");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "प्रवेश करा" }));
    expect(screen.getByText("तुमचा ईमेल पत्ता लिहा.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("ईमेल पत्ता"), "nobody@sahyadri.example");
    await user.type(screen.getByLabelText("पासवर्ड"), "not the right password");
    await user.click(screen.getByRole("button", { name: "प्रवेश करा" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("ईमेल पत्ता किंवा पासवर्ड चुकीचा आहे");
    expect(within(alert).getByLabelText("त्रुटी")).toBeInTheDocument();
    expect(view.container.querySelector(".pg-shell--auth")?.textContent ?? "").not.toMatch(/\bSign in\b|Email address|Password/);
  });
});

describe("Sign in: accessibility", () => {
  it("has no serious axe violations in English and Marathi, with errors shown, and signed in", async () => {
    for (const language of ["en", "mr"] as const) {
      const view = renderAuth("/login", { preset: "signed-out", language });
      const user = userEvent.setup();
      await user.click(await screen.findByRole("button", { name: language === "en" ? "Sign in" : "प्रवेश करा" }));
      expect(await seriousViolations(view.container)).toEqual([]);
      view.unmount();
    }
    const signedIn = renderAuth("/login");
    await screen.findByRole("heading", { level: 1, name: "You are signed in" });
    expect(await seriousViolations(signedIn.container)).toEqual([]);
  });
});
