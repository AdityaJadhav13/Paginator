/**
 * The workspace's navigation from /me (plan §10 PR 20, 07 §12): an entry shows only when the person may use it, only
 * when its screen is built in the deployed app, and nothing but Home while the organisation's two-step rule is unmet.
 * Also the organisation's home, where sign-in lands. Fictional data only.
 */
import { afterEach, describe, expect, it } from "vitest";
import { screen } from "../../src/test/render.tsx";
import { navigation } from "../../src/features/people/navigation.ts";
import type { OrgAccessDto } from "../../src/services/index.ts";
import { renderAuth, resetBrowserState, seriousViolations } from "../auth/helpers.tsx";

afterEach(resetBrowserState);

function org(
  orgRole: OrgAccessDto["orgRole"],
  roles: OrgAccessDto["publications"][number]["roles"],
  twoStep = { required: false, satisfied: false },
): OrgAccessDto {
  return {
    org: { id: "o", name: "Fictional Daily Group" },
    orgRole,
    twoStep,
    publications: [{ id: "p", name: "Fictional Morning", roles, grants: [] }],
  };
}

const labels = (entries: ReturnType<typeof navigation>) => entries.map((entry) => `${entry.label} ${entry.to}`);

describe("Navigation from permissions", () => {
  it("gives the deployed app only built screens: Home for everyone, Team for whoever may see it", () => {
    expect(labels(navigation(org("owner", []), undefined, false))).toEqual(["nav.home /org/o", "glossary.team /org/o/team"]);
    expect(labels(navigation(org("admin", []), undefined, false))).toEqual(["nav.home /org/o", "glossary.team /org/o/team"]);
    expect(labels(navigation(org("member", ["chief_editor"]), undefined, false))).toEqual(["nav.home /org/o", "glossary.team /org/o/team"]);
    for (const role of ["editor", "sub_editor", "reporter", "page_designer", "photo_editor", "advertising", "prepress", "viewer"] as const) {
      expect(labels(navigation(org("member", [role]), undefined, false)), role).toEqual(["nav.home /org/o"]);
    }
  });

  it("lists the placeholder screens in a development build, still by permission", () => {
    expect(labels(navigation(org("admin", []), undefined, true))).toEqual([
      "nav.home /org/o",
      "glossary.team /org/o/team",
      "nav.orgSettings /org/o/settings",
      "nav.storage /org/o/storage",
    ]); // billing is the owner's alone
    expect(labels(navigation(org("owner", []), undefined, true))).toContain("nav.billing /org/o/billing");
    const reporter = labels(navigation(org("member", ["reporter"]), "p", true));
    expect(reporter).toContain("glossary.stories /org/o/pub/p/stories");
    expect(reporter).not.toContain("nav.brand /org/o/pub/p/brand");
    expect(reporter).not.toContain("glossary.team /org/o/team");
    expect(labels(navigation(org("member", ["reporter"]), "p", false))).toEqual([]);
  });

  it("offers only Home while the organisation's two-step rule is unmet", () => {
    const blocked = org("owner", [], { required: true, satisfied: false });
    expect(labels(navigation(blocked, undefined, true))).toEqual(["nav.home /org/o"]);
    const met = org("owner", [], { required: true, satisfied: true });
    expect(labels(navigation(met, undefined, false))).toEqual(["nav.home /org/o", "glossary.team /org/o/team"]);
  });
});

describe("The organisation's home", () => {
  it("says the person's role, their publications with roles and grants, and links to what is built", async () => {
    const { container } = renderAuth("/org/org-demo-sahyadri", { preset: "sahyadri-editor" });
    expect(await screen.findByRole("heading", { level: 1, name: "Sahyadri Media Cooperative" })).toBeInTheDocument();
    expect(screen.getByText("Your role here: Admin.")).toBeInTheDocument();
    expect(screen.getByText("Pune Daily Ledger: Editor and Can approve pages")).toBeInTheDocument();
    expect(screen.getByText("The newsroom screens are still being built.")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Organization" });
    expect(nav).toHaveTextContent("Team");
    expect(screen.getAllByRole("link", { name: "Team" })[0]).toHaveAttribute("href", "/org/org-demo-sahyadri/team");
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("is in Marathi", async () => {
    renderAuth("/org/org-demo-konkan", { preset: "konkan-reviewer", language: "mr" });
    expect(await screen.findByText("इथे तुमची भूमिका: सदस्य.")).toBeInTheDocument();
    expect(screen.getByText("Ratnagiri Tide मधील भूमिका: वाचक")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "टीम" })).not.toBeInTheDocument();
  });
});
