/**
 * Team, /org/:orgId/team (plan §10 PR 20, 07 §12): the members; for the Owner and the Admins the pending invitations,
 * inviting (an organisation role, roles per publication, grants only where GRANT_HOLDERS allows), resend, cancel,
 * change roles and remove; view only for a Chief Editor; nothing for anyone else; the two-step rule; the loading,
 * error and offline states; Marathi; axe. On the test double, fictional data only.
 */
import { afterEach, describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, screen, waitFor, within } from "../../src/test/render.tsx";
import { createMockApplicationEnvironment } from "../../src/mocks/index.ts";
import { renderAuth, resetBrowserState, seriousViolations } from "../auth/helpers.tsx";

const TEAM = "/org/org-demo-sahyadri/team";
const fixtures = createMockApplicationEnvironment().sessionController.fixtures;
const { subeditor, owner } = fixtures.accounts;

afterEach(() => {
  resetBrowserState();
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
});

function memberCard(name: string): HTMLElement {
  return screen.getByText(name, { selector: "strong" }).closest("li")!;
}

async function signedInAs(email: string, password: string) {
  const environment = createMockApplicationEnvironment();
  environment.sessionController.setPreset("signed-out");
  await environment.session.signIn({ email, password, rememberMe: false });
  return environment;
}

