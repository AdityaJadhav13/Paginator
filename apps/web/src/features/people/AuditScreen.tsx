/**
 * The audit log, /org/:orgId/audit (plan §3.4, §5.2 as built; 07 §12 "Audit log"): who did what, when, and to what,
 * newest first, older ones a page at a time. Owner and Admin see the whole organisation's, with the network address
 * and browser; a Chief Editor sees their publications' (the API decides, and leaves the address and browser out).
 * Filters (action, publication, days) live in the address, so reload and Back keep them and a filtered list can be
 * shared; one the address carries that this screen does not know is left out, and said so, never sent to the API.
 * Whoever lacks audit.view is told so, and nothing is asked of the API.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useParams, useSearchParams } from "react-router";
import { AUDIT_ACTION_NAMES, PUBLICATION_AUDIT_ACTIONS, reach, type AuditAction } from "@pageinator/contracts";
import { Button, Field, InlineMessage, ProgressIndicator, Select, Stack, TextInput } from "../../ui/index.ts";
import { ROUTE_HEADING_ID } from "../../app/routes.ts";
import { formatDateTime } from "../../i18n/dates.ts";
import { useI18n, type PlainKey, type Translate } from "../../i18n/index.ts";
import type { ApiProblem, AuditEventDto, AuditFilterDto, OrgAccessDto } from "../../services/index.ts";
import { OfflineNotice } from "../auth/connection.tsx";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";
import { useSession } from "../auth/SessionProvider.tsx";
import { may, orgAccess } from "./navigation.ts";
import { useAudit } from "./services-context.tsx";
import "../auth/auth.css";

/** Each action of AUDIT_ACTIONS by its plain name, `auditLog.action.<action>` (the compiler checks none is missing,
 * and a test that both languages have every one). */
export const AUDIT_ACTION_KEYS = [
  "auditLog.action.access.denied",
  "auditLog.action.asset.fail",
  "auditLog.action.asset.ready",
  "auditLog.action.asset.reject",
  "auditLog.action.comment.create",
  "auditLog.action.comment.edit",
  "auditLog.action.comment.reopen",
  "auditLog.action.comment.resolve",
  "auditLog.action.desk.export",
  "auditLog.action.edition.create",
  "auditLog.action.engine.event_ignore",
  "auditLog.action.engine.event_refuse",
  "auditLog.action.invitation.accept",
  "auditLog.action.invitation.cancel",
  "auditLog.action.invitation.create",
  "auditLog.action.invitation.grants_repaired",
  "auditLog.action.invitation.membership_repaired",
  "auditLog.action.invitation.resend",
  "auditLog.action.member.remove",
  "auditLog.action.member.update",
  "auditLog.action.org.bootstrap",
  "auditLog.action.photo.attach",
  "auditLog.action.photo.caption_change",
  "auditLog.action.photo.credit_change",
  "auditLog.action.photo.remove",
  "auditLog.action.photo.replace",
  "auditLog.action.story.assign",
  "auditLog.action.story.create",
  "auditLog.action.story.delete",
  "auditLog.action.story.desk_note_change",
  "auditLog.action.story.due_change",
  "auditLog.action.story.edition_change",
  "auditLog.action.story.language_change",
  "auditLog.action.story.page_pin_change",
  "auditLog.action.story.priority_change",
  "auditLog.action.story.revise",
  "auditLog.action.story.section_change",
  "auditLog.action.story.status_change",
  "auditLog.action.story.unassign",
  "auditLog.action.upload.complete",
  "auditLog.action.upload.presign",
  "auditLog.action.upload.reject",
] as const satisfies readonly (`auditLog.action.${AuditAction}` & PlainKey)[];
const allNamed: [Exclude<`auditLog.action.${AuditAction}`, (typeof AUDIT_ACTION_KEYS)[number]>] extends [never] ? true : never = true;
void allNamed;

