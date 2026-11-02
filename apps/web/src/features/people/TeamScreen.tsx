/**
 * Team, /org/:orgId/team (07 §Team and §12; plan §10 PR 20): the organisation's members, and, for the Owner and the
 * Admins, the pending invitations and the changes: invite someone (an organisation role, roles on each publication,
 * and the grants only where @pageinator/contracts' GRANT_HOLDERS allows them), send an invitation again or cancel it,
 * change a member's roles, remove a member. The Chief Editor sees the members only. The API decides every one of
 * these again; this page only leaves out what it would refuse.
 */
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useParams } from "react-router";
import {
  GRANT_HOLDERS,
  GRANTS,
  PUBLICATION_ROLES,
  type Grant,
  type PublicationRole,
} from "@pageinator/contracts";
import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  Cluster,
  Dialog,
  EmptyState,
  Field,
  InlineMessage,
  MenuButton,
  MenuItem,
  MenuSeparator,
  PageHeader,
  Panel,
  ProgressIndicator,
  RadioGroup,
  Stack,
  Table,
  TableCell,
  TableHeader,
  TextInput,
  type BadgeTone,
} from "../../ui/index.ts";
import { ROUTE_HEADING_ID } from "../../app/routes.ts";
import { randomUuid } from "../../api/client.ts";
import { formatDate, formatDateTime } from "../../i18n/dates.ts";
import { useI18n } from "../../i18n/index.ts";
import type {
  ApiProblem,
  InvitationDetailDto,
  MemberDto,
  OrgAccessDto,
} from "../../services/index.ts";
import { OfflineNotice } from "../auth/connection.tsx";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";
import { useSession } from "../auth/SessionProvider.tsx";
import { emailProblem } from "../auth/validation.ts";
import { may } from "./navigation.ts";
import { grantName, roleName, rolesAndGrants } from "./roles.ts";
import { useTeam } from "./services-context.tsx";
import { TwoStepNeeded } from "./TwoStepNeeded.tsx";
import "../auth/auth.css";
import "./people.css";

type Grants = MemberDto["publications"];
type OrgChoice = "admin" | "member";

/** The roles being chosen: an organisation role, and each publication's roles and grants. */
interface Choice {
  readonly orgRole: OrgChoice;
  readonly publications: Readonly<Record<string, { readonly roles: readonly PublicationRole[]; readonly grants: readonly Grant[] }>>;
}

/** A grant may be ticked only while one of the roles allowed to hold it is ticked. */
function grantAllowed(grant: Grant, roles: readonly PublicationRole[]): boolean {
  return GRANT_HOLDERS[grant].some((holder) => roles.includes(holder));
}

function choiceFrom(orgRole: OrgChoice, grants: Grants): Choice {
  return {
    orgRole,
    publications: Object.fromEntries(
      grants.map((grant) => [grant.publicationId, { roles: [...grant.roles], grants: [...grant.grants] }]),
    ),
  };
}

/** What the API takes: the publications with at least one role, and only the grants their roles may hold. */
function grantsOfChoice(choice: Choice): Grants {
  return Object.entries(choice.publications)
    .filter(([, publication]) => publication.roles.length > 0)
    .map(([publicationId, publication]) => ({
      publicationId,
      roles: [...publication.roles],
      grants: publication.grants.filter((grant) => grantAllowed(grant, publication.roles)),
    }));
}

