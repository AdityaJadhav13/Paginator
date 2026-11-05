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
  /** A Word file's import asked for ({upload, bytes, edition}); done ({job, created, skipped}: the stories made, each
   * also recorded as story.create by the importer) or failed ({job, code}: the Desk refused the file, or the job
   * failed), from the engine's inbox (actor: the system). */
  "import.create": { scope: "publication" },
  "import.done": { scope: "publication" },
  "import.fail": { scope: "publication" },
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
  /** "We have the right to print this" ticked on a found photo ({label}, and {draft} when ticked with its choice). */
  "asset.rights_confirm": { scope: "publication" },
  /** An edition made ({date, pages}); a story put in or taken out of one is story.edition_change. */
  "edition.create": { scope: "publication" },
  /** Its folio changed ({volume?, issue?, price?}: the fields changed, as they are now). */
  "edition.edit": { scope: "publication" },
  /** A story bundle sent to the Desk, on its edition ({bundle, stories, photos}). */
  "desk.export": { scope: "publication" },
  /** The one-time import of the Desk's home (apps/api/scripts/import-desk.ts; actor kind "import", the person who ran
   * it): an edition, a story, a picture (photo or ad artwork), an ad slot's artwork and a layout run imported (ids,
   * Desk keys and counts only), and the import's summary ({bundle sha256, counts}). */
  "desk_import.edition": { scope: "publication" },
  "desk_import.story": { scope: "publication" },
  "desk_import.asset": { scope: "publication" },
  "desk_import.ad_slot": { scope: "publication" },
  "desk_import.run": { scope: "publication" },
  "desk_import.done": { scope: "publication" },
  /** An engine profile asked for from a dataset bundle ({upload, bytes, version}); set up by the engine ({job,
   * engineVersion}) or not ({job, code}), from the engine's inbox (actor: the system). */
  "engine_profile.create": { scope: "publication" },
  "engine_profile.fail": { scope: "publication" },
  "engine_profile.ready": { scope: "publication" },
  /** A layout run asked for ({run, deskKey, stories, ads, profile}); cancelled ({run, from}); done ({job, pages,
   * failed, notPlaced, placed, unplaced}) or failed ({job, code}), from the engine's inbox or the sweep (actor: the
   * system). A story the done run placed (or no longer places) is also story.status_change by the system. */
  "layout.run_cancel": { scope: "publication" },
  "layout.run_create": { scope: "publication" },
  "layout.run_done": { scope: "publication" },
  "layout.run_fail": { scope: "publication" },
  /** A back-page ad slot given a picture of the media library ({slot, asset}), or emptied ({slot}). */
  "ad_slot.clear": { scope: "publication" },
  "ad_slot.set": { scope: "publication" },
  /** A page saved in the page editor ({run, page, rev}, recorded with the save itself; its independent check is the
   * page's history); a page's soft lock taken over by the person who asked for it ({run, page, from}) (L2.4). */
  "editor.page_save": { scope: "publication" },
  "editor.page_takeover": { scope: "publication" },
  /** Release (L2.5): a page approved on its revision and bytes ({run, page, rev, pdfSha256}) or unlocked ({run, page});
   * a release approved and archived ({release, edition, number, kind, files}); a delivery marked as sent ({release,
   * delivery, files}) and the press's confirmation recorded ({release, delivery}); the archive read back and hashed
   * ({release, ok}); the G2 press test recorded ({pageSha256, acceptedOn}). */
  "page.approve": { scope: "publication" },
  "page.unlock": { scope: "publication" },
  "release.create": { scope: "publication" },
  "release.send": { scope: "publication" },
  "release.confirm": { scope: "publication" },
  "release.verify": { scope: "publication" },
  "press_test.set": { scope: "publication" },
  /** The ads desk (L2.6): an advertiser made or changed ({fields}); a booking made ({advertiser, dates, slot}),
   * changed ({fields}) or given artwork ({asset, passed}, or {asset: null} when taken off); a booking placed in an
   * edition's slot ({edition, slot, booking, replaced}) or taken out ({edition, slot, booking}); a plan page's section
   * or note set ({edition, page}); a plan copied ({edition, from, pages, placements}); the cut-off settings changed;
   * the missing-artwork alert at cut-off ({date, bookings, told}; actor: the system). */
  "advertiser.create": { scope: "publication" },
  "advertiser.edit": { scope: "publication" },
  "ad_booking.create": { scope: "publication" },
  "ad_booking.edit": { scope: "publication" },
  "ad_booking.artwork": { scope: "publication" },
  "ad_placement.set": { scope: "publication" },
  "ad_placement.clear": { scope: "publication" },
  "plan.page": { scope: "publication" },
  "plan.copy": { scope: "publication" },
  "ad_settings.set": { scope: "publication" },
  "ad_cutoff.alert": { scope: "publication" },
  /** The five sidebar screens: a new engine profile made from the one in use with another page as a role's template
   * ({profile, basedOn, version, role, page}); the publication's name or the edition defaults changed ({fields});
   * a print profile saved as a new version ({profile, version}). */
  "engine_profile.retemplate": { scope: "publication" },
  "brand.set": { scope: "publication" },
  "print_profile.create": { scope: "publication" },
  /** A section made ({name}), or renamed, moved, archived or brought back ({fields}: which changed). */
  "section.create": { scope: "publication" },
  "section.edit": { scope: "publication" },
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
  /** The news finder (docs/product/13-news-finder.md): a collection stored, from the engine's inbox (actor: the system;
   * {job, items, topics, ai}: how many items and topics it added, the AI state; or {job, code}: its job failed). */
  "news.collect": { scope: "publication" },
  /** A draft made ({job, story, flagged, photos}: counts) or failed ({job, code}), from the engine's inbox (actor: the
   * system); the story is also recorded as story.create by the editor who picked the topic. */
  "news.draft_done": { scope: "publication" },
  "news.draft_fail": { scope: "publication" },
  /** A topic picked for a draft ({topic, language, length, findPhoto}). */
  "news.pick": { scope: "publication" },
  /** A found photo chosen for the draft's story ({asset, index, label, origin}); the story's photo.attach follows. */
  "news.photo_choose": { scope: "publication" },
  /** The house style or the interval changed ({fields}: which, never the style's text). */
  "news.settings_edit": { scope: "publication" },
  /** A source added ({language, enabled}), changed ({fields}) or removed. */
  "news.source_create": { scope: "publication" },
  "news.source_delete": { scope: "publication" },
  "news.source_edit": { scope: "publication" },
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
  /** A move ({from, to, comment}): filed, picked up, sent back, ready, held, spiked, restored; and the system's
   * Placed and back to Ready after a done layout run ({from, to, run}, actor: the system). */
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
