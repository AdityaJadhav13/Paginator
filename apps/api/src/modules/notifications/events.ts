// Live updates (docs/product/10-l2-newsroom-plan.md §2, §5.2; tenancy test (f), §4.8): who hears what. Postgres sends
// a hint on channel app_events after each change commits (migration 2026_11_24_0001); the API's one LISTEN connection
// (src/db/events.ts) hands it here. A hint is untrusted: it is parsed strictly (ids only, or it is dropped), and each
// open stream decides from its own person's access, not from the hint, whether to pass it on:
//   - a notification: to its own person only, in its own organisation;
//   - a Word import settled: to its importer only, in its own organisation, while they still reach its publication;
//   - an edition: to people of its organisation who may view its publication's editions (edition.view);
//   - an edition's layout (a run, a page, an ad slot, its measuring): to those who may view its pages (pages.view);
//     an engine profile: to those who may view the publication's settings (settings.view);
//   - a story, or a comment on one: to people of its organisation who reach its publication and see the story; a
//     comment also needs comment.read. A Reporter sees their own stories only: the hint's people (the story's reporter
//     and assignees, before and after) only narrow who is asked, and the story is then read under the Reporter's own
//     tenant to confirm it is theirs now (Stream.confirm), so a forged hint naming them carries nothing to them.
// What reaches the browser is ids only; the web fetches what changed through the routes that check access. A stream
// re-checks its person's session and membership every heartbeat (25 s), and ends when either is gone.
import { reach } from "@pageinator/contracts";
import { z } from "zod";
import type { Access } from "../access/access.ts";
import { storyScope } from "../stories/rules.ts";

const Id = z.uuid();

export const AppEvent = z.discriminatedUnion("type", [
  z.strictObject({
    v: z.literal(1),
    type: z.literal("story"),
    org: Id,
    pub: Id,
    story: Id,
    people: z.array(Id).max(3),
  }),
  z.strictObject({
    v: z.literal(1),
    type: z.literal("comment"),
    org: Id,
    pub: Id,
    story: Id,
    comment: Id,
    people: z.array(Id).max(2),
  }),
  z.strictObject({ v: z.literal(1), type: z.literal("notification"), org: Id, user: Id, notification: Id }),
  z.strictObject({ v: z.literal(1), type: z.literal("edition"), org: Id, pub: Id, edition: Id }),
  z.strictObject({ v: z.literal(1), type: z.literal("import"), org: Id, pub: Id, import: Id, user: Id }),
  z.strictObject({ v: z.literal(1), type: z.literal("layout"), org: Id, pub: Id, edition: Id, run: Id.nullable() }),
  z.strictObject({ v: z.literal(1), type: z.literal("profile"), org: Id, pub: Id, profile: Id }),
  z.strictObject({ v: z.literal(1), type: z.literal("onboarding"), org: Id, pub: Id, onboarding: Id }),
]);
export type AppEvent = z.infer<typeof AppEvent>;

/** What one stream knows of its person. */
export type Listener = { orgId: string; userId: string; access: Pick<Access, "orgRole" | "publications"> };

/** The event a stream sends for a hint, or null when its person may not hear it. */
export type Message = {
  event: string;
  data: object;
  /** For a person who sees their own stories only: the story to confirm as theirs before sending. */
  confirm?: { publicationId: string; storyId: string };
};

export function messageFor(listener: Listener, event: AppEvent): Message | null {
  if (event.org !== listener.orgId) return null;
  if (event.type === "notification") {
    return event.user === listener.userId ? { event: "notification", data: { id: event.notification } } : null;
  }
  const access = listener.access as Access;
  if (!access.publications.has(event.pub)) return null;
  if (event.type === "import") {
    if (event.user !== listener.userId) return null;
    return { event: "import", data: { publicationId: event.pub, importId: event.import } };
  }
  if (event.type === "layout" || event.type === "profile" || event.type === "onboarding") {
    const here = access.publications.get(event.pub) ?? { roles: [], grants: [] };
    if (event.type === "layout") {
      if (reach("pages.view", access.orgRole, here) === null) return null;
      return { event: "layout", data: { publicationId: event.pub, editionId: event.edition, runId: event.run } };
    }
    if (reach("settings.view", access.orgRole, here) === null) return null;
    if (event.type === "onboarding")
      return { event: "onboarding", data: { publicationId: event.pub, onboardingId: event.onboarding } };
    return { event: "profile", data: { publicationId: event.pub, profileId: event.profile } };
  }
  if (event.type === "edition") {
    const here = access.publications.get(event.pub) ?? { roles: [], grants: [] };
    if (reach("edition.view", access.orgRole, here) === null) return null;
    return { event: "edition", data: { publicationId: event.pub, editionId: event.edition } };
  }
  const scope = storyScope(access, event.pub);
  if (scope === "none" || (scope === "own" && !event.people.includes(listener.userId))) return null;
  const confirm = scope === "own" ? { confirm: { publicationId: event.pub, storyId: event.story } } : {};
  if (event.type === "story") {
    return { event: "story", data: { publicationId: event.pub, storyId: event.story }, ...confirm };
  }
  const here = access.publications.get(event.pub) ?? { roles: [], grants: [] };
  if (reach("comment.read", access.orgRole, here) === null) return null;
  return {
    event: "comment",
    data: { publicationId: event.pub, storyId: event.story, commentId: event.comment },
    ...confirm,
  };
}

/** One open stream, as the hub sees it. */
export type Stream = Listener & {
  send(event: string, data: object): void;
  /** Whether the story is the person's own now (read under their tenant); false when it cannot be read. */
  confirm(publicationId: string, storyId: string): Promise<boolean>;
  end(): void;
};

export type Hub = {
  add(stream: Stream): void;
  remove(stream: Stream): void;
  /** How many streams the person has open. */
  count(userId: string): number;
  size(): number;
  /** A message from app_events. */
  deliver(text: string): void;
  /** Messages may have been missed: everyone fetches afresh. */
  resync(): void;
  /** Ends every stream (the app is stopping). */
  endAll(): void;
};

export function eventHub(onDropped: (reason: string) => void): Hub {
  const streams = new Set<Stream>();
  return {
    add: (stream) => void streams.add(stream),
    remove: (stream) => void streams.delete(stream),
    count: (userId) => [...streams].filter((stream) => stream.userId === userId).length,
    size: () => streams.size,
    deliver(text) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        onDropped("not JSON");
        return;
      }
      const event = AppEvent.safeParse(parsed);
      if (!event.success) {
        onDropped("not an event of ours");
        return;
      }
      for (const stream of streams) {
        const message = messageFor(stream, event.data);
        if (!message) continue;
        if (!message.confirm) {
          stream.send(message.event, message.data);
          continue;
        }
        const { publicationId, storyId } = message.confirm;
        void stream.confirm(publicationId, storyId).then(
          (theirs) => theirs && stream.send(message.event, message.data),
          () => undefined, // what cannot be confirmed is not sent
        );
      }
    },
    resync() {
      for (const stream of streams) stream.send("resync", {});
    },
    endAll() {
      for (const stream of [...streams]) stream.end();
      streams.clear();
    },
  };
}
