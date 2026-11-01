/**
 * The notifications double, answered as the API answers them (src/modules/notifications/routes.ts; 06 §11): the
 * person's own, in one organisation, newest first, only those of publications they still reach (and of none, as an
 * invitation's); the unread count over all of them; cursor pages (30 by default, at most 100); marking some (1–100 of
 * the person's own; others' are left alone) or all of them read. The route needs publication.view on any of the
 * organisation's publications (any role; Owner and Admin always). Who is told of what is decided where the change is
 * made (create-mock-stories.ts, as the API's notify.ts); a new one for the browser's person is a live `notification`.
 * Fictional data only; deterministic (no clock, no randomness).
 */
import type { ApiProblem, NotificationDto, NotificationKindDto, NotificationService, ServiceResult } from "../services/index.ts";
import { reach, type PublicationAccess } from "../services/permissions.ts";

export type MockNotificationOperation = "notifications.list" | "notifications.read";

/** The person's standing in an organisation, as the API's access check finds it for an organisation route. */
export interface MockOrgStanding {
  readonly orgRole: "owner" | "admin" | "member";
  /** The publications they reach. */
  readonly publications: readonly string[];
  /** Their roles and grants across those publications. */
  readonly union: PublicationAccess;
  readonly twoStepBlocked: boolean;
}

export interface MockNotificationDeps {
  person(): { readonly userId: string; readonly name: string } | undefined;
  /** undefined: not a member of the organisation (the API answers 404). */
  orgStanding(userId: string, orgId: string): MockOrgStanding | undefined;
  gate(operation: MockNotificationOperation): Promise<ApiProblem | undefined>;
  signedOut<T>(): ServiceResult<T, ApiProblem>;
  /** A new notification for this person, in this organisation (the live double decides who hears it). */
  told(orgId: string, userId: string, id: string): void;
}

/** What a change tells someone of (the API's NewNotification). */
export interface MockNotice {
  readonly kind: NotificationKindDto;
  readonly publicationId?: string | null;
  readonly storyId?: string | null;
  readonly commentId?: string | null;
  readonly invitationId?: string | null;
  readonly actor: { readonly id: string; readonly name: string } | null;
}

interface Row extends Omit<NotificationDto, "readAt" | "story" | "invitee"> {
  readonly orgId: string;
  readonly userId: string;
  readonly order: number;
  readAt: string | null;
}

type Answer = Extract<ApiProblem, { kind: "answer" }>;
const answer = (status: number, code: string, message: string): Answer => ({ kind: "answer", status, code, message, requestId: "mock-request" });
const NOT_FOUND = answer(404, "not_found", "There is nothing here, or you do not have access to it.");
const NOT_ALLOWED = answer(403, "not_allowed", "Your role cannot do this. Ask an editor or the owner.");
const TWO_STEP = answer(403, "two_step_required", "Your role needs two-step sign-in. Set it up in Account → Security.");
const invalid = (field: string, message: string): Answer => ({ ...answer(400, "invalid_request", "Some fields are not right."), details: [{ field, message }] });

/** Fictional notifications: the Sahyadri reporter's, one read, one not. */
function fixtures(): Row[] {
  const base = { orgId: "org-demo-sahyadri", publicationId: "pub-demo-pune-daily", commentId: null, invitationId: null };
  return [
    {
      ...base,
      id: "notification-demo-001",
      userId: "user-demo-sahyadri-reporter",
      kind: "story_assigned",
      storyId: "story-demo-002",
      actor: { id: "user-demo-sahyadri-editor", name: "Sahyadri Demo Editor" },
      createdAt: "2026-10-22T08:00:00.000Z",
      readAt: "2026-10-22T08:30:00.000Z",
      order: 1,
    },
    {
      ...base,
      id: "notification-demo-002",
      userId: "user-demo-sahyadri-reporter",
      kind: "comment",
      storyId: "story-demo-001",
      commentId: "comment-demo-001",
      actor: { id: "user-demo-sahyadri-editor", name: "Sahyadri Demo Editor" },
      createdAt: "2026-10-22T09:00:00.000Z",
      readAt: null,
      order: 2,
    },
  ];
}

