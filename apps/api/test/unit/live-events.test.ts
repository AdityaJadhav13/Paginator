// Who hears which live update (src/modules/notifications/events.ts), without a database: the decision each stream
// makes from its own person's access, and the hub's strict reading of Postgres's hints.
import type { PublicationAccess } from "@pageinator/contracts";
import { describe, expect, it } from "vitest";
import { type Stream, eventHub, messageFor } from "../../src/modules/notifications/events.ts";

const id = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const ORG = id(1);
const PUB = id(2);
const OTHER_PUB = id(3);
const STORY = id(4);
const ME = id(5);
const SOMEONE = id(6);

function listener(orgRole: "owner" | "member", roles: string[] = [], pub = PUB) {
  const publications = new Map<string, PublicationAccess>(
    orgRole === "owner"
      ? [
          [PUB, { roles: [], grants: [] }],
          [OTHER_PUB, { roles: [], grants: [] }],
        ]
      : [],
  );
  if (roles.length > 0) publications.set(pub, { roles: roles as PublicationAccess["roles"], grants: [] });
  return { orgId: ORG, userId: ME, access: { orgRole, publications } };
}
const story = (people: string[] = [SOMEONE], pub = PUB) =>
  ({ v: 1, type: "story", org: ORG, pub, story: STORY, people }) as const;
const comment = (people: string[] = [SOMEONE]) =>
  ({ v: 1, type: "comment", org: ORG, pub: PUB, story: STORY, comment: id(7), people }) as const;

describe("messageFor", () => {
  const edition = (pub = PUB) => ({ v: 1, type: "edition", org: ORG, pub, edition: id(8) }) as const;
  it.each([
    ["the Owner", listener("owner"), true],
    ["an Editor", listener("member", ["editor"]), true],
    ["a Viewer", listener("member", ["viewer"]), true],
    ["Advertising (◐ edition.view)", listener("member", ["advertising"]), true],
    ["a Reporter (no edition.view)", listener("member", ["reporter"]), false],
    ["an Editor of another publication", listener("member", ["editor"], OTHER_PUB), false],
  ])("an edition of the publication: %s hears it: %s", (_who, me, hears) => {
    expect(messageFor(me, edition())).toEqual(
      hears ? { event: "edition", data: { publicationId: PUB, editionId: id(8) } } : null,
    );
  });
  it("an edition of another organisation is never heard", () => {
    expect(messageFor(listener("owner"), { ...edition(), org: id(9) })).toBeNull();
  });

  const imported = (user = ME, pub = PUB) => ({ v: 1, type: "import", org: ORG, pub, import: id(10), user }) as const;
  it("a Word import is heard by its importer only, while they reach its publication", () => {
    expect(messageFor(listener("member", ["reporter"]), imported())).toEqual({
      event: "import",
      data: { publicationId: PUB, importId: id(10) },
    });
    expect(messageFor(listener("owner"), imported(SOMEONE))).toBeNull(); // not even the Owner hears another's
    expect(messageFor(listener("member", ["reporter"], OTHER_PUB), imported())).toBeNull();
    expect(messageFor(listener("member", ["reporter"]), { ...imported(), org: id(9) })).toBeNull();
  });

  it.each([
    ["the Owner", listener("owner"), true],
    ["an Editor", listener("member", ["editor"]), true],
    ["a Viewer", listener("member", ["viewer"]), true],
    ["a Photo Editor (sees all stories)", listener("member", ["photo_editor"]), true],
    ["a Reporter, not theirs", listener("member", ["reporter"]), false],
    ["Advertising (no stories)", listener("member", ["advertising"]), false],
    ["an Editor of another publication", listener("member", ["editor"], OTHER_PUB), false],
  ])("a story of the publication: %s hears it: %s", (_who, me, hears) => {
    expect(messageFor(me, story()) !== null).toBe(hears);
  });

  it("a Reporter is asked only when the hint names them, and the story is to be confirmed as theirs first", () => {
    const me = listener("member", ["reporter"]);
    const confirm = { publicationId: PUB, storyId: STORY };
    expect(messageFor(me, story([SOMEONE, ME]))).toEqual({
      event: "story",
      data: { publicationId: PUB, storyId: STORY },
      confirm,
    });
    expect(messageFor(me, comment([ME]))).toEqual({
      event: "comment",
      data: { publicationId: PUB, storyId: STORY, commentId: id(7) },
      confirm,
    });
    expect(messageFor(listener("member", ["editor"]), story())?.confirm).toBeUndefined();
  });

  it("nobody hears of another organisation, and a notification goes to its own person only", () => {
    expect(messageFor(listener("owner"), { ...story(), org: id(99) })).toBeNull();
    const notice = { v: 1, type: "notification", org: ORG, user: ME, notification: id(8) } as const;
    expect(messageFor(listener("member", ["viewer"]), notice)).toEqual({ event: "notification", data: { id: id(8) } });
    expect(messageFor(listener("owner"), { ...notice, user: SOMEONE })).toBeNull();
  });
});

describe("the hub", () => {
  function stream(me = listener("owner"), theirs = true): Stream & { got: [string, object][] } {
    const got: [string, object][] = [];
    return {
      ...me,
      got,
      send: (event, data) => void got.push([event, data]),
      confirm: async () => theirs,
      end: () => undefined,
    };
  }

  it("sends a Reporter's event only once the story is confirmed theirs: a forged hint naming them carries nothing", async () => {
    const hub = eventHub(() => undefined);
    const forged = stream(listener("member", ["reporter"]), false);
    const real = stream(listener("member", ["reporter"]), true);
    hub.add(forged);
    hub.add(real);
    hub.deliver(JSON.stringify(story([ME])));
    await new Promise((resolve) => setImmediate(resolve));
    expect([forged.got, real.got]).toEqual([[], [["story", { publicationId: PUB, storyId: STORY }]]]);
  });

  it("drops a hint that is not JSON, not exactly ours, or of another version, and says why", () => {
    const dropped: string[] = [];
    const hub = eventHub((reason) => dropped.push(reason));
    const s = stream();
    hub.add(s);
    hub.deliver("not json");
    hub.deliver(JSON.stringify({ ...story(), headline: "text in a hint" }));
    hub.deliver(JSON.stringify({ ...story(), v: 2 }));
    hub.deliver(JSON.stringify({ ...story(), story: "not-an-id" }));
    hub.deliver(JSON.stringify({ ...story(), people: [id(1), id(2), id(3), id(4)] }));
    expect(s.got).toEqual([]);
    expect(dropped).toEqual(["not JSON", ...new Array(4).fill("not an event of ours")]);
    hub.deliver(JSON.stringify(story()));
    expect(s.got).toEqual([["story", { publicationId: PUB, storyId: STORY }]]);
  });

  it("tells everyone to resync after a gap, and ends every stream at once", () => {
    const hub = eventHub(() => undefined);
    const ended: string[] = [];
    const a = { ...stream(), end: () => void ended.push("a") };
    const b = { ...stream(), end: () => void ended.push("b") };
    hub.add(a);
    hub.add(b);
    hub.resync();
    expect([a.got, b.got]).toEqual([[["resync", {}]], [["resync", {}]]]);
    hub.endAll();
    expect([ended, hub.size()]).toEqual([["a", "b"], 0]);
  });
});
