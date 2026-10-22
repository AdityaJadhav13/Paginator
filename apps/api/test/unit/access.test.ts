// The access check's own rules (src/modules/access/access.ts), without a database: which organisation role a stored
// Better Auth role string gives, and when the two-step rule applies.
import { describe, expect, it } from "vitest";
import { needsTwoStep, orgRoleOf } from "../../src/modules/access/access.ts";

describe("orgRoleOf", () => {
  it.each([
    ["owner", "owner"],
    ["admin", "admin"],
    ["member", "member"],
    ["member,admin", "admin"],
    [" member , owner ", "owner"],
    ["superuser", null],
    ["", null],
  ])("reads %j as %s", (stored, role) => {
    expect(orgRoleOf(stored)).toBe(role);
  });
});

describe("needsTwoStep", () => {
  it("applies to the organisation roles and publication roles the organisation names, and to no other", () => {
    expect(needsTwoStep(["owner", "admin"], "owner", [])).toBe(true);
    expect(needsTwoStep(["owner", "admin"], "member", ["chief_editor"])).toBe(false);
    expect(needsTwoStep(["owner", "admin", "prepress"], "member", ["reporter", "prepress"])).toBe(true);
    expect(needsTwoStep([], "owner", ["chief_editor"])).toBe(false);
  });
});