const TARGET_KEYS: Readonly<Record<string, PlainKey>> = {
  story: "auditLog.target.story",
  comment: "auditLog.target.comment",
  asset: "auditLog.target.asset",
  engine_event: "auditLog.target.engine_event",
  upload: "auditLog.target.upload",
  invitation: "auditLog.target.invitation",
  person: "auditLog.target.person",
  organization: "auditLog.target.organization",
  edition: "auditLog.target.edition",
  route: "auditLog.target.route",
};

/** An action's plain name; one of a newer API than this screen is shown by its code. */
export function actionName(action: string, t: Translate): string {
  const key = `auditLog.action.${action}`;
  return (AUDIT_ACTION_KEYS as readonly string[]).includes(key) ? t(key as PlainKey) : t("auditLog.action.unknown", { action });
}

function actorName(actor: AuditEventDto["actor"], t: Translate): string {
  if (actor === null) return t("auditLog.actor.system");
  if (actor.name !== null) return actor.name;
  if (actor.kind === "system") return t("auditLog.actor.system");
  return actor.kind === "import" ? t("auditLog.actor.import") : t("auditLog.actor.unknown");
}

function targetText(target: AuditEventDto["target"], t: Translate): string {
  const type = Object.hasOwn(TARGET_KEYS, target.type) ? t(TARGET_KEYS[target.type]!) : target.type;
  return target.id ? t("auditLog.targetWithId", { target: type, id: target.id }) : type;
}

const PAGE = 50;
/** The pilot reads days in India's time (02 §3.3, as src/i18n/dates.ts shows them). */
const INDIA = "+05:30";

const DAY = /^[1-9]\d{3}-\d{2}-\d{2}$/;

/** A calendar day as an <input type="date"> writes it, from the year 1000 to 9999-12-30 (the API is sent the day
 * after the last one, which must be a four-digit year too). */
export function isDay(value: string): boolean {
  if (!DAY.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value && DAY.test(nextDay(value));
}

function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

interface Filters {
  readonly action?: string;
  readonly publication?: string;
  /** Days, both included. */
  readonly from?: string;
  readonly to?: string;
}

/** The address's filters this screen knows; `ignored` when it carried others. */
export function filtersFrom(
  params: URLSearchParams,
  actions: readonly string[],
  publications: readonly string[],
): { readonly filters: Filters; readonly ignored: boolean } {
  const known = {
    action: (value: string) => actions.includes(value),
    publication: (value: string) => publications.includes(value),
    from: isDay,
    to: isDay,
  } as const;
  const filters: Record<string, string> = {};
  let ignored = false;
  for (const [name, value] of params) {
    if (Object.hasOwn(known, name) && known[name as keyof typeof known](value)) filters[name] = value;
    else ignored = true;
  }
  return { filters, ignored };
}

/** What the API takes: days from midnight in India, the last day included. */
function apiFilter(filters: Filters): AuditFilterDto {
  return {
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.publication ? { publication: filters.publication } : {}),
    ...(filters.from ? { from: `${filters.from}T00:00:00${INDIA}` } : {}),
    ...(filters.to ? { to: `${nextDay(filters.to)}T00:00:00${INDIA}` } : {}),
  };
}

type List =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly problem: ApiProblem }
  | { readonly status: "ready"; readonly items: readonly AuditEventDto[]; readonly nextCursor: string | null };

export function AuditScreen() {
  const { orgId } = useParams<{ orgId: string }>();
  const { state } = useSession();
  const { t } = useI18n();
  const org = state.status === "ready" ? state.workspace?.organizations.find((candidate) => candidate.org.id === orgId) : undefined;
  return (
    <Stack gap="5">
      <h1 id={ROUTE_HEADING_ID} className="pg-type-page-title" tabIndex={-1}>
        {t("nav.audit")}
      </h1>
      <OfflineNotice />
      {!org ? (
        <NoAccess />
      ) : org.twoStep.required && !org.twoStep.satisfied ? null /* the shell says why */ : !may(org, "audit.view") ? (
        <NoAccess />
      ) : (
        <AuditContent org={org} />
      )}
    </Stack>
  );
}

