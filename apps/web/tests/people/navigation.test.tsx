/**
 * The workspace's navigation from /me (plan §10 PR 20, 07 §12): an entry shows only when the person may use it, only
 * when its screen is built in the deployed app, and nothing but Home while the organisation's two-step rule is unmet.
 * Also the organisation's home, where sign-in lands. Fictional data only.
 */
import { afterEach, describe, expect, it } from "vitest";
import { screen } from "../../src/test/render.tsx";
import { navigation } from "../../src/features/people/navigation.ts";
import { mayCreateEdition, mayExport } from "../../src/features/stories/access.ts";
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
    const managers = ["nav.home /org/o", "glossary.team /org/o/team", "nav.audit /org/o/audit"];
    expect(labels(navigation(org("owner", []), undefined, false))).toEqual(managers);
    expect(labels(navigation(org("admin", []), undefined, false))).toEqual(managers);
    expect(labels(navigation(org("member", ["chief_editor"]), undefined, false))).toEqual(managers);
    for (const role of ["editor", "sub_editor", "reporter", "page_designer", "photo_editor", "advertising", "prepress", "viewer"] as const) {
      expect(labels(navigation(org("member", [role]), undefined, false)), role).toEqual(["nav.home /org/o"]);
    }
  });

  it("lists the placeholder screens in a development build, still by permission", () => {
    expect(labels(navigation(org("admin", []), undefined, true))).toEqual([
      "nav.home /org/o",
      "glossary.team /org/o/team",
      "nav.audit /org/o/audit",
      "nav.orgSettings /org/o/settings",
      "nav.storage /org/o/storage",
    ]); // billing is the owner's alone
    expect(labels(navigation(org("owner", []), undefined, true))).toContain("nav.billing /org/o/billing");
    const reporter = labels(navigation(org("member", ["reporter"]), "p", true));
    expect(reporter).toContain("glossary.stories /org/o/pub/p/stories");
    expect(reporter).not.toContain("nav.brand /org/o/pub/p/brand");
    expect(reporter).not.toContain("glossary.team /org/o/team");
    // in the deployed app a Reporter has their stories, and nothing else of the publication yet (no edition.view)
    expect(labels(navigation(org("member", ["reporter"]), "p", false))).toEqual(["glossary.stories /org/o/pub/p/stories"]);
    // Editions (L2.1) for whoever has edition.view, a ◐ one too; the ads desk is L2.6
    expect(labels(navigation(org("member", ["advertising"]), "p", false))).toEqual(["nav.editions /org/o/pub/p/editions"]);
    expect(labels(navigation(org("member", ["photo_editor"]), "p", false))).toEqual([
      "nav.editions /org/o/pub/p/editions",
      "glossary.stories /org/o/pub/p/stories",
    ]);
    expect(labels(navigation(org("member", ["sub_editor"]), "p", false))).toContain("nav.editions /org/o/pub/p/editions");
    // making an edition and sending it to the Desk need a full cell: Advertising's and Prepress's ◐ are refused
    const full = (role: OrgAccessDto["publications"][number]["roles"][number]) => [mayCreateEdition(org("member", [role]), "p"), mayExport(org("member", [role]), "p")];
    expect(full("editor")).toEqual([true, true]);
    expect(full("chief_editor")).toEqual([true, true]);
    expect(full("sub_editor")).toEqual([false, false]);
    expect(full("advertising")).toEqual([false, false]);
    expect(full("prepress")).toEqual([false, false]);
    expect([mayCreateEdition(org("admin", []), "p"), mayExport(org("owner", []), "p")]).toEqual([true, true]);
  });

  it("offers the audit log (audit.view) to Owner, Admin and a Chief Editor only, under the publication too", () => {
    expect(labels(navigation(org("member", ["chief_editor"]), "p", false))).toContain("nav.audit /org/o/audit");
    expect(labels(navigation(org("admin", []), "p", false))).toContain("nav.audit /org/o/audit");
    for (const role of ["editor", "sub_editor", "reporter", "page_designer", "photo_editor", "advertising", "prepress", "viewer"] as const) {
      expect(labels(navigation(org("member", [role]), "p", true)), role).not.toContain("nav.audit /org/o/audit");
      expect(labels(navigation(org("member", [role]), undefined, true)), role).not.toContain("nav.audit /org/o/audit");
    }
  });

  it("offers only Home while the organisation's two-step rule is unmet", () => {
    const blocked = org("owner", [], { required: true, satisfied: false });
    expect(labels(navigation(blocked, undefined, true))).toEqual(["nav.home /org/o"]);
    const met = org("owner", [], { required: true, satisfied: true });
    expect(labels(navigation(met, undefined, false))).toEqual([
      "nav.home /org/o",
      "glossary.team /org/o/team",
      "nav.audit /org/o/audit",
    ]);
  });
});

describe("The organisation's home", () => {
  it("says the person's role, their publications with roles and grants, and links to what is built", async () => {
    const { container } = renderAuth("/org/org-demo-sahyadri", { preset: "sahyadri-editor" });
    expect(await screen.findByRole("heading", { level: 1, name: "Sahyadri Media Cooperative" })).toBeInTheDocument();
    expect(screen.getByText("Your role here: Admin.")).toBeInTheDocument();
    expect(screen.getByText("Pune Daily Ledger: Editor and Can approve pages")).toBeInTheDocument();
    expect(screen.getByText("The stories desk is open. The other newsroom screens are still being built.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Stories of Pune Daily Ledger" })).toHaveAttribute(
      "href",
      "/org/org-demo-sahyadri/pub/pub-demo-pune-daily/stories",
    );
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
