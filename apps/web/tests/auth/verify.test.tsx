/**
 * Verify email (03 §5.1, by emailed link: plan §4.1): the "check your email" page after a sign-up, the 60-second wait
 * before another link, the confirmed and the bad-link landings, an address typed in, the generic answer, Marathi and
 * axe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import userEvent from "@testing-library/user-event";
import { screen } from "../../src/test/render.tsx";
import { createMockApplicationEnvironment } from "../../src/mocks/index.ts";
import { currentLocation, renderAuth, resetBrowserState, seriousViolations } from "./helpers.tsx";

const fixtures = createMockApplicationEnvironment().sessionController.fixtures;
const INVITATION = fixtures.invitations.pending.id;

beforeEach(resetBrowserState);
afterEach(() => {
  resetBrowserState();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("After signing up", () => {
  it("says where the link went, and waits 60 seconds before sending another", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setPreset("signed-out");
    renderAuth("/verify", {
      environment,
      state: { email: fixtures.accounts.unconfirmed.email, invitationId: INVITATION, reason: "signed-up" },
    });
    expect(await screen.findByText(
      `We sent a link to ${fixtures.accounts.unconfirmed.email}. Open it to confirm your address. The link expires in one hour.`
    )).toBeInTheDocument();
    const resend = screen.getByRole("button", { name: "Send the link again" });
    expect(resend).toHaveAttribute("aria-disabled", "true");
    expect(resend).toHaveAccessibleDescription("You can send it again in 60 seconds.");
    expect(screen.getByRole("link", { name: "Use a different email address" })).toHaveAttribute("href", `/invite/${INVITATION}`);

    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    await user.click(resend);
    expect(environment.sessionController.outbox()).toEqual([]);

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(resend).not.toHaveAttribute("aria-disabled");
    await user.click(resend);
    expect(await screen.findByText("If that address still needs confirming, a new link is on its way.")).toBeInTheDocument();
    expect(environment.sessionController.outbox()).toEqual([
      { kind: "verify", to: fixtures.accounts.unconfirmed.email, returnPath: `/verify?confirmed=1&invitation=${INVITATION}` },
    ]);
    expect(resend).toHaveAttribute("aria-disabled", "true");
  });

  it("offers the link again at once to an address that was never confirmed", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setPreset("signed-out");
    renderAuth("/verify", { environment, state: { email: fixtures.accounts.unconfirmed.email, reason: "unverified" } });
    expect(await screen.findByText("Confirm your email address first")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Send the link again" }));
    expect(await screen.findByText("If that address still needs confirming, a new link is on its way.")).toBeInTheDocument();
    expect(environment.sessionController.outbox()).toEqual([
      { kind: "verify", to: fixtures.accounts.unconfirmed.email, returnPath: "/verify?confirmed=1" },
    ]);
  });

  it("says why a link could not be sent", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setProblem({ kind: "offline" }, ["account.sendVerificationEmail"]);
    renderAuth("/verify", { environment, preset: "signed-out", state: { email: "x@sahyadri.example", reason: "unverified" } });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Send the link again" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You are offline");
  });
});

describe("Coming back from the emailed link", () => {
  it("confirms, signed in, and goes straight on to the invitation's Join (a closed tab cannot lose it)", async () => {
    const view = renderAuth(`/verify?confirmed=1&invitation=${INVITATION}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Your invitation" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
    expect(currentLocation(view.container).pathname).toBe(`/invite/${INVITATION}`);
  });

  it("confirms, signed out, and asks to sign in back to the invitation", async () => {
    renderAuth(`/verify?confirmed=1&invitation=${INVITATION}`, { preset: "signed-out" });
    expect(await screen.findByText("Sign in to continue.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      `/login?returnTo=${encodeURIComponent(`/invite/${INVITATION}`)}`
    );
  });

  it("says an expired or a bad link cannot be used, and sends a new one to a typed address", async () => {
    for (const [error, heading] of [
      ["TOKEN_EXPIRED", "This link has expired"],
      ["INVALID_TOKEN", "This confirmation link cannot be used"],
      ["USER_NOT_FOUND", "This confirmation link cannot be used"],
    ] as const) {
      const environment = createMockApplicationEnvironment();
      const view = renderAuth(`/verify?confirmed=1&error=${error}`, { environment, preset: "signed-out" });
      expect(await screen.findByText(heading)).toBeInTheDocument();
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Send a new link" }));
      expect(screen.getByText("Enter your email address.")).toBeInTheDocument();
      await user.type(screen.getByLabelText("Email address"), fixtures.accounts.unconfirmed.email);
      await user.click(screen.getByRole("button", { name: "Send a new link" }));
      expect(await screen.findByText("If that address still needs confirming, a new link is on its way.")).toBeInTheDocument();
      expect(environment.sessionController.outbox()).toHaveLength(1);
      view.unmount();
    }
  });

  it("gives the same answer for an address that needs no confirming", async () => {
    const environment = createMockApplicationEnvironment();
    const view = renderAuth("/verify", { environment, preset: "signed-out" });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Email address"), fixtures.accounts.editor.email);
    await user.click(screen.getByRole("button", { name: "Send a new link" }));
    expect(await screen.findByText("If that address still needs confirming, a new link is on its way.")).toBeInTheDocument();
    expect(environment.sessionController.outbox()).toEqual([]);
    expect(view.container.querySelector("main")).not.toHaveTextContent(/already|no account|not found/i);
  });
});

describe("Verify email in Marathi, and accessibility", () => {
  it("speaks Marathi and has no serious axe violations in its states", async () => {
    const pending = renderAuth("/verify", {
      language: "mr",
      preset: "signed-out",
      state: { email: fixtures.accounts.unconfirmed.email, invitationId: INVITATION, reason: "signed-up" },
    });
    expect(await screen.findByRole("heading", { level: 1, name: "तुमचा ईमेल पत्ता निश्चित करा" })).toBeInTheDocument();
    expect(screen.getByText(/आम्ही .* वर दुवा पाठवला आहे/)).toBeInTheDocument();
    expect(screen.getByText("60 सेकंदांनी तुम्ही तो पुन्हा पाठवू शकाल.")).toBeInTheDocument();
    expect(await seriousViolations(pending.container)).toEqual([]);
    pending.unmount();

    for (const path of [`/verify?confirmed=1&invitation=${INVITATION}`, "/verify?error=TOKEN_EXPIRED", "/verify"]) {
      const view = renderAuth(path, { preset: "signed-out" });
      await screen.findByRole("heading", { level: 1, name: "Confirm your email address" });
      expect(await seriousViolations(view.container)).toEqual([]);
      view.unmount();
    }
  });
});