function AuditContent({ org }: { readonly org: OrgAccessDto }) {
  const audit = useAudit();
  const { t, language } = useI18n();
  const orgId = org.org.id;
  const full = reach("audit.view", org.orgRole, orgAccess(org)) === "full";
  const actions: readonly string[] = full ? AUDIT_ACTION_NAMES : PUBLICATION_AUDIT_ACTIONS;
  const publications = full ? org.publications : org.publications.filter((publication) => publication.roles.includes("chief_editor"));
  const [params, setParams] = useSearchParams();
  const search = params.toString();
  const { filters, ignored } = filtersFrom(
    params,
    actions,
    publications.map((publication) => publication.id),
  );
  const asked = JSON.stringify(apiFilter(filters));
  const [list, setList] = useState<List>({ status: "loading" });
  const [more, setMore] = useState<{ pending: boolean; problem: ApiProblem | null }>({ pending: false, problem: null });
  const asking = useRef(0);

  const first = useCallback(async () => {
    const mine = ++asking.current;
    setList({ status: "loading" });
    setMore({ pending: false, problem: null });
    const result = await audit.list({ orgId, ...(JSON.parse(asked) as AuditFilterDto), limit: PAGE });
    if (mine !== asking.current) return;
    setList(result.ok ? { status: "ready", ...result.value } : { status: "failed", problem: result.error });
  }, [asked, audit, orgId]);
  useEffect(() => void first(), [first]);

  const showMore = async () => {
    if (list.status !== "ready" || !list.nextCursor || more.pending) return;
    const mine = asking.current;
    setMore({ pending: true, problem: null });
    const result = await audit.list({ orgId, ...(JSON.parse(asked) as AuditFilterDto), cursor: list.nextCursor, limit: PAGE });
    if (mine !== asking.current) return; // the filters changed meanwhile
    if (!result.ok) return setMore({ pending: false, problem: result.error });
    setMore({ pending: false, problem: null });
    setList({ status: "ready", items: [...list.items, ...result.value.items], nextCursor: result.value.nextCursor });
  };

  const publicationName = (id: string | null) => (id ? org.publications.find((publication) => publication.id === id)?.name : undefined);
  const filtered = Object.keys(filters).length > 0;

  return (
    <Stack gap="5">
      <p>{t("auditLog.intro")}</p>
      {!full && <p>{t("auditLog.scoped")}</p>}
      <FilterForm
        key={search}
        filters={filters}
        actions={actions}
        publications={publications.length > 1 ? publications : []}
        onApply={(next) => setParams(new URLSearchParams(Object.entries(next).filter(([, value]) => value !== "")))}
        onClear={filtered || ignored ? () => setParams(new URLSearchParams()) : undefined}
      />
      {ignored && (
        <InlineMessage variant="warning" heading={t("auditLog.filter.ignored")} iconLabel={t("message.warning")} />
      )}
      <section aria-labelledby="pg-audit-events">
        <Stack gap="4">
          <h2 id="pg-audit-events" className="pg-type-section-title">
            {t("auditLog.events")}
          </h2>
          {list.status === "loading" && <ProgressIndicator role="status" label={t("auditLog.loading")} />}
          {list.status === "failed" && (
            <Stack gap="3">
              <ProblemMessage problem={list.problem} live={false} />
              <div>
                <Button variant="secondary" onClick={() => void first()}>
                  {t("form.retry")}
                </Button>
              </div>
            </Stack>
          )}
          {list.status === "ready" && list.items.length === 0 && <p>{filtered ? t("auditLog.noMatch") : t("auditLog.none")}</p>}
          {list.status === "ready" && list.items.length > 0 && (
            <ul className="pg-list" aria-labelledby="pg-audit-events">
              {list.items.map((event) => {
                const publication = publicationName(event.publicationId);
                return (
                  <li key={event.id} className="pg-list__item">
                    <p className="pg-type-body">
                      <strong>{actionName(event.action, t)}</strong>
                    </p>
                    <dl className="pg-facts pg-type-body-small">
                      <div>
                        <dt>{t("auditLog.who")}</dt>
                        <dd>{actorName(event.actor, t)}</dd>
                      </div>
                      <div>
                        <dt>{t("auditLog.when")}</dt>
                        <dd>
                          <time dateTime={event.at}>{formatDateTime(event.at, language)}</time>
                        </dd>
                      </div>
                      <div>
                        <dt>{t("auditLog.about")}</dt>
                        <dd>{targetText(event.target, t)}</dd>
                      </div>
                      {publication && (
                        <div>
                          <dt>{t("auditLog.publication")}</dt>
                          <dd>{publication}</dd>
                        </div>
                      )}
                      {event.ip !== null && (
                        <div>
                          <dt>{t("auditLog.ip")}</dt>
                          <dd>{event.ip}</dd>
                        </div>
                      )}
                      {event.userAgent !== null && (
                        <div>
                          <dt>{t("auditLog.userAgent")}</dt>
                          <dd>{event.userAgent}</dd>
                        </div>
                      )}
                    </dl>
                  </li>
                );
              })}
            </ul>
          )}
          {list.status === "ready" && list.nextCursor && (
            <Stack gap="3">
              {more.problem && <ProblemMessage problem={more.problem} />}
              <div>
                <Button variant="secondary" disabled={more.pending} aria-busy={more.pending} onClick={() => void showMore()}>
                  {more.pending ? t("auditLog.loadingMore") : t("auditLog.more")}
                </Button>
              </div>
            </Stack>
          )}
        </Stack>
      </section>
    </Stack>
  );
}

