// The audit log (docs/product/10-l2-newsroom-plan.md §3.4, §5.2; L2.1): what the API records, and how it is read
// (GET /api/v1/orgs/:o/audit, permission audit.view). Objects are strict, and responses are sent through these schemas.
import { z } from "zod";

type ActionRule = {
  /** "org": an organisation-level event (people, invitations, the organisation itself), which only Owner and Admin
   * see; "publication": an event of one publication (its publication_id), which its Chief Editor sees too. */
  scope: "org" | "publication";
};

/**
 * Every action the API writes to app.audit_event, one entry each. A unit test reads the API's writers
 * (apps/api/test/unit/audit-actions.test.ts), so an action written without an entry here, or an entry nothing writes,
 * fails CI. Names follow the table's check: lower-case words joined by dots.
 */
export const AUDIT_ACTIONS = {
  /** A refusal: authorize()'s, or a service rule's (with the reason). On a publication's route it names the
   * publication; elsewhere it has none, and only Owner and Admin see it. */
  "access.denied": { scope: "publication" },
  /** A comment written ({story, parent}); a send-back's is recorded with the move (story.status_change). */
  "comment.create": { scope: "publication" },
  "comment.edit": { scope: "publication" },
  "comment.reopen": { scope: "publication" },
  "comment.resolve": { scope: "publication" },
  /** A picture's print versions, from the engine's inbox (actor: the system): made ({job, paramsHash}), refused by the
   * Desk's rules ({job, code, status}), or not made ({job, code}: the job failed, or the sweep found it lost). */
  /** A picture deleted from the library ({revision}); its own facts changed ({revision, fields}: which, never what
   * they say). */
  "asset.delete": { scope: "publication" },
  "asset.edit": { scope: "publication" },
  "asset.fail": { scope: "publication" },
  "asset.ready": { scope: "publication" },
  "asset.reject": { scope: "publication" },
  /** An edition made ({date, pages}); a story put in or taken out of one is story.edition_change. */
  "edition.create": { scope: "publication" },
  /** A story bundle sent to the Desk, on its edition ({bundle, stories, photos}). */
  "desk.export": { scope: "publication" },
  /** An engine event the inbox would not apply ({event, job, kind, reason}): not the contract's, or for an asset that
   * is not the organisation's and publication's it names, or one that still could not be applied after every try
   * (reason "error"). Only Owner and Admin see it (its publication is unchecked). */
  "engine.event_refuse": { scope: "org" },
  /** An engine event for an asset still waiting but for other bytes ({event, job, kind, reason: "other_bytes"}): late
   * or forged, never applied. A duplicate for a settled or deleted asset is ignored without a record. */
  "engine.event_ignore": { scope: "org" },
  "invitation.accept": { scope: "org" },
  "invitation.cancel": { scope: "org" },
  "invitation.create": { scope: "org" },
  "invitation.grants_repaired": { scope: "org" },
  "invitation.membership_repaired": { scope: "org" },
  "invitation.resend": { scope: "org" },
  "member.remove": { scope: "org" },
  "member.update": { scope: "org" },
  /** The organisation made by scripts/bootstrap-org.ts (it names the first publication, yet is the organisation's). */
  "org.bootstrap": { scope: "org" },
  /** A story's photo: given ({asset}), replaced ({asset, previous}), taken off ({asset}), and its caption or credit
   * changed ({asset}: that it changed, never what it says). */
  "photo.attach": { scope: "publication" },
  "photo.caption_change": { scope: "publication" },
  "photo.credit_change": { scope: "publication" },
  "photo.remove": { scope: "publication" },
  "photo.replace": { scope: "publication" },
  /** Given to someone ({from, to, dueAt}); story.unassign, taken from them ({from, to: null, dueAt});
   * story.due_change, only its due time moved ({from, to}). */
  "story.assign": { scope: "publication" },
  /** Made, typed or pasted ({rev: 1, origin, edition, section, priority, pagePin}). */
  "story.create": { scope: "publication" },
  "story.delete": { scope: "publication" },
  /** The desk note changed (never what it says). */
  "story.desk_note_change": { scope: "publication" },
  "story.due_change": { scope: "publication" },
  /** The fields a change moved, each {from, to}: ids, numbers and language codes. */
  "story.edition_change": { scope: "publication" },
  "story.language_change": { scope: "publication" },
  "story.page_pin_change": { scope: "publication" },
  "story.priority_change": { scope: "publication" },
  /** A saved revision of the text ({rev}), one per save, never its text. */
  "story.revise": { scope: "publication" },
  "story.section_change": { scope: "publication" },
  /** A move ({from, to, comment}): filed, picked up, sent back, ready, held, spiked, restored. */
  "story.status_change": { scope: "publication" },
  "story.unassign": { scope: "publication" },
  /** An upload completed as a picture ({upload, bytes, widthPx, heightPx, mime, existing}), or refused ({upload}). */
  "upload.complete": { scope: "publication" },
  /** An upload asked for, on the upload ({bytes}: the size the quota is charged; never the file's name). */
  "upload.presign": { scope: "publication" },
  "upload.reject": { scope: "publication" },
} as const satisfies Record<string, ActionRule>;

