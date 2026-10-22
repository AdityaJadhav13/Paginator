// The stories API's rules (src/modules/stories/rules.ts), without a database: what each role sees, edits and may move
// a story to, from each state (plan §5.4, proposed; 07 §12).
import type { PublicationRole, StoryStatus } from "@pageinator/contracts";
import { describe, expect, it } from "vitest";
import type { Access } from "../../src/modules/access/access.ts";
import {
  canAttachPhoto,
  canDelete,
  canEdit,
  mediaScope,
  storyScope,
  transitionsFor,
} from "../../src/modules/stories/rules.ts";

const PUB = "01900000-0000-7000-8000-000000000a11";
const ME = "01900000-0000-7000-8000-000000000001";
const OTHER = "01900000-0000-7000-8000-000000000002";

function as(orgRole: "owner" | "admin" | "member", roles: PublicationRole[] = []): Access {
  return {
    tenant: { orgId: PUB, userId: ME, pubIds: [PUB], requestId: "t" },
    orgRole,
    publications: new Map([[PUB, { roles, grants: [] }]]),
    reach: "full",
  };
}
const story = (status: StoryStatus, reporterId = ME) => ({ status, reporterId, assigneeId: null });

describe("story rules", () => {
  it("scopes what each role sees", () => {
    expect(storyScope(as("owner"), PUB)).toBe("all");
    expect(storyScope(as("member", ["reporter"]), PUB)).toBe("own");
    expect(storyScope(as("member", ["reporter", "sub_editor"]), PUB)).toBe("all");
    expect(storyScope(as("member", ["photo_editor"]), PUB)).toBe("all");
    expect(storyScope(as("member", ["advertising"]), PUB)).toBe("none");
    expect(storyScope(as("member", ["viewer"]), PUB)).toBe("all");
  });

  it.each([
    ["draft", ["filed"]],
    ["filed", []],
    ["ready", []],
  ] as const)("gives the reporter of a %s story the moves %j", (status, moves) => {
    expect(transitionsFor(as("member", ["reporter"]), PUB, story(status), ME)).toEqual(moves);
  });

  it.each([
    ["draft", ["held", "spiked"]],
    ["filed", ["editing", "ready", "draft", "held", "spiked"]],
    ["editing", ["ready", "draft", "held", "spiked"]],
    ["ready", ["draft", "held", "spiked"]],
    ["held", ["restore", "spiked"]],
    ["spiked", ["restore"]],
    ["placed", ["held", "spiked"]],
  ] as const)("gives an Editor, from %s, the moves %j", (status, moves) => {
    expect(transitionsFor(as("member", ["editor"]), PUB, story(status, OTHER), ME)).toEqual(moves);
  });

  it("lets a Sub-editor do all but spike and restore a spiked story", () => {
    expect(transitionsFor(as("member", ["sub_editor"]), PUB, story("filed", OTHER), ME)).toEqual([
      "editing",
      "ready",
      "draft",
      "held",
    ]);
    expect(transitionsFor(as("member", ["sub_editor"]), PUB, story("spiked", OTHER), ME)).toEqual([]);
  });

  it("lets a reporter edit and delete their own story before Ready, and only then", () => {
    const reporter = as("member", ["reporter"]);
    for (const status of ["draft", "filed", "editing"] as const)
      expect(canEdit(reporter, PUB, story(status), ME)).toBe(true);
    for (const status of ["ready", "held", "spiked", "placed"] as const)
      expect(canEdit(reporter, PUB, story(status), ME)).toBe(false);
    expect(canEdit(reporter, PUB, story("draft", OTHER), ME)).toBe(false);
    expect(canDelete(reporter, PUB, story("draft"), ME)).toBe(true);
    expect(canDelete(reporter, PUB, story("filed"), ME)).toBe(false);
    expect(canEdit(as("member", ["editor"]), PUB, story("spiked", OTHER), ME)).toBe(false);
    expect(canEdit(as("member", ["page_designer"]), PUB, story("draft", OTHER), ME)).toBe(false);
  });

  it("lets a Photo Editor give any story they see its photo, but a spiked one; others as they edit", () => {
    const photo = as("member", ["photo_editor"]);
    expect(canAttachPhoto(photo, PUB, story("ready", OTHER), ME)).toBe(true);
    expect(canAttachPhoto(photo, PUB, story("spiked", OTHER), ME)).toBe(false);
    expect(canAttachPhoto(as("member", ["reporter"]), PUB, story("draft"), ME)).toBe(true);
    expect(canAttachPhoto(as("member", ["reporter"]), PUB, story("ready"), ME)).toBe(false);
    expect(canAttachPhoto(as("member", ["viewer"]), PUB, story("draft", OTHER), ME)).toBe(false);
  });

  it("scopes downloads: all with a full media.view, a Reporter's own, none for Advertising", () => {
    expect(mediaScope(as("member", ["viewer"]), PUB)).toBe("all");
    expect(mediaScope(as("member", ["reporter"]), PUB)).toBe("own");
    expect(mediaScope(as("member", ["advertising"]), PUB)).toBe("none");
    expect(mediaScope(as("admin"), PUB)).toBe("all");
  });
});
