/**
 * Unsaved story text kept on this device, so a phone that loses its signal loses nothing (plan §10 PR 22). Only the
 * story's own text and the desk's fields are kept, never a token or a password; each person's drafts are under their
 * own key, so the next person on a shared device never sees them.
 *
 * A draft keeps the fields it was based on (`base`) and their version, so that restoring it applies only what the
 * person changed, and a stale one goes through the conflict screen. A story not yet created keeps the create request
 * it sent (its Idempotency-Key and body), so a retry after a lost answer, even after a reload, makes no second story.
 *
 * Signing out removes them, once the sign-out has succeeded, and tells the other tabs (the `storage` event), which stop
 * keeping drafts for that person. An expired session keeps them: the API's signed_out answer promises that what was
 * typed is kept on this device.
 */
import type { StoryInputDto } from "../../services/index.ts";

export interface StoryFields {
  readonly headline: string;
  readonly kicker: string;
  readonly deck: string;
  readonly byline: string;
  readonly body: string;
  readonly priority: number;
  readonly pagePin: number | null;
  readonly deskNote: string;
  /** The photo's caption and credit (empty while the story has no photo). */
  readonly caption: string;
  readonly credit: string;
}

export interface PendingCreate {
  readonly key: string;
  readonly input: StoryInputDto;
}

export interface StoryDraft {
  readonly fields: StoryFields;
  /** The fields the text was written on: the story as this device last knew it. */
  readonly base: StoryFields;
  /** The story's version the text was written on; null for a story not created yet. */
  readonly baseRevision: number | null;
  /** A create sent without a known answer: retried exactly, with the same key. */
  readonly create?: PendingCreate;
  /** A change on its way to the API when this was written: if it arrived, the story's version is it. */
  readonly sending?: StoryFields;
  /** How many versions that change makes (the photo's caption and credit, then the story's fields: 1 or 2). */
  readonly sendingSteps?: number;
  /** The story's photo the text was written for (its caption and credit belong to it). */
  readonly photoAssetId?: string | null;
  /** When it was last written, ISO 8601. */
  readonly savedAt: string;
}

export const DRAFTS_PREFIX = "pageinator.drafts.";
/** Written by the tab that signs out; the other tabs hear it as a `storage` event. */
export const SIGNED_OUT_KEY = "pageinator.signedOut";

const keyOf = (userId: string) => `${DRAFTS_PREFIX}${userId}`;
/** People whose drafts this tab no longer keeps: they signed out, here or in another tab. */
const disabled = new Set<string>();

const FIELD_KEYS = ["headline", "kicker", "deck", "byline", "body", "priority", "pagePin", "deskNote"] as const;

/** A draft's fields; caption and credit came with photos (L2-J), so a draft written before has them empty. */
function isFields(value: unknown): value is StoryFields {
  if (typeof value !== "object" || value === null) return false;
  const fields = value as Record<string, unknown>;
  return (
    FIELD_KEYS.every((key) => key in fields) &&
    ["headline", "kicker", "deck", "byline", "body", "deskNote"].every((key) => typeof fields[key] === "string") &&
    ["caption", "credit"].every((key) => fields[key] === undefined || typeof fields[key] === "string") &&
    typeof fields["priority"] === "number" &&
    (fields["pagePin"] === null || typeof fields["pagePin"] === "number")
  );
}

const withPhotoFields = (fields: StoryFields): StoryFields => ({ ...fields, caption: fields.caption ?? "", credit: fields.credit ?? "" });

function isDraft(value: unknown): value is StoryDraft {
  if (typeof value !== "object" || value === null) return false;
  const draft = value as Record<string, unknown>;
  return (
    isFields(draft["fields"]) &&
    isFields(draft["base"]) &&
    (draft["baseRevision"] === null || typeof draft["baseRevision"] === "number") &&
    (draft["sending"] === undefined || isFields(draft["sending"])) &&
    typeof draft["savedAt"] === "string"
  );
}

function readAll(userId: string): Record<string, unknown> {
  try {
    const value = JSON.parse(window.localStorage.getItem(keyOf(userId)) ?? "{}") as unknown;
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function writeAll(userId: string, drafts: Record<string, unknown>): void {
  try {
    if (Object.keys(drafts).length === 0) window.localStorage.removeItem(keyOf(userId));
    else window.localStorage.setItem(keyOf(userId), JSON.stringify(drafts));
  } catch {
    // storage full or refused: the text stays on the screen only
  }
}

/** A story's draft key: its id, or "new:<publication>" before it exists. */
export const draftKey = (storyId: string | undefined, publicationId: string) => storyId ?? `new:${publicationId}`;

export function readDraft(userId: string, key: string): StoryDraft | undefined {
  const draft = readAll(userId)[key];
  if (!isDraft(draft)) return undefined;
  return {
    ...draft,
    fields: withPhotoFields(draft.fields),
    base: withPhotoFields(draft.base),
    ...(draft.sending ? { sending: withPhotoFields(draft.sending) } : {}),
  };
}

export function writeDraft(userId: string, key: string, draft: StoryDraft): void {
  if (disabled.has(userId)) return;
  writeAll(userId, { ...readAll(userId), [key]: draft });
}

export function dropDraft(userId: string, key: string): void {
  const drafts = readAll(userId);
  if (!(key in drafts)) return;
  delete drafts[key];
  writeAll(userId, drafts);
}

/** How many stories have unsaved text on this device for the person. */
export function countDrafts(userId: string): number {
  return Object.values(readAll(userId)).filter(isDraft).length;
}

/** Every draft of this person goes, and this tab keeps no more for them until they sign in again. */
export function forgetDrafts(userId: string): void {
  disabled.add(userId);
  try {
    window.localStorage.removeItem(keyOf(userId));
  } catch {
    // nothing was kept
  }
}

/** Signed in (again): this tab keeps the person's drafts. */
export function keepDrafts(userId: string): void {
  disabled.delete(userId);
}

/** After a sign-out that succeeded: the drafts go, here and, through the `storage` event, in every other tab. */
export function signedOut(userId: string): void {
  forgetDrafts(userId);
  try {
    window.localStorage.setItem(SIGNED_OUT_KEY, JSON.stringify({ userId, at: new Date().toISOString() }));
  } catch {
    // the other tabs learn it from their next request (401 signed_out)
  }
}

/** Who signed out in another tab, from a `storage` event; undefined for any other event. */
export function signedOutElsewhere(event: StorageEvent): string | undefined {
  if (event.key !== SIGNED_OUT_KEY || !event.newValue) return undefined;
  try {
    const value = JSON.parse(event.newValue) as { userId?: unknown };
    return typeof value.userId === "string" ? value.userId : undefined;
  } catch {
    return undefined;
  }
}