function RoleEditor({
  org,
  choice,
  onChange,
}: {
  readonly org: OrgAccessDto;
  readonly choice: Choice;
  readonly onChange: (choice: Choice) => void;
}) {
  const { t } = useI18n();
  const grantsHint = useId();
  const toggle = (publicationId: string, kind: "roles" | "grants", value: string, on: boolean) => {
    const current = choice.publications[publicationId] ?? { roles: [], grants: [] };
    const list = current[kind] as readonly string[];
    const next = on ? [...list, value] : list.filter((item) => item !== value);
    const updated = { ...current, [kind]: next };
    // a grant whose last holder was unticked goes with it
    const fitted = { roles: updated.roles, grants: updated.grants.filter((grant) => grantAllowed(grant, updated.roles)) };
    onChange({ ...choice, publications: { ...choice.publications, [publicationId]: fitted } });
  };
  return (
    <Stack gap="4">
      <div>
        <RadioGroup
          legend={t("team.orgRole.legend")}
          value={choice.orgRole}
          onChange={(value) => onChange({ ...choice, orgRole: value as OrgChoice })}
          options={[
            { value: "member", label: t("role.member") },
            { value: "admin", label: t("role.admin") },
          ]}
        />
        <p className="pg-type-body-small pg-auth__hint">{t("team.orgRole.hint")}</p>
      </div>
      {org.publications.map((publication) => {
        const current = choice.publications[publication.id] ?? { roles: [], grants: [] };
        const grants = GRANTS.filter((grant) => grantAllowed(grant, current.roles));
        return (
          <fieldset key={publication.id} className="pg-radio-group pg-people-roles">
            <legend className="pg-radio-group__legend">{t("team.publication.legend", { publication: publication.name })}</legend>
            <div className="pg-people-roles__grid">
              {PUBLICATION_ROLES.map((role) => (
                <Checkbox
                  key={role}
                  label={roleName(role, t)}
                  checked={current.roles.includes(role)}
                  onChange={(event) => toggle(publication.id, "roles", role, event.target.checked)}
                />
              ))}
            </div>
            {grants.length > 0 && (
              <div>
                <p id={`${grantsHint}-${publication.id}`} className="pg-type-body-small pg-auth__hint">
                  {t("team.grants.hint")}
                </p>
                <div className="pg-people-roles__grid">
                  {grants.map((grant) => (
                    <Checkbox
                      key={grant}
                      label={grantName(grant, t)}
                      aria-describedby={`${grantsHint}-${publication.id}`}
                      checked={current.grants.includes(grant)}
                      onChange={(event) => toggle(publication.id, "grants", grant, event.target.checked)}
                    />
                  ))}
                </div>
              </div>
            )}
          </fieldset>
        );
      })}
    </Stack>
  );
}

function InviteDialog({
  org,
  open,
  onClose,
  onSent,
}: {
  readonly org: OrgAccessDto;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSent: (invitation: InvitationDetailDto) => void;
}) {
  const team = useTeam();
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [choice, setChoice] = useState<Choice>({ orgRole: "member", publications: {} });
  const [emailError, setEmailError] = useState<string | undefined>();
  const [roleError, setRoleError] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [pending, setPending] = useState(false);
  /** One key per invitation being sent: a retry of the same one never sends two. */
  const key = useRef<string | null>(null);
  const emailField = useRef<HTMLInputElement>(null);

  const reset = () => {
    setEmail("");
    setChoice({ orgRole: "member", publications: {} });
    setEmailError(undefined);
    setRoleError(false);
    setProblem(null);
    key.current = null;
  };
  const change = (next: Choice) => {
    key.current = null;
    setRoleError(false);
    setChoice(next);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setProblem(null);
    const address = email.trim();
    const invalid = emailProblem(address);
    setEmailError(invalid ? t(invalid) : undefined);
    const publications = grantsOfChoice(choice);
    const noRole = choice.orgRole === "member" && publications.length === 0;
    setRoleError(noRole);
    if (invalid) return emailField.current?.focus();
    if (noRole) return;
    key.current ??= randomUuid();
    setPending(true);
    const result = await team.invite({
      orgId: org.org.id,
      invitation: { email: address, orgRole: choice.orgRole, publications },
      idempotencyKey: key.current,
    });
    setPending(false);
    if (result.ok) {
      reset();
      onSent(result.value);
      return;
    }
    const error = result.error;
    if (error.kind === "answer" && error.details?.some((detail) => detail.field === "body.email")) {
      const taken = error.details.some((detail) => detail.message === "is already a member");
      key.current = null;
      setEmailError(taken ? t("team.invite.alreadyMember", { email: address }) : t("validation.emailInvalid"));
      return emailField.current?.focus();
    }
    setProblem(error);
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={t("team.invite.title", { organization: org.org.name })}
      closeLabel={t("shell.closeDialog")}
      dismissible={!pending}
    >
      <form noValidate onSubmit={submit} aria-busy={pending}>
        <Stack gap="4">
          {problem && <ProblemMessage problem={problem} />}
          <Field label={t("form.email")} errors={emailError ? [emailError] : []}>
            <TextInput
              ref={emailField}
              type="email"
              name="email"
              autoComplete="off"
              spellCheck={false}
              value={email}
              onChange={(event) => {
                key.current = null;
                setEmail(event.target.value);
              }}
            />
          </Field>
          <RoleEditor org={org} choice={choice} onChange={change} />
          {roleError && (
            <InlineMessage variant="error" heading={t("team.invite.needRole")} live iconLabel={t("message.error")} />
          )}
          <Cluster gap="3" className="pg-people-dialog__footer">
            <Button type="submit">{pending ? t("team.invite.sending") : t("team.invite.submit")}</Button>
            <Button
              variant="secondary"
              onClick={() => {
                reset();
                onClose();
              }}
            >
              {t("security.cancel")}
            </Button>
          </Cluster>
        </Stack>
      </form>
    </Dialog>
  );
}

