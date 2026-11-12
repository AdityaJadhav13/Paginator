/**
 * The invitation landing and sign-up (03 §5.1 "Accept invitation"; plan §4.3): who invited whom to what, sign-up only
 * for the invited address and with the same answer for any other, the way back after confirming, Join with one
 * Idempotency-Key per action, every invitation state, the loading, error and offline states, Marathi and axe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "../../src/test/render.tsx";
import { createMockApplicationEnvironment } from "../../src/mocks/index.ts";
import { invitationDate, roleList } from "../../src/features/auth/InvitationScreen.tsx";
import { translator } from "../../src/i18n/index.ts";
import { currentLocation, renderAuth, resetBrowserState, seriousViolations } from "./helpers.tsx";

const fixtures = createMockApplicationEnvironment().sessionController.fixtures;
const { pending } = fixtures.invitations;
const PASSWORD = "a long enough password";

beforeEach(resetBrowserState);
afterEach(() => {
  resetBrowserState();
  vi.restoreAllMocks();
});

async function createAccount(user: ReturnType<typeof userEvent.setup>, email: string) {
  await user.click(await screen.findByRole("button", { name: "Create an account" }));
  await user.type(screen.getByLabelText(/^Your name/), "New Designer");
  await user.type(screen.getByLabelText(/^Email address/), email);
  await user.type(screen.getByLabelText(/^Choose a password/), PASSWORD);
  await user.type(screen.getByLabelText(/^Type the password again/), PASSWORD);
  await user.click(screen.getByRole("button", { name: "Create account" }));
}

describe("A pending invitation, signed out", () => {
  it("says who invited the person, to what, as what, and until when", async () => {
    renderAuth(`/invite/${pending.id}`, { preset: "signed-out" });
    expect(await screen.findByRole("heading", { level: 1, name: "Your invitation" })).toBeInTheDocument();
    expect(screen.getByText("Ravi Kulkarni invited you to The Sahyadri Daily as Page designer.")).toBeInTheDocument();
    expect(screen.getByText("This invitation expires on 28 October 2026.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in to accept" })).toHaveAttribute(
      "href",
      `/login?returnTo=${encodeURIComponent(`/invite/${pending.id}`)}`
    );
    expect(screen.queryByText(pending.email)).not.toBeInTheDocument();
  });

  it("fills in the invited address from the emailed link's fragment", async () => {
    renderAuth(`/invite/${pending.id}#email=${encodeURIComponent(pending.email)}`, { preset: "signed-out" });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Create an account" }));
    expect(screen.getByLabelText(/^Email address/)).toHaveValue(pending.email);
  });

  it("creates the account, and sends the person to confirm the address, coming back here", async () => {
    const environment = createMockApplicationEnvironment();
    const view = renderAuth(`/invite/${pending.id}`, { environment, preset: "signed-out" });
    await createAccount(userEvent.setup(), pending.email);
    expect(await screen.findByText(`We sent a link to ${pending.email}. Open it to confirm your address. The link expires in one hour.`)).toBeInTheDocument();
    expect(currentLocation(view.container)).toMatchObject({
      pathname: "/verify",
      state: { email: pending.email, invitationId: pending.id, reason: "signed-up" },
    });
    expect(environment.sessionController.outbox()).toEqual([
      { kind: "verify", to: pending.email, returnPath: `/verify?confirmed=1&invitation=${pending.id}` },
    ]);
  });

  it("answers an address the invitation was not sent to exactly as the invited one", async () => {
    const environment = createMockApplicationEnvironment();
    renderAuth(`/invite/${pending.id}`, { environment, preset: "signed-out" });
    await createAccount(userEvent.setup(), "someone.else@sahyadri.example");
    expect(await screen.findByText(/We sent a link to someone\.else@sahyadri\.example\./)).toBeInTheDocument();
    expect(environment.sessionController.outbox()).toEqual([]);
  });

  it("checks every field before sending, starting with the first", async () => {
    const environment = createMockApplicationEnvironment();
    const signUp = vi.spyOn(environment.account, "signUp");
    renderAuth(`/invite/${pending.id}`, { environment, preset: "signed-out" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Create an account" }));
    expect(screen.getByLabelText(/^Your name/)).toBeRequired();
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByText("Enter your name.")).toBeInTheDocument();
    expect(screen.getByText("Enter your email address.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Your name/)).toHaveFocus();
    await user.type(screen.getByLabelText(/^Your name/), "New Designer");
    await user.type(screen.getByLabelText(/^Email address/), pending.email);
    await user.type(screen.getByLabelText(/^Choose a password/), "too short");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByText("Use at least 12 characters.")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Choose a password/), " but now long");
    await user.type(screen.getByLabelText(/^Type the password again/), "different");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByText("The two passwords are not the same.")).toBeInTheDocument();
    expect(signUp).not.toHaveBeenCalled();
  });

  it("shows a sign-up that could not be sent above the form", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setProblem({ kind: "network" }, ["account.signUp"]);
    renderAuth(`/invite/${pending.id}`, { environment, preset: "signed-out" });
    await createAccount(userEvent.setup(), pending.email);
    expect(await screen.findByRole("alert")).toHaveTextContent("Pageinator cannot be reached");
  });
});

describe("A pending invitation, signed in", () => {
  async function signedInAsInvited() {
    const environment = createMockApplicationEnvironment();
    await environment.account.signUp({ invitationId: pending.id, name: "New Designer", email: pending.email, password: PASSWORD, returnPath: "/verify" });
    environment.sessionController.confirmEmail(pending.email);
    await environment.session.signIn({ email: pending.email, password: PASSWORD, rememberMe: false });
    return environment;
  }

  it("joins, with one Idempotency-Key reused by a retry", async () => {
    const environment = await signedInAsInvited();
    const accept = vi.spyOn(environment.account, "acceptInvitation");
    environment.sessionController.setProblem({ kind: "network" }, ["account.acceptInvitation"]);
    renderAuth(`/invite/${pending.id}`, { environment });
    expect(await screen.findByText(`You are signed in as ${pending.email}.`)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Join The Sahyadri Daily" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Pageinator cannot be reached");
    environment.sessionController.setProblem(null, ["account.acceptInvitation"]);
    await user.click(screen.getByRole("button", { name: "Join The Sahyadri Daily" }));
    expect(await screen.findByText("You have joined The Sahyadri Daily")).toBeInTheDocument();
    expect(accept).toHaveBeenCalledTimes(2);
    const [first, second] = accept.mock.calls.map(([input]) => input.idempotencyKey);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toBe(first);
  });

  it("is offered with Join on a later sign-in when it was never accepted", async () => {
    const environment = await signedInAsInvited();
    renderAuth("/login", { environment });
    expect(await screen.findByRole("heading", { level: 2, name: "Your invitations" })).toBeInTheDocument();
    expect(screen.getByText("Ravi Kulkarni invited you to The Sahyadri Daily as Page designer.")).toBeInTheDocument();
    expect(screen.queryByText(/not a member of any newsroom/)).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Join The Sahyadri Daily" }));
    expect(await screen.findByRole("button", { name: "Open workspace" })).toBeInTheDocument();
  });

  it("refuses another person's account, and offers to sign out", async () => {
    renderAuth(`/invite/${pending.id}`);
    expect(await screen.findByText(`You are signed in as ${fixtures.accounts.editor.email}.`)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Join The Sahyadri Daily" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This account cannot accept the invitation");
    expect(screen.getByText("Not you?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("button", { name: "Create an account" })).toBeInTheDocument();
  });
});

describe("Invitations that cannot be used", () => {
  it("names each state", async () => {
    for (const [id, heading, body] of [
      [fixtures.invitations.expired.id, "This invitation has expired", "Ask for a new invitation."],
      [fixtures.invitations.accepted.id, "This invitation has already been used", "Sign in with the account that accepted it."],
      [fixtures.invitations.revoked.id, "This invitation was withdrawn", "Ask the person who invited you for a new invitation."],
      ["00000000-0000-4000-8000-000000000000", "This invitation cannot be used", "Ask the person who invited you for a new invitation."],
      ["not-an-invitation-id", "This invitation cannot be used", "Ask the person who invited you for a new invitation."],
    ] as const) {
      const view = renderAuth(`/invite/${id}`, { preset: "signed-out" });
      expect(await screen.findByText(heading)).toBeInTheDocument();
      expect(screen.getByText(body)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Create an account" })).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it("asks nothing of the API for an id that cannot be one", async () => {
    const environment = createMockApplicationEnvironment();
    const get = vi.spyOn(environment.account, "getInvitation");
    renderAuth("/invite/not-an-invitation-id", { environment, preset: "signed-out" });
    expect(await screen.findByText("This invitation cannot be used")).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });
});

describe("Invitation: loading, error and offline", () => {
  it("shows its loading state, then a failure quietly, then tries again", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setProblem({ kind: "offline" }, ["account.getInvitation"]);
    renderAuth(`/invite/${pending.id}`, { environment, preset: "signed-out" });
    expect(screen.getByText("Opening your invitation…")).toBeInTheDocument();
    expect(await screen.findByText("You are offline")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    environment.sessionController.setProblem(null, ["account.getInvitation"]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Ravi Kulkarni invited you to The Sahyadri Daily as Page designer.")).toBeInTheDocument();
  });

  it("announces a failed retry", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setProblem({ kind: "network" }, ["account.getInvitation"]);
    renderAuth(`/invite/${pending.id}`, { environment, preset: "signed-out" });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Pageinator cannot be reached"));
  });
});

describe("Invitation in Marathi, and accessibility", () => {
  it("writes the summary as one Marathi sentence, with Marathi role names and a Latin-digit date", async () => {
    renderAuth(`/invite/${pending.id}`, { preset: "signed-out", language: "mr" });
    expect(await screen.findByRole("heading", { level: 1, name: "तुमचे निमंत्रण" })).toBeInTheDocument();
    expect(screen.getByText("Ravi Kulkarni यांनी तुम्हाला The Sahyadri Daily मध्ये पान मांडणीकार म्हणून निमंत्रित केले आहे.")).toBeInTheDocument();
    expect(screen.getByText("हे निमंत्रण 28 ऑक्टोबर, 2026 रोजी कालबाह्य होईल.")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "नवीन खाते उघडा" }));
    expect(screen.getByLabelText(/^तुमचे नाव/)).toBeRequired();
    expect(screen.getAllByText("(आवश्यक)")).toHaveLength(4);
    expect(screen.queryByText("(required)")).not.toBeInTheDocument();
  });

  it("lists several roles in the language's own way, and names member only when alone", () => {
    expect(roleList(["member", "page_designer", "reporter"], "en", translator("en"))).toBe("Page designer and Reporter");
    expect(roleList(["member", "page_designer", "reporter"], "mr", translator("mr"))).toBe("पान मांडणीकार आणि वार्ताहर");
    expect(roleList(["member"], "en", translator("en"))).toBe("Member");
    expect(roleList(["admin", "night_editor"], "en", translator("en"))).toBe("Admin and night_editor");
    expect(invitationDate("2026-10-28T20:00:00.000Z", "en")).toBe("29 October 2026");
  });

  it("has no serious axe violations: the summary, the sign-up form with errors, and a refusal", async () => {
    for (const language of ["en", "mr"] as const) {
      const view = renderAuth(`/invite/${pending.id}`, { preset: "signed-out", language });
      const user = userEvent.setup();
      await user.click(await screen.findByRole("button", { name: language === "en" ? "Create an account" : "नवीन खाते उघडा" }));
      await user.click(screen.getByRole("button", { name: language === "en" ? "Create account" : "खाते उघडा" }));
      expect(await seriousViolations(view.container)).toEqual([]);
      view.unmount();
    }
    const refused = renderAuth(`/invite/${fixtures.invitations.expired.id}`, { preset: "signed-out" });
    await screen.findByText("This invitation has expired");
    expect(await seriousViolations(refused.container)).toEqual([]);
  });
});
