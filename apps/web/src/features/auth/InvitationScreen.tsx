/**
 * The invitation landing, /invite/:invitationId (03 §5.1, plan §4.3): "Ravi Kulkarni invited you to The Sahyadri Daily
 * as Page designer". Sign-up exists only here: a new person creates an account for the invited address, confirms it
 * from the emailed link, and comes back to Join; a person with an account signs in and comes back. Joining sends an
 * Idempotency-Key, the same one on every retry, so a retry never joins twice.
 *
 * The invitation endpoints arrive with the API's PR 10; until then every link here is answered "cannot be used".
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Button, Checkbox, Field, InlineMessage, ProgressIndicator, Stack, TextInput } from "../../ui/index.ts";
import { paths } from "../../app/routes.ts";
import { useI18n } from "../../i18n/index.ts";
import type { ApiProblem, InvitationDto } from "../../services/index.ts";
import { randomUuid } from "../../api/client.ts";
import { useAccount } from "./account-context.tsx";
import { AuthCard } from "./AuthCard.tsx";
import { OfflineNotice } from "./connection.tsx";
import { ProblemMessage } from "./ProblemMessage.tsx";
import { isInvitationId } from "./return-to.ts";
import { useSession } from "./SessionProvider.tsx";
import type { VerifyRouteState } from "./SignInScreen.tsx";
import { SignOutButton } from "./SignOutButton.tsx";
import {
  MIN_PASSWORD,
  emailProblem,
  fieldErrors,
  newPasswordProblem,
  passwordAnswerProblem,
  type ValidationKey,
} from "./validation.ts";
import { verifyReturnPath } from "./VerifyEmailScreen.tsx";
import { roleList } from "../people/roles.ts";
import { formatDate } from "../../i18n/dates.ts";

// The role names live with Team's (features/people/roles.ts); tests read them from here too.
export { roleList, type RoleNameKey } from "../people/roles.ts";

/** A date as the pilot reads it: India's time zone, Latin digits (02 §3.3). */
export const invitationDate = formatDate;

type Loaded =
  | { readonly status: "loading" }
  | { readonly status: "invalid" }
  | { readonly status: "failed"; readonly problem: ApiProblem; readonly live: boolean }
  | { readonly status: "ready"; readonly invitation: InvitationDto };

function useInvitation(invitationId: string) {
  const account = useAccount();
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  useEffect(() => {
    if (!isInvitationId(invitationId)) {
      setLoaded({ status: "invalid" });
      return;
    }
    let active = true;
    setLoaded({ status: "loading" });
    void account.getInvitation({ invitationId }).then((result) => {
      if (!active) return;
      if (result.ok) setLoaded({ status: "ready", invitation: result.value });
      else if (result.error.kind === "answer" && result.error.status === 404) setLoaded({ status: "invalid" });
      else setLoaded({ status: "failed", problem: result.error, live: attempt > 0 });
    });
    return () => {
      active = false;
    };
  }, [account, attempt, invitationId]);
  return { loaded, retry: () => setAttempt((count) => count + 1) };
}