export function createMockNotifications(deps: MockNotificationDeps): {
  notifications: NotificationService;
  add(orgId: string, userId: string, notice: MockNotice): void;
  reset(): void;
} {
  let rows = fixtures();
  let counter = 0;

  async function check<T>(
    operation: MockNotificationOperation,
    orgId: string,
  ): Promise<ServiceResult<T, ApiProblem> | { userId: string; standing: MockOrgStanding }> {
    const problem = await deps.gate(operation);
    if (problem) return { ok: false, error: { ...problem } };
    const person = deps.person();
    if (!person) return deps.signedOut();
    const standing = deps.orgStanding(person.userId, orgId);
    if (!standing) return { ok: false, error: { ...NOT_FOUND } };
    if (standing.twoStepBlocked) return { ok: false, error: { ...TWO_STEP } };
    if (reach("publication.view", standing.orgRole, standing.union) === null) return { ok: false, error: { ...NOT_ALLOWED } };
    return { userId: person.userId, standing };
  }
  const refused = <T,>(checked: object): checked is ServiceResult<T, ApiProblem> => "ok" in checked;

  /** The person's own here, of publications they still reach (or of none), newest first. */
  const theirs = (orgId: string, userId: string, standing: MockOrgStanding) =>
    rows
      .filter((row) => row.orgId === orgId && row.userId === userId)
      .filter((row) => row.publicationId === null || standing.publications.includes(row.publicationId))
      .sort((a, b) => b.order - a.order);

  const dto = (row: Row): NotificationDto => ({
    id: row.id,
    kind: row.kind,
    publicationId: row.publicationId,
    storyId: row.storyId,
    commentId: row.commentId,
    invitationId: row.invitationId,
    actor: row.actor ? { ...row.actor } : null,
    // shortcut: no display text (the API resolves story/invitee under the reader's access), until the drawer shows it
    story: null,
    invitee: null,
    createdAt: row.createdAt,
    readAt: row.readAt,
  });

  const notifications: NotificationService = {
    async list({ orgId, unread, cursor, limit }) {
      const checked = await check<never>("notifications.list", orgId);
      if (refused(checked)) return checked;
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
        return { ok: false, error: invalid("querystring.limit", "must be between 1 and 100") };
      }
      const all = theirs(orgId, checked.userId, checked.standing);
      const matching = unread ? all.filter((row) => row.readAt === null) : all;
      // the API's cursor names the last one shown: the page after it is what is older
      let start = 0;
      if (cursor !== undefined) {
        const older = /^cursor-(\d+)$/.exec(cursor);
        if (!older) return { ok: false, error: invalid("querystring.cursor", "is not a cursor this API gave") };
        start = matching.findIndex((row) => row.order < Number(older[1]));
        if (start < 0) start = matching.length;
      }
      const size = limit ?? 30;
      const page = matching.slice(start, start + size);
      const last = page[page.length - 1];
      return {
        ok: true,
        value: {
          items: page.map(dto),
          unread: all.filter((row) => row.readAt === null).length,
          nextCursor: start + size < matching.length && last ? `cursor-${last.order}` : null,
        },
      };
    },

    async markRead(input) {
      const checked = await check<never>("notifications.read", input.orgId);
      if (refused(checked)) return checked;
      if ("ids" in input && (input.ids.length < 1 || input.ids.length > 100)) {
        return { ok: false, error: invalid("body.ids", "must name 1 to 100 notifications") };
      }
      const which = "ids" in input ? new Set(input.ids) : null;
      counter += 1;
      const at = `2026-10-22T12:${String(counter % 60).padStart(2, "0")}:00.000Z`;
      for (const row of rows) {
        if (row.orgId !== input.orgId || row.userId !== checked.userId || row.readAt !== null) continue;
        if (which && !which.has(row.id)) continue;
        row.readAt = at;
      }
      return { ok: true, value: undefined };
    },
  };

  return {
    notifications,
    add(orgId, userId, notice) {
      counter += 1;
      const id = `notification-new-${String(counter).padStart(3, "0")}`;
      rows = [
        ...rows,
        {
          id,
          orgId,
          userId,
          kind: notice.kind,
          publicationId: notice.publicationId ?? null,
          storyId: notice.storyId ?? null,
          commentId: notice.commentId ?? null,
          invitationId: notice.invitationId ?? null,
          actor: notice.actor ? { ...notice.actor } : null,
          createdAt: `2026-10-22T11:${String(counter % 60).padStart(2, "0")}:00.000Z`,
          readAt: null,
          order: 100 + counter,
        },
      ];
      deps.told(orgId, userId, id);
    },
    reset() {
      rows = fixtures();
      counter = 0;
    },
  };
}
