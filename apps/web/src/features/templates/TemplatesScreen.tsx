/**
 * Templates, /org/:orgId/pub/:pubId/templates (doc 04 §7.8; packages/contracts templates.ts): the page template the
 * engine profile in use lays each kind of page out with (front, page 2 with the imprint, inside, back), drawn as the
 * page's outline as the engine reads it, and the pages of the paper's dataset that can serve each (templates.view).
 * Whoever may edit templates (templates.edit) picks another: a new profile version made from the one in use and set up
 * again by the engine, so the next layout uses it (editions keep the version their run used). Also the grid
 * (read-only) and the profile versions, who made each and from what. A live `profile` update, a `resync` or, while one
 * is setting up, a fetch every POLL_MS shows when the engine is done.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import type { TemplateChoiceInput } from "@pageinator/contracts";
import {
  Badge,
  Button,
  EmptyState,
  InlineMessage,
  PageHeader,
  Panel,
  ProgressIndicator,
  Stack,
  Table,
  TableCell,
  TableHeader,
} from "../../ui/index.ts";
import { NoAccess } from "../../app/NoAccess.tsx";
import { ROUTE_HEADING_ID, paths } from "../../app/routes.ts";
import { randomUuid } from "../../api/client.ts";
import { formatDate, formatDateTime } from "../../i18n/dates.ts";
import { useI18n, type Translate } from "../../i18n/index.ts";
import type { ApiProblem, EngineProfileDto } from "../../services/index.ts";
import type { TemplateCandidateDto, TemplatesViewDto } from "../../services/layout-service.ts";
import { OfflineNotice } from "../auth/connection.tsx";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";
import { useSession } from "../auth/SessionProvider.tsx";
import { useLiveEvents } from "../live/live-context.tsx";
import { may } from "../people/navigation.ts";
import { DeskWords } from "../layout/desk-text.tsx";
import { useLayout } from "../layout/layout-context.tsx";
import { POLL_MS } from "../layout/EditionLayoutScreen.tsx";
import { TemplateOutline, TemplateOutlineLegend } from "./TemplateOutline.tsx";
import "../layout/layout.css";
import "./templates.css";

type Load =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly problem: ApiProblem; readonly live: boolean }
  | { readonly status: "ready"; readonly value: TemplatesViewDto };

type Sending =
  | { readonly step: "idle" }
  | { readonly step: "sending"; readonly what: string }
  | { readonly step: "made"; readonly what: string; readonly version: number }
  | { readonly step: "failed"; readonly what: string; readonly problem: ApiProblem };

type Role = TemplatesViewDto["roles"][number]["role"];

export function TemplatesScreen() {
  const { orgId = "", pubId = "" } = useParams<{ orgId: string; pubId: string }>();
  const { state } = useSession();
  const { t } = useI18n();
  const org =
    state.status === "ready"
      ? state.workspace?.organizations.find((candidate) => candidate.org.id === orgId)
      : undefined;
  const publication = org?.publications.find((candidate) => candidate.id === pubId);
  // the API refuses every screen of the organisation until this session has two-step
  const open = !!org && !(org.twoStep.required && !org.twoStep.satisfied);
  return (
    <Stack gap="5" className="pg-layout">
      <PageHeader
        title={t("nav.templates")}
        headingId={ROUTE_HEADING_ID}
        {...(publication ? { subtitle: publication.name } : {})}
      />
      <OfflineNotice />
      {open &&
        (may(org, "templates.view", pubId) ? (
          <TemplatesContent orgId={orgId} pubId={pubId} edit={may(org, "templates.edit", pubId)} />
        ) : (
          <NoAccess />
        ))}
    </Stack>
  );
}

const ROLE_LABEL = {
  front: "templates.role.front",
  inside_imprint: "templates.role.inside_imprint",
  inside: "templates.role.inside",
  back: "templates.role.back",
} as const;
const ROLE_NAME = {
  front: "templates.roleName.front",
  inside_imprint: "templates.roleName.inside_imprint",
  inside: "templates.roleName.inside",
  back: "templates.roleName.back",
} as const;
const roleLabel = (t: Translate, role: string) => (role in ROLE_LABEL ? t(ROLE_LABEL[role as Role]) : role);

function TemplatesContent({
  orgId,
  pubId,
  edit,
}: {
  readonly orgId: string;
  readonly pubId: string;
  readonly edit: boolean;
}) {
  const layout = useLayout();
  const { t } = useI18n();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [sending, setSending] = useState<Sending>({ step: "idle" });
  const ask = useRef(0);
  /** the last choice sent and its Idempotency-Key: a retry of the same choice sends the same key */
  const sent = useRef<{ readonly what: string; readonly key: string } | null>(null);

  const fetchView = useCallback(
    async (live: boolean) => {
      const mine = ++ask.current;
      const result = await layout.getTemplates({ orgId, pubId });
      if (mine !== ask.current) return;
      setLoad(result.ok ? { status: "ready", value: result.value } : { status: "failed", problem: result.error, live });
    },
    [layout, orgId, pubId],
  );
  useEffect(() => {
    setLoad({ status: "loading" });
    void fetchView(false);
  }, [fetchView]);
  useLiveEvents((event) => {
    if ((event.type === "profile" && event.publicationId === pubId) || event.type === "resync") void fetchView(true);
  });
  const settingUp = load.status === "ready" && load.value.settingUp !== null;
  useEffect(() => {
    if (!settingUp) return;
    const timer = setInterval(() => void fetchView(true), POLL_MS);
    return () => clearInterval(timer);
  }, [fetchView, settingUp]);

  const choose = async (choice: TemplateChoiceInput) => {
    if (sending.step === "sending") return;
    const what = JSON.stringify(choice);
    const key = sent.current?.what === what ? sent.current.key : randomUuid();
    sent.current = { what, key };
    setSending({ step: "sending", what });
    const made = await layout.chooseTemplate({ orgId, pubId, choice, idempotencyKey: key });
    if (!made.ok) return setSending({ step: "failed", what, problem: made.error });
    sent.current = null;
    setSending({ step: "made", what, version: made.value.version });
    void fetchView(true);
  };

  if (load.status === "loading") return <ProgressIndicator role="status" label={t("templates.loading")} />;
  if (load.status === "failed") {
    return (
      <Stack gap="3">
        <ProblemMessage problem={load.problem} live={load.live} />
        {!(load.problem.kind === "answer" && load.problem.status === 403) && (
          <div>
            <Button variant="secondary" onClick={() => void fetchView(true)}>
              {t("form.retry")}
            </Button>
          </div>
        )}
      </Stack>
    );
  }
  const view = load.value;
  const newest = view.history[0];
  const failedNewer =
    newest && newest.state === "failed" && (!view.inUse || newest.version > view.inUse.version) ? newest : null;
  const canChoose = edit && !view.settingUp && sending.step !== "sending";
  const feedback = (what: string) =>
    sending.step !== "idle" && sending.what === what ? <SendingNote sending={sending} /> : null;

  return (
    <Stack gap="5">
      <p>{t("templates.lede")}</p>
      {view.settingUp && (
        <div aria-live="polite">
          <InlineMessage
            variant="info"
            heading={t("templates.settingUp", { version: view.settingUp.version })}
            iconLabel={t("message.info")}
          >
            {t("templates.settingUpBody")}
          </InlineMessage>
        </div>
      )}
      {failedNewer && (
        <InlineMessage
          variant="error"
          heading={t("templates.failed", { version: failedNewer.version })}
          iconLabel={t("message.error")}
        >
          {failedNewer.error && <DeskWords text={failedNewer.error.message} />}
          {view.inUse && <> {t("templates.failedKept", { version: view.inUse.version })}</>}
        </InlineMessage>
      )}
      {!view.inUse ? (
        <Panel>
          <EmptyState
            icon="settings"
            heading={t("templates.none")}
            action={<Link to={paths.pubEngineProfile(orgId, pubId)}>{t("templates.noneLink")}</Link>}
          >
            {t("templates.noneBody")}
          </EmptyState>
        </Panel>
      ) : (
        <>
          <p className="pg-layout__note">
            {t("templates.inUse", { version: view.inUse.version })} {t("templates.pinned")}
          </p>
          {!view.candidatesKnown && (
            <InlineMessage variant="info" heading={t("templates.unknown")} iconLabel={t("message.info")}>
              {t("templates.unknownBody")}
            </InlineMessage>
          )}
          {!view.candidatesKnown && edit && (
            <Stack gap="2">
              <div>
                <Button variant="secondary" disabled={!canChoose} onClick={() => void choose({})}>
                  {t("templates.checkAgain")}
                </Button>
              </div>
              {feedback("{}")}
            </Stack>
          )}
          <TemplateOutlineLegend />
          {view.roles.map((role) => (
            <RolePanel
              key={role.role}
              role={role}
              canChoose={canChoose}
              showChoose={edit}
              onChoose={(page) => void choose({ role: role.role, page })}
              feedback={(page) => feedback(JSON.stringify({ role: role.role, page }))}
            />
          ))}
          {view.grid && (
            <Panel title={t("templates.grid")}>
              <Stack gap="2">
                <p>
                  {t("profile.gridValue", {
                    columns: view.grid.columns,
                    width: view.grid.columnMm,
                    gutter: view.grid.gutterMm,
                  })}
                </p>
                <p className="pg-layout__note">{t("templates.gridNote")}</p>
                <p className="pg-layout__note">{t("templates.fixed")}</p>
              </Stack>
            </Panel>
          )}
        </>
      )}
      {view.history.length > 0 && <History items={view.history} />}
    </Stack>
  );
}

