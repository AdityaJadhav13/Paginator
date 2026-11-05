/**
 * A new paper signs up (/signup) and its Owner's first screen (/onboarding), on the test double: the form and its
 * checks, each answer, the confirmation link, Marathi, and axe.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "../../src/test/render.tsx";
import { createMockApplicationEnvironment } from "../../src/mocks/index.ts";
import { currentLocation, renderAuth, resetBrowserState, seriousViolations } from "../auth/helpers.tsx";

beforeEach(resetBrowserState);
afterEach(resetBrowserState);

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText(/Newspaper's name/), "Kalpitpur Samachar (fictional)");
  await user.type(screen.getByLabelText(/Your name/), "Asha Kalpit");
  await user.type(screen.getByLabelText(/Your email address/), "asha@example.test");
}

describe("/signup: a new paper", () => {
  it("asks for the paper, the owner and the language, and still explains invitations; axe finds nothing serious", async () => {
    const { container } = renderAuth("/signup", { preset: "signed-out" });
    expect(await screen.findByRole("heading", { level: 1, name: "Create an account" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Sign up a new paper" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "English" })).toBeChecked();
    expect(screen.getByRole("heading", { level: 2, name: /Joining a paper/ })).toBeInTheDocument();
    expect(screen.getByText(/accounts are made by invitation/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("checks the fields before sending, and moves focus to the first problem", async () => {
    const { environment } = renderAuth("/signup", { preset: "signed-out" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Send request" }));
    expect(screen.getByText("Enter the newspaper's name.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Newspaper's name/)).toHaveFocus();
    expect(environment.paperSignupController.sent).toEqual([]);
  });

  it("sends the application with the trap empty and the fill time, then says to check the email", async () => {
    const { environment, container } = renderAuth("/signup", { preset: "signed-out" });
    const user = userEvent.setup();
    await fill(user);
    await user.click(screen.getByRole("radio", { name: "मराठी" }));
    await user.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByText("Check your email")).toBeInTheDocument();
    expect(environment.paperSignupController.sent).toEqual([
      {
        paperName: "Kalpitpur Samachar (fictional)",
        ownerName: "Asha Kalpit",
        email: "asha@example.test",
        language: "mr",
        website: "",
        filledInMs: expect.any(Number),
      },
    ]);
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("says when there were too many requests, and shows the API's refused field", async () => {
    const environment = createMockApplicationEnvironment();
    environment.paperSignupController.setOutcome({ kind: "busy" });
    renderAuth("/signup", { preset: "signed-out", environment });
    const user = userEvent.setup();
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByText("Too many requests from here")).toBeInTheDocument();
    environment.paperSignupController.setOutcome({ kind: "invalid", fields: ["email"] });
    await user.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByText("Some details need fixing.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Your email address/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/Your email address/)).toHaveFocus();
  });

  it("speaks Marathi, with the paper's language Marathi by default", async () => {
    renderAuth("/signup", { preset: "signed-out", language: "mr" });
    expect(await screen.findByRole("heading", { level: 2, name: "नवीन वृत्तपत्राची नोंदणी करा" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "मराठी" })).toBeChecked();
    expect(screen.getByRole("button", { name: "विनंती पाठवा" })).toBeInTheDocument();
  });

  it("confirms the emailed link once, takes the token out of the address, and says it waits for approval", async () => {
    const token = "A".repeat(43);
    const { environment, container } = renderAuth(`/signup?confirm=${token}`, { preset: "signed-out" });
    expect(await screen.findByText("Your email address is confirmed")).toBeInTheDocument();
    expect(screen.getByText(/waiting for approval/)).toBeInTheDocument();
    expect(environment.paperSignupController.confirmed).toEqual([token]);
    expect(currentLocation(container)).toMatchObject({ pathname: "/signup", search: "" });
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("says when a link does not work", async () => {
    const environment = createMockApplicationEnvironment();
    environment.paperSignupController.setConfirm("invalid");
    renderAuth("/signup?confirm=used", { preset: "signed-out", environment, language: "mr" });
    expect(await screen.findByText("हा दुवा चालत नाही")).toBeInTheDocument();
  });
});

describe("/onboarding: the Owner's first screen", () => {
  it("asks a signed-out person to sign in, and comes back here", async () => {
    renderAuth("/onboarding", { preset: "signed-out" });
    await screen.findByText(/Sign in to set up your paper/);
    const links = screen.getAllByRole("link", { name: "Sign in" });
    expect(links.map((link) => link.getAttribute("href"))).toContain("/login?returnTo=%2Fonboarding");
  });

  it("shows the Owner's paper and leads to its design; axe finds nothing serious", async () => {
    const { container } = renderAuth("/onboarding", { preset: "sahyadri-owner" });
    expect(await screen.findByRole("heading", { level: 1, name: "Welcome to Pageinator" })).toBeInTheDocument();
    expect(await screen.findByText("Konkan Coastal Times")).toBeInTheDocument();
    expect(screen.getByText("मराठी, English")).toBeInTheDocument();
    const design = screen.getByRole("link", { name: "Set up your paper's design" });
    expect(design.getAttribute("href")).toMatch(/^\/org\/[^/]+\/pub\/[^/]+\/templates$/);
    expect(screen.getByRole("link", { name: "Change the name" }).getAttribute("href")).toMatch(/\/brand$/);
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("tells someone who owns no paper", async () => {
    renderAuth("/onboarding", { preset: "sahyadri-editor" });
    expect(await screen.findByText("You do not own a paper here yet")).toBeInTheDocument();
  });

  it("offers a retry when the paper's details do not load", async () => {
    const environment = createMockApplicationEnvironment();
    environment.paperSignupController.setPaper(null);
    renderAuth("/onboarding", { preset: "sahyadri-owner", environment });
    const retry = await screen.findByRole("button", { name: "Try again" });
    environment.paperSignupController.setPaper({ name: "Kalpitpur Times", languages: ["en"], primaryLanguage: "en" });
    await userEvent.setup().click(retry);
    await waitFor(() => expect(screen.getByText("Kalpitpur Times")).toBeInTheDocument());
  });
});