function SignUpForm({ invitationId }: { readonly invitationId: string }) {
  const account = useAccount();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<"name" | "email" | "password" | "confirm", ValidationKey>>>({});
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [pending, setPending] = useState(false);
  const refs = {
    name: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
    confirm: useRef<HTMLInputElement>(null),
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const found: Partial<Record<keyof typeof refs, ValidationKey>> = {};
    if (name.trim() === "") found.name = "validation.nameMissing";
    const emailIssue = emailProblem(email);
    if (emailIssue) found.email = emailIssue;
    const passwordIssue = newPasswordProblem(password);
    if (passwordIssue) found.password = passwordIssue;
    else if (password !== confirm) found.confirm = "validation.passwordsDiffer";
    setErrors(found);
    setProblem(null);
    const first = (["name", "email", "password", "confirm"] as const).find((field) => found[field]);
    if (first) return refs[first].current?.focus();
    setPending(true);
    const address = email.trim();
    const result = await account.signUp({
      invitationId,
      name: name.trim(),
      email: address,
      password,
      returnPath: verifyReturnPath(invitationId),
    });
    setPending(false);
    if (result.ok) {
      const next: VerifyRouteState = { email: address, invitationId, reason: "signed-up" };
      navigate(paths.verify(), { state: next });
      return;
    }
    const code = result.error.kind === "answer" ? result.error.code : "";
    const refused = passwordAnswerProblem(code);
    if (refused) {
      setErrors({ password: refused });
      return refs.password.current?.focus();
    }
    if (code === "INVALID_EMAIL") {
      setErrors({ email: "validation.emailInvalid" });
      return refs.email.current?.focus();
    }
    setProblem(result.error);
  };

  return (
    <>
      {problem && <ProblemMessage problem={problem} />}
      <form noValidate onSubmit={submit} aria-busy={pending}>
        <Stack gap="4">
          <Field label={t("form.name")} required requiredLabel={t("form.required")} errors={fieldErrors(t, errors.name)}>
            <TextInput
              ref={refs.name}
              name="name"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field
            label={t("form.email")}
            description={t("invite.emailHint")}
            required
            requiredLabel={t("form.required")}
            errors={fieldErrors(t, errors.email)}
          >
            <TextInput
              ref={refs.email}
              type="email"
              name="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field
            label={t("invite.password")}
            description={t("invite.passwordHint", { min: MIN_PASSWORD })}
            required
            requiredLabel={t("form.required")}
            errors={fieldErrors(t, errors.password)}
          >
            <TextInput
              ref={refs.password}
              type={showPassword ? "text" : "password"}
              name="new-password"
              autoComplete="new-password"
              autoCapitalize="none"
              spellCheck={false}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Field label={t("invite.confirm")} required requiredLabel={t("form.required")} errors={fieldErrors(t, errors.confirm)}>
            <TextInput
              ref={refs.confirm}
              type={showPassword ? "text" : "password"}
              name="confirm-password"
              autoComplete="new-password"
              autoCapitalize="none"
              spellCheck={false}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </Field>
          <Checkbox
            label={t("form.showPassword")}
            checked={showPassword}
            onChange={(event) => setShowPassword(event.target.checked)}
          />
          <div>
            <Button type="submit">{pending ? t("invite.submitting") : t("invite.submit")}</Button>
          </div>
        </Stack>
      </form>
    </>
  );
}

function JoinPanel({ invitationId, invitation }: { readonly invitationId: string; readonly invitation: InvitationDto }) {
  const account = useAccount();
  const { state, refresh } = useSession();
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [joined, setJoined] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);
  if (state.status !== "ready") return null;
  const organization = invitation.organizationName;

  if (joined) {
    return (
      <Stack gap="4">
        <InlineMessage variant="success" heading={t("invite.joined.heading", { organization })} live iconLabel={t("message.success")}>
          {t("invite.joined.body")}
        </InlineMessage>
        <p>
          <Link className="pg-button pg-button--primary pg-button--md" to={paths.orgHome(joined)}>
            {t("invite.open", { organization })}
          </Link>
        </p>
      </Stack>
    );
  }

  const join = async () => {
    if (pending) return;
    keyRef.current ??= randomUuid(); // one key for this Join, reused by every retry of it
    setProblem(null);
    setPending(true);
    const result = await account.acceptInvitation({ invitationId, idempotencyKey: keyRef.current });
    setPending(false);
    if (result.ok) {
      setJoined(result.value.orgId);
      void refresh();
      return;
    }
    setProblem(result.error);
  };

  // The API answers 404 for an invitation sent to another address, expired or used since this page loaded (it never
  // says which), 403 for an address not yet confirmed, and 409 for one already accepted.
  const refusal =
    problem?.kind === "answer" && (problem.status === 403 || problem.status === 404 || problem.status === 409)
      ? ("cannotJoin" as const)
      : undefined;

  return (
    <Stack gap="4">
      <p>{t("invite.signedInAs", { email: state.session.user.email })}</p>
      {refusal === "cannotJoin" && (
        <InlineMessage variant="error" heading={t("invite.cannotJoin.heading")} live iconLabel={t("message.error")}>
          {t("invite.cannotJoin.body")}
        </InlineMessage>
      )}
      {problem && !refusal && !(problem.kind === "answer" && problem.code === "signed_out") && (
        <ProblemMessage problem={problem} />
      )}
      <div>
        <Button onClick={() => void join()}>
          {pending ? t("invite.joining") : t("invite.join", { organization })}
        </Button>
      </div>
      <p>{t("invite.notYou")}</p>
      <div>
        <SignOutButton variant="quiet" size="sm" />
      </div>
    </Stack>
  );
}