function SendingNote({ sending }: { readonly sending: Sending }) {
  const { t } = useI18n();
  return (
    <div aria-live="polite">
      {sending.step === "sending" && <ProgressIndicator label={t("templates.using")} />}
      {sending.step === "made" && <p>{t("templates.made", { version: sending.version })}</p>}
      {sending.step === "failed" && <ProblemMessage problem={sending.problem} live />}
    </div>
  );
}

function RolePanel({
  role,
  canChoose,
  showChoose,
  onChoose,
  feedback,
}: {
  readonly role: TemplatesViewDto["roles"][number];
  readonly canChoose: boolean;
  readonly showChoose: boolean;
  readonly onChoose: (page: string) => void;
  readonly feedback: (page: string) => ReactNode;
}) {
  const { t, language } = useI18n();
  const chosen = role.candidates.find((c) => c.name === role.chosen) ?? null;
  const date = (c: TemplateCandidateDto) => (c.date ? formatDate(c.date, language) : t("templates.undated"));
  return (
    <Panel title={roleLabel(t, role.role)}>
      <div className="pg-templates__role">
        <Stack gap="2">
          <h3 className="pg-layout__subhead">{t("templates.current")}</h3>
          {role.chosen ? (
            <>
              {chosen && <TemplateOutline outline={chosen.outline} name={chosen.name} />}
              <span className="pg-templates__name" lang="en">
                {role.chosen}
              </span>
              {chosen && (
                <p className="pg-templates__meta">
                  {date(chosen)} · {t("templates.page", { page: chosen.page })}
                </p>
              )}
              {chosen && <p className="pg-templates__meta">{t("templates.outline.note")}</p>}
            </>
          ) : (
            <p className="pg-layout__note">{t("templates.noneChosen")}</p>
          )}
        </Stack>
        <Stack gap="2">
          <h3 className="pg-layout__subhead">
            {role.candidates.length
              ? t("templates.choices", { count: role.candidates.length })
              : t("templates.noChoices")}
          </h3>
          {role.candidates.length > 0 && (
            <ul className="pg-templates__choices">
              {role.candidates.map((candidate) => {
                const isChosen = candidate.name === role.chosen;
                return (
                  <li key={candidate.name} className="pg-templates__choice" data-chosen={isChosen}>
                    <TemplateOutline outline={candidate.outline} name={candidate.name} size="small" />
                    <Stack gap="2">
                      <span className="pg-templates__name" lang="en">
                        {candidate.name}
                      </span>
                      <p className="pg-templates__meta">
                        {date(candidate)} · {t("templates.page", { page: candidate.page })}
                      </p>
                      {isChosen ? (
                        <div>
                          <Badge tone="success" icon="circle-check">
                            {t("templates.chosen")}
                          </Badge>
                        </div>
                      ) : (
                        showChoose && (
                          <div>
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={!canChoose}
                              onClick={() => onChoose(candidate.name)}
                            >
                              {t("templates.use", { role: t(ROLE_NAME[role.role]) })}
                            </Button>
                          </div>
                        )
                      )}
                      {feedback(candidate.name)}
                    </Stack>
                  </li>
                );
              })}
            </ul>
          )}
        </Stack>
      </div>
    </Panel>
  );
}

