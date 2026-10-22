// The permission map (src/permissions.ts) against 07-roles-settings-mobile.md §12, cell by cell for the rows the
// L2.1 endpoints use, and its rules: Owner everything, Admin all but billing, grants, scoped cells, viewers read only.
import { describe, expect, it } from "vitest";
import {
  PERMISSIONS,
  PERMISSION_NAMES,
  PUBLICATION_ROLES,
  type Permission,
  PublicationGrant,
  type PublicationRole,
  grantsFit,
  reach,
} from "../src/index.ts";

const as = (role: PublicationRole, grants: ("page_approve" | "release_approve")[] = []) => ({ roles: [role], grants });
const none = { roles: [], grants: [] };

describe("the permission map", () => {
  it("names only the nine publication roles, and says which row of §12 or doc 11 each permission comes from", () => {
    for (const name of PERMISSION_NAMES) {
      const rule = PERMISSIONS[name];
      expect(rule.row.length, name).toBeGreaterThan(3);
      for (const role of Object.keys(rule.roles)) expect(PUBLICATION_ROLES, `${name}: ${role}`).toContain(role);
    }
  });

  it("gives the Owner every permission and the Admin all but billing, on any publication, with no role there", () => {
    for (const name of PERMISSION_NAMES) {
      expect(reach(name, "owner", none), name).toBe("full");
      expect(reach(name, "admin", none), name).toBe(name === "billing.manage" ? null : "full");
      expect(reach(name, "member", none), name).toBeNull();
    }
  });

  // §12's rows as the L2.1 endpoints use them: [permission, role, expected]
  const CELLS: [Permission, PublicationRole, "full" | "scoped" | null][] = [
    ["members.view", "chief_editor", "full"], // Team ○
    ["members.view", "editor", null],
    ["members.manage", "chief_editor", null],
    ["story.view", "reporter", "scoped"], // ◐ own stories
    ["story.view", "photo_editor", "scoped"], // ◐ photos
    ["story.view", "viewer", "full"], // ○
    ["story.create", "reporter", "full"],
    ["story.create", "page_designer", null],
    ["story.edit_own", "reporter", "scoped"], // ◐ own, before Ready
    ["story.edit_any", "reporter", null],
    ["story.edit_any", "page_designer", "scoped"], // ◐ box text only
    ["story.edit_any", "photo_editor", null],
    ["edition.create", "sub_editor", null], // ○
    ["edition.view", "sub_editor", "full"],
    ["edition.view", "reporter", null], // —
    ["edition.delete", "editor", null],
    ["comment.write", "viewer", null], // ○ read
    ["comment.read", "viewer", "full"],
    ["comment.write", "reporter", "scoped"],
    ["media.upload", "reporter", "scoped"], // ◐ upload own
    ["media.upload", "page_designer", null], // ○
    ["preflight.override", "prepress", "full"],
    ["export.press", "editor", null],
    ["audit.view", "chief_editor", "scoped"],
    ["settings.edit", "editor", null], // ○
    ["settings.view", "editor", "full"],
  ];
  it.each(CELLS)("%s for %s: %s", (permission, role, expected) => {
    expect(reach(permission, "member", as(role))).toBe(expected);
  });

  it("gives an Editor page and release approval only with the grant", () => {
    expect(reach("page.approve", "member", as("editor"))).toBeNull();
    expect(reach("page.approve", "member", as("editor", ["page_approve"]))).toBe("full");
    expect(reach("release.approve", "member", as("editor", ["page_approve"]))).toBeNull();
    expect(reach("release.approve", "member", as("editor", ["release_approve"]))).toBe("full");
    expect(reach("page.approve", "member", as("chief_editor"))).toBe("full");
  });

  it("counts a grant only with a role allowed to hold it: a Viewer with the grant cannot approve", () => {
    expect(reach("page.approve", "member", as("viewer", ["page_approve"]))).toBeNull();
    expect(reach("release.approve", "member", as("reporter", ["release_approve"]))).toBeNull();
    expect(grantsFit(["viewer"], ["page_approve"])).toBe(false);
    expect(grantsFit(["viewer", "editor"], ["page_approve", "release_approve"])).toBe(true);
    expect(
      PublicationGrant.safeParse({
        publicationId: "01900000-0000-7000-8000-000000000a11",
        roles: ["viewer"],
        grants: ["page_approve"],
      }).success,
    ).toBe(false);
  });

  it("takes the widest of several roles: a full cell wins over a scoped one", () => {
    expect(reach("story.edit_any", "member", { roles: ["page_designer", "sub_editor"], grants: [] })).toBe("full");
    expect(reach("story.view", "member", { roles: ["reporter", "photo_editor"], grants: [] })).toBe("scoped");
  });
});