describe("Team for an admin", () => {
  it("lists the members with their roles, and leaves the owner and the person themself alone", async () => {
    renderAuth(TEAM, { preset: "sahyadri-editor" });
    expect(await screen.findByRole("heading", { level: 1, name: "Team" })).toBeInTheDocument();
    await screen.findByRole("heading", { level: 2, name: "Members" });

    const ownerCard = within(memberCard("Sahyadri Demo Owner"));
    expect(ownerCard.getByText("Organization role: Owner")).toBeInTheDocument();
    expect(ownerCard.queryByRole("button")).not.toBeInTheDocument();

    const me = within(memberCard("Sahyadri Demo Editor"));
    expect(me.getByText("This is you.")).toBeInTheDocument();
    expect(me.getByText("Pune Daily Ledger: Editor and Can approve pages")).toBeInTheDocument();
    expect(me.queryByRole("button")).not.toBeInTheDocument();

    const sub = within(memberCard("Sahyadri Demo Sub-editor"));
    expect(sub.getByText("Pune Daily Ledger: Sub-editor")).toBeInTheDocument();
    expect(sub.getByText("Not active yet")).toBeInTheDocument();
    expect(sub.getByRole("button", { name: "Change roles of Sahyadri Demo Sub-editor" })).toBeInTheDocument();
    expect(sub.getByRole("button", { name: "Remove Sahyadri Demo Sub-editor" })).toBeInTheDocument();

    expect(screen.getByRole("heading", { level: 2, name: "Pending invitations" })).toBeInTheDocument();
    expect(screen.getByText(fixtures.invitations.team.email, { selector: "strong" })).toBeInTheDocument();
  });

  it("invites with roles per publication, offering a grant only while a role that may hold it is ticked", async () => {
    const { environment } = renderAuth(TEAM, { preset: "sahyadri-editor" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Invite someone" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Invite someone to Sahyadri Media Cooperative" }));

    await user.click(dialog.getByRole("button", { name: "Send invitation" }));
    expect(dialog.getByLabelText("Email address")).toHaveAccessibleDescription(/Enter your email address\./);
    await user.type(dialog.getByLabelText("Email address"), "new.designer@sahyadri.example");
    await user.click(dialog.getByRole("button", { name: "Send invitation" }));
    expect(dialog.getByRole("alert")).toHaveTextContent("Choose at least one role on one publication, or make this person an admin.");

    const pune = within(dialog.getByRole("group", { name: "Roles on Pune Daily Ledger" }));
    await user.click(pune.getByRole("checkbox", { name: "Reporter" }));
    expect(pune.queryByRole("checkbox", { name: "Can approve pages" })).not.toBeInTheDocument();
    await user.click(pune.getByRole("checkbox", { name: "Editor" }));
    await user.click(pune.getByRole("checkbox", { name: "Can approve pages" }));
    await user.click(pune.getByRole("checkbox", { name: "Editor" }));
    expect(pune.queryByRole("checkbox", { name: "Can approve pages" })).not.toBeInTheDocument();
    await user.click(pune.getByRole("checkbox", { name: "Editor" }));
    expect(pune.getByRole("checkbox", { name: "Can approve pages" })).not.toBeChecked(); // unticking the role took the grant
    await user.click(pune.getByRole("checkbox", { name: "Can approve release" }));
    await user.click(dialog.getByRole("button", { name: "Send invitation" }));

    expect(await screen.findByText("Invitation sent to new.designer@sahyadri.example.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByText("new.designer@sahyadri.example", { selector: "strong" })).toBeInTheDocument();
    const listed = await environment.team.listInvitations({ orgId: "org-demo-sahyadri" });
    expect(listed.ok && listed.value.find((invitation) => invitation.email === "new.designer@sahyadri.example")).toMatchObject({
      orgRole: "member",
      publications: [{ publicationId: "pub-demo-pune-daily", roles: ["reporter", "editor"], grants: ["release_approve"] }],
    });
    expect(environment.sessionController.outbox()).toContainEqual({ kind: "invite", to: "new.designer@sahyadri.example" });
  });

  it("says on the field when the address is already a member", async () => {
    renderAuth(TEAM, { preset: "sahyadri-editor" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Invite someone" }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.type(dialog.getByLabelText("Email address"), subeditor.email);
    await user.click(dialog.getByRole("radio", { name: "Admin" }));
    await user.click(dialog.getByRole("button", { name: "Send invitation" }));
    await waitFor(() =>
      expect(dialog.getByLabelText("Email address")).toHaveAccessibleDescription(new RegExp(`${subeditor.email} is already a member\\.`)),
    );
  });

  it("sends an invitation again, and cancels one", async () => {
    const { environment } = renderAuth(TEAM, { preset: "sahyadri-editor" });
    const user = userEvent.setup();
    const email = fixtures.invitations.team.email;
    await user.click(await screen.findByRole("button", { name: `Send the invitation to ${email} again` }));
    expect(await screen.findByText(`The invitation to ${email} was sent again.`)).toBeInTheDocument();
    expect(environment.sessionController.outbox()).toContainEqual({ kind: "invite", to: email });
    await user.click(screen.getByRole("button", { name: `Cancel the invitation to ${email}` }));
    expect(await screen.findByText(`The invitation to ${email} was cancelled.`)).toBeInTheDocument();
    expect(await screen.findByText("No invitation is waiting.")).toBeInTheDocument();
  });

  it("changes a member's roles", async () => {
    renderAuth(TEAM, { preset: "sahyadri-editor" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Change roles of Sahyadri Demo Sub-editor" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Change roles of Sahyadri Demo Sub-editor" }));
    const pune = within(dialog.getByRole("group", { name: "Roles on Pune Daily Ledger" }));
    expect(pune.getByRole("checkbox", { name: "Sub-editor" })).toBeChecked();
    await user.click(pune.getByRole("checkbox", { name: "Reporter" }));
    await user.click(dialog.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("The roles of Sahyadri Demo Sub-editor are saved.")).toBeInTheDocument();
    expect(await screen.findByText("Pune Daily Ledger: Sub-editor and Reporter")).toBeInTheDocument();
  });

  it("removes a member after asking", async () => {
    renderAuth(TEAM, { preset: "sahyadri-editor" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Remove Sahyadri Demo Sub-editor" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Remove Sahyadri Demo Sub-editor?" }));
    expect(dialog.getByText("Sahyadri Demo Sub-editor will lose access to everything in Sahyadri Media Cooperative. Their work stays.")).toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: "Remove from the team" }));
    expect(await screen.findByText("Sahyadri Demo Sub-editor was removed from the team.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Sahyadri Demo Sub-editor", { selector: "strong" })).not.toBeInTheDocument());
  });
});