/** The filters being chosen; applied to the address (a new history entry) only when the person asks. */
function FilterForm({
  filters,
  actions,
  publications,
  onApply,
  onClear,
}: {
  readonly filters: Filters;
  readonly actions: readonly string[];
  /** Offered only when there is more than one to choose from. */
  readonly publications: readonly { readonly id: string; readonly name: string }[];
  readonly onApply: (filters: Record<string, string>) => void;
  readonly onClear: (() => void) | undefined;
}) {
  const { t } = useI18n();
  const [action, setAction] = useState(filters.action ?? "");
  const [publication, setPublication] = useState(filters.publication ?? "");
  const [from, setFrom] = useState(filters.from ?? "");
  const [to, setTo] = useState(filters.to ?? "");
  const [checked, setChecked] = useState(false);
  // an empty day is no filter; a day the API cannot be asked about (a five-digit year) is said, never dropped
  const dayErrors = (day: string) => (checked && day !== "" && !isDay(day) ? [t("auditLog.filter.notDay")] : []);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setChecked(true);
    if ((from !== "" && !isDay(from)) || (to !== "" && !isDay(to))) return;
    onApply({ action, publication, from, to });
  };
  return (
    <form className="pg-filters" onSubmit={submit} role="search" aria-label={t("auditLog.filters")}>
      <Field label={t("auditLog.filter.action")}>
        <Select value={action} onChange={(event) => setAction(event.target.value)}>
          <option value="">{t("auditLog.filter.anyAction")}</option>
          {actions.map((name) => (
            <option key={name} value={name}>
              {actionName(name, t)}
            </option>
          ))}
        </Select>
      </Field>
      {publications.length > 0 && (
        <Field label={t("auditLog.filter.publication")}>
          <Select value={publication} onChange={(event) => setPublication(event.target.value)}>
            <option value="">{t("auditLog.filter.anyPublication")}</option>
            {publications.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label={t("auditLog.filter.from")} errors={dayErrors(from)}>
        <TextInput type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} />
      </Field>
      <Field label={t("auditLog.filter.to")} errors={dayErrors(to)}>
        <TextInput type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} />
      </Field>
      <Button type="submit" variant="secondary">
        {t("auditLog.filter.apply")}
      </Button>
      {onClear && (
        <Button variant="quiet" onClick={onClear}>
          {t("auditLog.filter.clear")}
        </Button>
      )}
    </form>
  );
}

function NoAccess() {
  const { t } = useI18n();
  return (
    <InlineMessage variant="info" heading={t("auditLog.noAccess.heading")} iconLabel={t("message.info")}>
      {t("auditLog.noAccess.body")}
    </InlineMessage>
  );
}