function StateBadge({ profile }: { readonly profile: EngineProfileDto }) {
  const { t } = useI18n();
  if (profile.state === "ready")
    return (
      <Badge tone="success" icon="circle-check">
        {t("profile.state.ready")}
      </Badge>
    );
  if (profile.state === "failed")
    return (
      <Badge tone="danger" icon="circle-x">
        {t("profile.state.failed")}
      </Badge>
    );
  return (
    <Badge tone="info" icon="loader-circle">
      {t("profile.state.setting_up")}
    </Badge>
  );
}

function History({ items }: { readonly items: readonly EngineProfileDto[] }) {
  const { t, language } = useI18n();
  const choice = (item: EngineProfileDto) => {
    if (!item.templateChoice) return "—";
    const entries = Object.entries(item.templateChoice);
    if (entries.length === 0) return t("templates.choiceNone");
    return entries.map(([role, name]) => `${roleLabel(t, role)}: ${name}`).join(" · ");
  };
  return (
    <Panel title={t("templates.history")} flush>
      <Table caption={t("templates.history")}>
        <thead>
          <tr>
            <TableHeader numeric>{t("templates.col.version")}</TableHeader>
            <TableHeader>{t("templates.col.state")}</TableHeader>
            <TableHeader>{t("templates.col.made")}</TableHeader>
            <TableHeader>{t("templates.col.basedOn")}</TableHeader>
            <TableHeader>{t("templates.col.choice")}</TableHeader>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <TableCell numeric>{item.version}</TableCell>
              <TableCell>
                <StateBadge profile={item} />
              </TableCell>
              <TableCell>
                {item.createdBy
                  ? t("templates.madeBy", {
                      name: item.createdBy.name,
                      time: formatDateTime(item.createdAt, language),
                    })
                  : formatDateTime(item.createdAt, language)}
              </TableCell>
              <TableCell>
                {item.basedOn
                  ? t("templates.fromVersion", { version: item.basedOn.version })
                  : t("templates.fromUpload")}
              </TableCell>
              <TableCell>{choice(item)}</TableCell>
            </tr>
          ))}
        </tbody>
      </Table>
    </Panel>
  );
}