describe("Team for other roles", () => {
  it("shows a Chief Editor the members only", async () => {
    const setup = createMockApplicationEnvironment();
    await setup.team.updateMember({
      orgId: "org-demo-sahyadri",
      userId: subeditor.userId,
      patch: { publications: [{ publicationId: "pub-demo-pune-daily", roles: ["chief_editor"], grants: [] }] },
    });
    await setup.session.signOut();
    await setup.session.signIn({ email: subeditor.email, password: subeditor.password, rememberMe: false });
    renderAuth(TEAM, { environment: setup });
    expect(await screen.findByText("Sahyadri Demo Owner", { selector: "strong" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Invite someone" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Pending invitations" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Remove / })).not.toBeInTheDocument();
  });

  it("tells anyone else they cannot see it, and the navigation has no Team", async () => {
    const environment = await signedInAs(subeditor.email, subeditor.password);
    renderAuth(TEAM, { environment });
    expect(await screen.findByText("You cannot see this team")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Team" })).not.toBeInTheDocument();
  });

  it("asks for two-step first when the organisation's rule needs it", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setPreset("sahyadri-owner");
    await environment.security.turnOffTwoStep({ password: owner.password });
    renderAuth(TEAM, { environment });
    expect(await screen.findByText("Your role in Sahyadri Media Cooperative needs two-step sign-in")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Account security" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { level: 2, name: "Members" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Team" })).not.toBeInTheDocument();
  });
});

describe("Team: loading, error, offline, Marathi, axe", () => {
  it("shows a failure with Retry, and recovers", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setProblem(
      { kind: "answer", status: 500, code: "server_error", message: "", requestId: "req-1" },
      ["team.listMembers"],
    );
    renderAuth(TEAM, { preset: "sahyadri-editor", environment });
    expect(await screen.findByText("Something went wrong on our side")).toBeInTheDocument();
    expect(screen.getByText(/Reference: req-1/)).toBeInTheDocument();
    environment.sessionController.setProblem(null, ["team.listMembers"]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Members" })).toBeInTheDocument();
  });

  it("says when the browser is offline", async () => {
    renderAuth(TEAM, { preset: "sahyadri-editor" });
    await screen.findByRole("heading", { level: 2, name: "Members" });
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(await screen.findByText("You are offline")).toBeInTheDocument();
  });

  it("is in Marathi, with the shell, the navigation and the dialog", async () => {
    const { container } = renderAuth(TEAM, { preset: "sahyadri-editor", language: "mr" });
    expect(await screen.findByRole("heading", { level: 1, name: "टीम" })).toBeInTheDocument();
    expect(container.querySelector(".pg-shell--workspace")).toHaveAttribute("lang", "mr");
    expect(screen.getByRole("link", { name: "खाते सुरक्षा" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "संस्था" })).toBeInTheDocument();
    await userEvent.setup().click(await screen.findByRole("button", { name: "निमंत्रण पाठवा" }));
    expect(await screen.findByRole("dialog", { name: "Sahyadri Media Cooperative साठी निमंत्रण पाठवा" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Pune Daily Ledger मधील भूमिका" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "प्रशासक" })).toBeInTheDocument();
  });

  it("has no serious axe violations: the list, and the invite dialog", async () => {
    const { container } = renderAuth(TEAM, { preset: "sahyadri-editor" });
    await screen.findByRole("heading", { level: 2, name: "Members" });
    expect(await seriousViolations(container)).toEqual([]);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Invite someone" }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.click(within(dialog.getByRole("group", { name: "Roles on Pune Daily Ledger" })).getByRole("checkbox", { name: "Editor" }));
    expect(await seriousViolations(container)).toEqual([]);
  });
});