function RolesDialog({
  org,
  member,
  onClose,
  onSaved,
}: {
  readonly org: OrgAccessDto;
  readonly member: MemberDto | null;
  readonly onClose: () => void;
  readonly onSaved: (member: MemberDto) => void;
}) {
  const team = useTeam();
  const { t } = useI18n();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [roleError, setRoleError] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    setProblem(null);
    setRoleError(false);
    setChoice(member ? choiceFrom(member.orgRole === "admin" ? "admin" : "member", member.publications) : null);
  }, [member]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || !member || !choice) return;
    setProblem(null);
    const publications = grantsOfChoice(choice);
    const noRole = choice.orgRole === "member" && publications.length === 0;
    setRoleError(noRole);
    if (noRole) return;
    setPending(true);
    const result = await team.updateMember({
      orgId: org.org.id,
      userId: member.userId,
      patch: { orgRole: choice.orgRole, publications },
    });
    setPending(false);
    if (result.ok) onSaved(result.value);
    else setProblem(result.error);
  };

  return (
    <Dialog
      open={member !== null}
      onClose={onClose}
      title={member ? t("team.changeRoles", { name: member.name }) : ""}
      closeLabel={t("shell.closeDialog")}
      dismissible={!pending}
    >
      {member && choice && (
        <form noValidate onSubmit={submit} aria-busy={pending}>
          <Stack gap="4">
            {problem && <ProblemMessage problem={problem} />}
            <RoleEditor org={org} choice={choice} onChange={(next) => (setRoleError(false), setChoice(next))} />
            {roleError && (
              <InlineMessage variant="error" heading={t("team.invite.needRole")} live iconLabel={t("message.error")} />
            )}
            <Cluster gap="3" className="pg-people-dialog__footer">
              <Button type="submit">{pending ? t("team.saving") : t("team.save")}</Button>
              <Button variant="secondary" onClick={onClose}>
                {t("security.cancel")}
              </Button>
            </Cluster>
          </Stack>
        </form>
      )}
    </Dialog>
  );
}

