/**
 * Team, /org/:orgId/team (07 §Team and §12; plan §10 PR 20): the organisation's members, and, for the Owner and the
 * Admins, the pending invitations and the changes: invite someone (an organisation role, roles on each publication,
 * and the grants only where @pageinator/contracts' GRANT_HOLDERS allows them), send an invitation again or cancel it,
 * change a member's roles, remove a member. The Chief Editor sees the members only. The API decides every one of
 * these again; this page only leaves out what it would refuse.
 */
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useParams } from "react-router";
import {
  GRANT_HOLDERS,
  GRANTS,
  PUBLICATION_ROLES,
  type Grant,
  type PublicationRole,
} from "@pageinator/contracts";
import {
  Button,
  Checkbox,
  Cluster,
  Dialog,
  Field,
  InlineMessage,
  ProgressIndicator,
  RadioGroup,
  Stack,
  TextInput,
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
          <fieldset key={publication.id} className="pg-radio-group">
            <legend className="pg-radio-group__legend">{t("team.publication.legend", { publication: publication.name })}</legend>
            <div className="pg-codes">
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
                <div className="pg-codes">
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
          <Cluster gap="3">
            <Button type="submit">{pending ? t("team.invite.sending") : t("team.invite.submit")}</Button>
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
            <Cluster gap="3">
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
          <Cluster gap="3">
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
    <ul className="pg-type-body-small">
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

  if (load.status === "loading") return <ProgressIndicator role="status" label={t("team.loading")} />;
  if (load.status === "failed") {
    const { problem } = load;
    const code = problem.kind === "answer" ? problem.code : "";
    if (code === "two_step_required") return <TwoStepNeeded org={org} />;
    if (code === "not_allowed" || code === "not_found") return <NoAccess />;
    return (
      <Stack gap="4">
        <ProblemMessage problem={problem} live={load.live} />
        <div>
          <Button variant="secondary" onClick={() => void fetchAll(true)}>
            {t("form.retry")}
          </Button>
        </div>
      </Stack>
    );
  }

  return (
    <Stack gap="6">
      <div aria-live="polite">{notice && <p>{notice}</p>}</div>
      {actionProblem && <ProblemMessage problem={actionProblem} />}
      {manage && (
        <div>
          <Button onClick={() => setInviting(true)}>{t("team.invite")}</Button>
        </div>
      )}

      <section aria-labelledby="pg-team-members">
        <Stack gap="4">
          <h2 id="pg-team-members" className="pg-type-section-title">
            {t("team.members.heading")}
          </h2>
          <ul className="pg-list">
            {load.members.map((member) => {
              const changeable = manage && member.orgRole !== "owner" && member.userId !== me;
              return (
                <li key={member.userId} className="pg-list__item">
                  <p className="pg-type-body">
                    <strong>{member.name}</strong>
                  </p>
                  <p className="pg-type-body-small">{member.email}</p>
                  <p className="pg-type-body-small">{t("team.member.orgRole", { role: roleName(member.orgRole, t) })}</p>
                  <PublicationRoles org={org} grants={member.publications} />
                  <p className="pg-type-body-small">
                    {member.lastActiveAt
                      ? t("team.member.lastActive", { date: formatDateTime(member.lastActiveAt, language) })
                      : t("team.member.neverActive")}
                  </p>
                  {member.userId === me && <p className="pg-type-body-small">{t("team.member.you")}</p>}
                  {changeable && (
                    <Cluster gap="3">
                      <Button variant="secondary" size="sm" onClick={() => setEditing(member)}>
                        {t("team.changeRoles", { name: member.name })}
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => setRemoving(member)}>
                        {t("team.remove", { name: member.name })}
                      </Button>
                    </Cluster>
                  )}
                </li>
              );
            })}
          </ul>
        </Stack>
      </section>

      {manage && (
        <section aria-labelledby="pg-team-pending">
          <Stack gap="4">
            <h2 id="pg-team-pending" className="pg-type-section-title">
              {t("team.pending.heading")}
            </h2>
            {load.invitations.length === 0 && <p>{t("team.pending.none")}</p>}
            {load.invitations.length > 0 && (
              <ul className="pg-list">
                {load.invitations.map((invitation) => (
                  <li key={invitation.id} className="pg-list__item">
                    <p className="pg-type-body">
                      <strong>{invitation.email}</strong>
                    </p>
                    <p className="pg-type-body-small">
                      {t("team.member.orgRole", { role: roleName(invitation.orgRole, t) })}
                    </p>
                    <PublicationRoles org={org} grants={invitation.publications} />
                    <p className="pg-type-body-small">
                      {t("team.pending.expires", { date: formatDate(invitation.expiresAt, language) })}
                    </p>
                    <Cluster gap="3">
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-busy={busy === invitation.id}
                        onClick={() => void pendingAction(invitation, "resend")}
                      >
                        {t("team.pending.resend", { email: invitation.email })}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        aria-busy={busy === invitation.id}
                        onClick={() => void pendingAction(invitation, "cancel")}
                      >
                        {t("team.pending.cancel", { email: invitation.email })}
                      </Button>
                    </Cluster>
                  </li>
                ))}
              </ul>
            )}
          </Stack>
        </section>
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
              said(t("team.removed", { name: member.name }));
            }}
          />
        </>
      )}
    </Stack>
  );
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
  const { t } = useI18n();
  const org = state.status === "ready" ? state.workspace?.organizations.find((candidate) => candidate.org.id === orgId) : undefined;
  return (
    <Stack gap="5">
      <h1 id={ROUTE_HEADING_ID} className="pg-type-page-title" tabIndex={-1}>
        {t("glossary.team")}
      </h1>
      <OfflineNotice />
      {!org ? (
        <NoAccess />
      ) : org.twoStep.required && !org.twoStep.satisfied ? null /* the shell says why */ : !may(org, "members.view") ? (
        <NoAccess />
      ) : (
        <TeamContent org={org} />
      )}
    </Stack>
  );
}