export type AuditAction = keyof typeof AUDIT_ACTIONS;
export const AUDIT_ACTION_NAMES = Object.keys(AUDIT_ACTIONS) as AuditAction[];
/** The publication-level actions: the only ones a Chief Editor is shown (an action not in the catalogue never is). */
export const PUBLICATION_AUDIT_ACTIONS = AUDIT_ACTION_NAMES.filter(
  (action) => AUDIT_ACTIONS[action].scope === "publication",
);

/** An action name, as the table's check allows. */
export const AUDIT_ACTION_PATTERN = /^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/;
/** An action of the catalogue, or a prefix of some ending in a dot ("story.", "invitation."): a misspelt filter is
 * refused, never answered with an empty list. */
const listed = (value: string) =>
  value.endsWith(".")
    ? AUDIT_ACTION_NAMES.some((action) => action.startsWith(value))
    : Object.hasOwn(AUDIT_ACTIONS, value);
const HEX = "[0-9a-fA-F]";
const TARGET = new RegExp(`^[a-z][a-z_]{0,63}(:${HEX}{8}-${HEX}{4}-${HEX}{4}-${HEX}{4}-${HEX}{12})?$`);

const Id = z.uuid();
const Moment = z.iso.datetime({ offset: true });
/** A time to filter by, as Postgres takes it: no year 0, and an offset of at most 15:59 (the ISO form allows both). */
const Bound = Moment.refine((value) => !value.startsWith("0000"), { error: "is before the year 1" }).refine(
  (value) => !/[+-](1[6-9]|2\d):\d\d$/.test(value),
  { error: "has an offset beyond ±15:59" },
);

/** GET …/audit's filters. `action` is one action of the catalogue, or a prefix of some ending in "." (every action
 * starting with it); `target` is a type ("story") or a type and an id ("story:<uuid>"); `from` is inclusive and `to`
 * exclusive; `limit` is written in plain decimal digits. */
export const AuditQuery = z.strictObject({
  actor: Id.optional(),
  action: z
    .string()
    .max(100)
    .refine(listed, { error: "is not an action of the catalogue, or a prefix of some ending in a dot" })
    .optional(),
  target: z.string().max(101).regex(TARGET, { error: "is not a target type, or a type and an id" }).optional(),
  publication: Id.optional(),
  from: Bound.optional(),
  to: Bound.optional(),
  cursor: z.string().max(200).optional(),
  limit: z
    .string()
    .regex(/^[0-9]{1,3}$/, { error: "is not a whole number in decimal digits" })
    .transform(Number)
    .pipe(z.number().min(1).max(200))
    .optional(),
});
export type AuditQuery = z.infer<typeof AuditQuery>;

/** One event. Names come from the organisation's directory when shown (an erased person's is the replaced one);
 * `data` holds ids and small diffs only, never story text. `ip` and `userAgent` are shown to Owner and Admin only. */
export const AuditEvent = z.strictObject({
  id: Id,
  at: Moment,
  /** Who acted; null for the system acting on its own. */
  actor: z.strictObject({ kind: z.enum(["user", "system", "import"]), id: Id, name: z.string().nullable() }).nullable(),
  action: z.string(),
  target: z.strictObject({ type: z.string(), id: Id.nullable() }),
  publicationId: Id.nullable(),
  requestId: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
});
export type AuditEvent = z.infer<typeof AuditEvent>;

export const AuditList = z.strictObject({ items: z.array(AuditEvent), nextCursor: z.string().nullable() });
export type AuditList = z.infer<typeof AuditList>;