function RemoveDialog({
  org,
  member,
  onClose,
  onRemoved,
}: {
  readonly org: OrgAccessDto;
  readonly member: MemberDto | null;
  readonly onClose: () => void;
  readonly onRemoved: (member: MemberDto) => void;
}) {
  const team = useTeam();
  const { t } = useI18n();
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => setProblem(null), [member]);
  const remove = async () => {
    if (pending || !member) return;
    setProblem(null);
    setPending(true);
    const result = await team.removeMember({ orgId: org.org.id, userId: member.userId });
    setPending(false);
    if (result.ok) onRemoved(member);
    else setProblem(result.error);
  };
  return (
    <Dialog
      open={member !== null}
      onClose={onClose}
      title={member ? t("team.remove.title", { name: member.name }) : ""}
      closeLabel={t("shell.closeDialog")}
      dismissible={!pending}
    >
      {member && (
        <Stack gap="4">
          <p>{t("team.remove.body", { name: member.name, organization: org.org.name })}</p>
          {problem && <ProblemMessage problem={problem} />}
          <Cluster gap="3" className="pg-people-dialog__footer">
            <Button variant="danger" onClick={() => void remove()}>
              {t("team.remove.confirm")}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              {t("security.cancel")}
            </Button>
          </Cluster>
        </Stack>
      )}
    </Dialog>
  );
}

/** "Pune Daily: Editor and Can approve pages", for each publication of a member or an invitation. */
function PublicationRoles({ org, grants }: { readonly org: OrgAccessDto; readonly grants: Grants }) {
  const { t, language } = useI18n();
  const names = new Map(org.publications.map((publication) => [publication.id, publication.name]));
  if (grants.length === 0) return null;
  return (
    <ul className="pg-people-pubroles">
      {grants.map((grant) => (
        <li key={grant.publicationId}>
          {t("orgHome.publicationRoles", {
            publication: names.get(grant.publicationId) ?? grant.publicationId,
            roles: rolesAndGrants(grant, language, t),
          })}
        </li>
      ))}
    </ul>
  );
}

type Load =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly problem: ApiProblem; readonly live: boolean }
  | {
      readonly status: "ready";
      readonly members: readonly MemberDto[];
      readonly invitations: readonly InvitationDetailDto[];
    };