export function InvitationScreen() {
  const { invitationId = "" } = useParams<{ invitationId: string }>();
  const { state } = useSession();
  const { t, language } = useI18n();
  const { loaded, retry } = useInvitation(invitationId);
  const [creating, setCreating] = useState(false);

  if (loaded.status === "loading") {
    return (
      <AuthCard title={t("invite.title")}>
        <ProgressIndicator role="status" label={t("invite.loading")} />
      </AuthCard>
    );
  }
  if (loaded.status === "invalid") {
    return (
      <AuthCard title={t("invite.title")}>
        <InlineMessage variant="error" heading={t("invite.invalid.heading")} iconLabel={t("message.error")}>
          {t("invite.invalid.body")}
        </InlineMessage>
      </AuthCard>
    );
  }
  if (loaded.status === "failed") {
    return (
      <AuthCard title={t("invite.title")}>
        <OfflineNotice />
        <ProblemMessage problem={loaded.problem} live={loaded.live} />
        <div>
          <Button onClick={retry}>{t("form.retry")}</Button>
        </div>
      </AuthCard>
    );
  }

  const { invitation } = loaded;
  if (invitation.state !== "pending") {
    const heading =
      invitation.state === "expired"
        ? t("invite.expired.heading")
        : invitation.state === "accepted"
          ? t("invite.accepted.heading")
          : t("invite.revoked.heading");
    const body =
      invitation.state === "expired"
        ? t("invite.expired.body")
        : invitation.state === "accepted"
          ? t("invite.accepted.body")
          : t("invite.invalid.body");
    return (
      <AuthCard title={t("invite.title")}>
        <InlineMessage variant="warning" heading={heading} iconLabel={t("message.warning")}>
          {body}
        </InlineMessage>
        {invitation.state === "accepted" && (
          <p>
            <Link to={paths.login()}>{t("glossary.signIn")}</Link>
          </p>
        )}
      </AuthCard>
    );
  }

  const summary = t("invite.summary", {
    inviter: invitation.inviterName,
    organization: invitation.organizationName,
    roles: roleList(invitation.roles, language, (key) => t(key)),
  });
  const signInPath = `${paths.login()}?returnTo=${encodeURIComponent(paths.invitation(invitationId))}`;

  return (
    <AuthCard title={t("invite.title")}>
      <OfflineNotice />
      <p className="pg-type-section-title">{summary}</p>
      <p>{t("invite.expires", { date: invitationDate(invitation.expiresAt, language) })}</p>
      {state.status === "loading" && <ProgressIndicator role="status" label={t("signIn.checking")} />}
      {state.status === "ready" && <JoinPanel invitationId={invitationId} invitation={invitation} />}
      {(state.status === "signed-out" || state.status === "unavailable") &&
        (creating ? (
          <SignUpForm invitationId={invitationId} />
        ) : (
          <Stack gap="4">
            <div>
              <Button onClick={() => setCreating(true)}>{t("invite.newAccount")}</Button>
            </div>
            <p>
              {t("invite.haveAccount")} <Link to={signInPath}>{t("invite.signInInstead")}</Link>
            </p>
          </Stack>
        ))}
    </AuthCard>
  );
}