function TeamContent({ org }: { readonly org: OrgAccessDto }) {
  const team = useTeam();
  const { state } = useSession();
  const { t, language } = useI18n();
  const manage = may(org, "members.manage");
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [notice, setNotice] = useState<string | null>(null);
  const [actionProblem, setActionProblem] = useState<ApiProblem | null>(null);
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<MemberDto | null>(null);
  const [removing, setRemoving] = useState<MemberDto | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const focusHeading = useRef(false);
  const me = state.status === "ready" ? state.session.user.id : "";
  const orgId = org.org.id;

  const fetchAll = useCallback(
    async (live: boolean) => {
      const [members, invitations] = await Promise.all([
        team.listMembers({ orgId }),
        manage ? team.listInvitations({ orgId }) : Promise.resolve({ ok: true as const, value: [] }),
      ]);
      if (!members.ok) return setLoad({ status: "failed", problem: members.error, live });
      if (!invitations.ok) return setLoad({ status: "failed", problem: invitations.error, live });
      setLoad({
        status: "ready",
        members: members.value.filter((member) => member.status === "active"),
        invitations: invitations.value.filter((invitation) => invitation.state === "pending"),
      });
    },
    [manage, orgId, team],
  );
  useEffect(() => {
    setLoad({ status: "loading" });
    void fetchAll(false);
  }, [fetchAll]);

  // After a removal the row and its menu button are gone: put focus on the page heading once the list is back.
  useEffect(() => {
    if (!focusHeading.current) return;
    focusHeading.current = false;
    document.getElementById(ROUTE_HEADING_ID)?.focus();
  }, [load]);

  const said = (text: string) => {
    setActionProblem(null);
    setNotice(text);
    void fetchAll(true);
  };

  const pendingAction = async (invitation: InvitationDetailDto, action: "resend" | "cancel") => {
    if (busy) return;
    setNotice(null);
    setActionProblem(null);
    setBusy(invitation.id);
    const result =
      action === "resend"
        ? await team.resendInvitation({ orgId, id: invitation.id })
        : await team.cancelInvitation({ orgId, id: invitation.id });
    setBusy(null);
    if (!result.ok) return setActionProblem(result.error);
    said(
      action === "resend"
        ? t("team.pending.resent", { email: invitation.email })
        : t("team.pending.cancelled", { email: invitation.email }),
    );
  };

  const header = (
    <>
      <TeamHeader
        actions={
          manage && load.status === "ready" ? (
            <Button onClick={() => setInviting(true)}>{t("team.invite")}</Button>
          ) : undefined
        }
      />
      <OfflineNotice />
    </>
  );

  if (load.status === "loading")
    return (
      <>
        {header}
        <ProgressIndicator role="status" label={t("team.loading")} />
      </>
    );
  if (load.status === "failed") {
    const { problem } = load;
    const code = problem.kind === "answer" ? problem.code : "";
    return (
      <>
        {header}
        {code === "two_step_required" ? (
          <TwoStepNeeded org={org} />
        ) : code === "not_allowed" || code === "not_found" ? (
          <NoAccess />
        ) : (
          <Stack gap="4">
            <ProblemMessage problem={problem} live={load.live} />
            <div>
              <Button variant="secondary" onClick={() => void fetchAll(true)}>
                {t("form.retry")}
              </Button>
            </div>
          </Stack>
        )}
      </>
    );
  }

  return (
    <>
      {header}
      <div aria-live="polite">{notice && <InlineMessage variant="success" heading={notice} iconLabel={t("message.success")} />}</div>
      {actionProblem && <ProblemMessage problem={actionProblem} />}

      <Panel title={t("team.members.heading")} flush>
        <Table caption={t("team.members.heading")} className="pg-people-menu-table">
          <thead>
            <tr>
              <TableHeader>{t("team.col.name")}</TableHeader>
              <TableHeader>{t("team.orgRole.legend")}</TableHeader>
              <TableHeader>{t("team.col.publications")}</TableHeader>
              <TableHeader>{t("team.col.lastActive")}</TableHeader>
              {manage && (
                <TableHeader className="pg-people-table__actions">
                  <span className="pg-visually-hidden">{t("team.col.actions")}</span>
                </TableHeader>
              )}
            </tr>
          </thead>
          <tbody>
            {load.members.map((member) => {
              const changeable = manage && member.orgRole !== "owner" && member.userId !== me;
              return (
                <tr key={member.userId}>
                  <TableCell>
                    <Person name={member.name} detail={member.email} you={member.userId === me} />
                  </TableCell>
                  <TableCell>
                    <OrgRoleBadge role={member.orgRole} />
                  </TableCell>
                  <TableCell>
                    <PublicationRoles org={org} grants={member.publications} />
                  </TableCell>
                  <TableCell className="pg-people-table__muted">
                    {member.lastActiveAt ? formatDateTime(member.lastActiveAt, language) : t("team.member.neverActive")}
                  </TableCell>
                  {manage && (
                    <TableCell className="pg-people-table__actions">
                      {changeable && (
                        <MenuButton label={t("team.row.actions", { name: member.name })} icon="ellipsis" iconOnly align="end">
                          <MenuItem icon="pencil" onSelect={() => setEditing(member)}>
                            {t("team.row.changeRoles")}
                          </MenuItem>
                          <MenuSeparator />
                          <MenuItem icon="x" danger onSelect={() => setRemoving(member)}>
                            {t("team.remove.confirm")}
                          </MenuItem>
                        </MenuButton>
                      )}
                    </TableCell>
                  )}
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Panel>

      {manage && (
        <Panel title={t("team.pending.heading")} flush>
          {load.invitations.length === 0 ? (
            <EmptyState icon="send" heading={t("team.pending.none")} headingLevel={3} />
          ) : (
            <Table caption={t("team.pending.heading")} className="pg-people-menu-table">
              <thead>
                <tr>
                  <TableHeader>{t("form.email")}</TableHeader>
                  <TableHeader>{t("team.orgRole.legend")}</TableHeader>
                  <TableHeader>{t("team.col.publications")}</TableHeader>
                  <TableHeader className="pg-people-table__actions">
                    <span className="pg-visually-hidden">{t("team.col.actions")}</span>
                  </TableHeader>
                </tr>
              </thead>
              <tbody>
                {load.invitations.map((invitation) => (
                  <tr key={invitation.id} aria-busy={busy === invitation.id || undefined}>
                    <TableCell>
                      <Person
                        name={invitation.email}
                        detail={t("team.pending.expires", { date: formatDate(invitation.expiresAt, language) })}
                      />
                    </TableCell>
                    <TableCell>
                      <OrgRoleBadge role={invitation.orgRole} />
                    </TableCell>
                    <TableCell>
                      <PublicationRoles org={org} grants={invitation.publications} />
                    </TableCell>
                    <TableCell className="pg-people-table__actions">
                      <MenuButton
                        label={t("team.pending.row.actions", { email: invitation.email })}
                        icon="ellipsis"
                        iconOnly
                        align="end"
                      >
                        <MenuItem icon="send" disabled={busy !== null} onSelect={() => void pendingAction(invitation, "resend")}>
                          {t("team.pending.row.resend")}
                        </MenuItem>
                        <MenuSeparator />
                        <MenuItem
                          icon="x"
                          danger
                          disabled={busy !== null}
                          onSelect={() => void pendingAction(invitation, "cancel")}
                        >
                          {t("team.pending.row.cancel")}
                        </MenuItem>
                      </MenuButton>
                    </TableCell>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      )}

      {manage && (
        <>
          <InviteDialog
            org={org}
            open={inviting}
            onClose={() => setInviting(false)}
            onSent={(invitation) => {
              setInviting(false);
              said(t("team.invite.sent", { email: invitation.email }));
            }}
          />
          <RolesDialog
            org={org}
            member={editing}
            onClose={() => setEditing(null)}
            onSaved={(member) => {
              setEditing(null);
              said(t("team.saved", { name: member.name }));
            }}
          />
          <RemoveDialog
            org={org}
            member={removing}
            onClose={() => setRemoving(null)}
            onRemoved={(member) => {
              setRemoving(null);
              focusHeading.current = true;
              said(t("team.removed", { name: member.name }));
            }}
          />
        </>
      )}
    </>
  );
}

/** A person (or an invited address) as the first cell: initials, the name in bold, a second line. */
function Person({ name, detail, you = false }: { readonly name: string; readonly detail?: string; readonly you?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="pg-people-person">
      <Avatar name={name} size="sm" decorative />
      <div className="pg-people-person__text">
        <span className="pg-people-person__name">
          <strong>{name}</strong>
          {you && <Badge tone="info">{t("team.member.youBadge")}</Badge>}
        </span>
        {detail && <span className="pg-people-person__detail">{detail}</span>}
      </div>
    </div>
  );
}

const ROLE_TONES: Readonly<Record<string, BadgeTone>> = { owner: "accent", admin: "info" };

function OrgRoleBadge({ role }: { readonly role: string }) {
  const { t } = useI18n();
  return <Badge tone={ROLE_TONES[role] ?? "neutral"}>{roleName(role, t)}</Badge>;
}

function TeamHeader({ actions }: { readonly actions?: ReactNode }) {
  const { t } = useI18n();
  return <PageHeader title={t("glossary.team")} headingId={ROUTE_HEADING_ID} actions={actions} />;
}

function NoAccess() {
  const { t } = useI18n();
  return (
    <InlineMessage variant="info" heading={t("team.noAccess.heading")} iconLabel={t("message.info")}>
      {t("team.noAccess.body")}
    </InlineMessage>
  );
}

export function TeamScreen() {
  const { orgId } = useParams<{ orgId: string }>();
  const { state } = useSession();
  const org = state.status === "ready" ? state.workspace?.organizations.find((candidate) => candidate.org.id === orgId) : undefined;
  const blocked = org !== undefined && org.twoStep.required && !org.twoStep.satisfied; // the shell says why
  return (
    <Stack gap="5" className="pg-people">
      {org && !blocked && may(org, "members.view") ? (
        <TeamContent org={org} />
      ) : (
        <>
          <TeamHeader />
          <OfflineNotice />
          {!blocked && <NoAccess />}
        </>
      )}
    </Stack>
  );
}
