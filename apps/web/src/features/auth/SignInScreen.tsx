/**
 * Sign in (03 §5.1): email address, password, "Keep me signed in". A wrong email address and a wrong password get the
 * same answer. The "Continue with Google/Microsoft" buttons stay hidden (plan §4.1: no social sign-in), and the
 * server, not this page, decides when too many tries lock an address.
 *
 * Signed in already, the same route shows who is signed in, and opens their newsroom; with none yet, it lists their
 * pending invitations to join, or says how to get one.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Button, Checkbox, Field, InlineMessage, ProgressIndicator, Stack, TextInput } from "../../ui/index.ts";
import { paths } from "../../app/routes.ts";
import { useI18n } from "../../i18n/index.ts";
import type { ApiProblem, MyInvitationDto, ServiceResult } from "../../services/index.ts";
import { randomUuid } from "../../api/client.ts";
import { roleList } from "../people/roles.ts";
import { useAccount } from "./account-context.tsx";
import { AuthCard } from "./AuthCard.tsx";
import { OfflineNotice } from "./connection.tsx";
import { ProblemMessage } from "./ProblemMessage.tsx";
import { safeReturnTo } from "./return-to.ts";
import { useSession } from "./SessionProvider.tsx";
import { SessionProblemMessage } from "./SessionStatus.tsx";
import type { SignInRouteState } from "./SignedOutRedirect.tsx";
import { SignOutButton } from "./SignOutButton.tsx";
import { emailProblem, fieldErrors, type ValidationKey } from "./validation.ts";

/** What the verify screen needs to know when sign-in sends a person there. */
export interface VerifyRouteState {
  readonly email?: string;
  readonly invitationId?: string;
  /** "signed-up": a link was just sent; "unverified": the address was never confirmed. */
  readonly reason?: "signed-up" | "unverified";
}

function SignedInLanding() {
  const { state } = useSession();
  const { t } = useI18n();
  const navigate = useNavigate();
  if (state.status !== "ready") return null;
  const { user } = state.session;
  const { workspace } = state;
  return (
    <AuthCard title={t("signedIn.title")}>
      <p>{t("signedIn.as", { name: user.name, email: user.email })}</p>
      {workspace ? (
        <div>
          <Button
            onClick={() => navigate(paths.orgHome(workspace.activeOrganizationId))}
          >
            {t("signedIn.openWorkspace")}
          </Button>
        </div>
      ) : (
        <MyInvitations />
      )}
      <div>
        <SignOutButton />
      </div>
    </AuthCard>
  );
}

/** Signed in with no newsroom: the person's pending invitations, each with Join, so one never accepted (the tab closed
 * after the email was confirmed) is still there on any later sign-in; or why there is nothing to open. */
function MyInvitations() {
  const account = useAccount();
  const { refresh } = useSession();
  const { t, language } = useI18n();
  const [loaded, setLoaded] = useState<ServiceResult<readonly MyInvitationDto[], ApiProblem> | null>(null);
  const [joining, setJoining] = useState<string | null>(null);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const keys = useRef(new Map<string, string>());
  useEffect(() => {
    let active = true;
    void account.listMyInvitations().then((result) => {
      if (active) setLoaded(result);
    });
    return () => {
      active = false;
    };
  }, [account]);

  if (loaded === null) return <ProgressIndicator role="status" label={t("signedIn.invitations.loading")} />;
  const invitations = loaded.ok ? loaded.value : [];
  const join = async (invitationId: string) => {
    if (joining) return;
    // one key per invitation, reused by every retry of its Join
    const key = keys.current.get(invitationId) ?? randomUuid();
    keys.current.set(invitationId, key);
    setProblem(null);
    setJoining(invitationId);
    const result = await account.acceptInvitation({ invitationId, idempotencyKey: key });
    setJoining(null);
    if (result.ok) void refresh(); // the workspace arrives, and this landing offers to open it
    else setProblem(result.error);
  };
  return (
    <Stack gap="4">
      {!loaded.ok && <ProblemMessage problem={loaded.error} live={false} />}
      {problem && <ProblemMessage problem={problem} />}
      {invitations.length === 0 ? (
        <p>{t("signedIn.nothingYet")}</p>
      ) : (
        <section aria-labelledby="my-invitations">
          <h2 id="my-invitations" className="pg-type-section-title">
            {t("signedIn.invitations.heading")}
          </h2>
          <Stack gap="4">
            {invitations.map((invitation) => (
              <Stack gap="2" key={invitation.id}>
                <p>
                  {t("invite.summary", {
                    inviter: invitation.inviterName,
                    organization: invitation.organizationName,
                    roles: roleList(invitation.roles, language, (key) => t(key)),
                  })}
                </p>
                <div>
                  <Button onClick={() => void join(invitation.id)}>
                    {joining === invitation.id
                      ? t("invite.joining")
                      : t("invite.join", { organization: invitation.organizationName })}
                  </Button>
                </div>
              </Stack>
            ))}
          </Stack>
        </section>
      )}
    </Stack>
  );
}

function SignInProblem({ problem, email }: { readonly problem: ApiProblem; readonly email: string }) {
  const { t } = useI18n();
  if (problem.kind === "answer" && problem.code === "INVALID_EMAIL_OR_PASSWORD") {
    return (
      <InlineMessage variant="error" heading={t("signIn.wrong.heading")} live iconLabel={t("message.error")}>
        {t("signIn.wrong.body")}
      </InlineMessage>
    );
  }
  if (problem.kind === "answer" && problem.code === "EMAIL_NOT_VERIFIED") {
    const verifyState: VerifyRouteState = { email: email.trim(), reason: "unverified" };
    return (
      <div role="alert">
        <InlineMessage variant="warning" heading={t("signIn.unverified.heading")} iconLabel={t("message.warning")}>
          {t("signIn.unverified.body")}
        </InlineMessage>
        <p>
          <Link to={paths.verify()} state={verifyState}>
            {t("signIn.unverified.action")}
          </Link>
        </p>
      </div>
    );
  }
  return <ProblemMessage problem={problem} />;
}

export function SignInScreen() {
  const { state } = useSession();
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [signedInHere, setSignedInHere] = useState(false);
  const returnTo = new URLSearchParams(location.search).get("returnTo");

  // After signing in on this screen: back to where the person was, or into their workspace if they have one.
  useEffect(() => {
    if (!signedInHere || state.status !== "ready") return;
    const { workspace } = state;
    const fallback = workspace ? paths.orgHome(workspace.activeOrganizationId) : "";
    const target = safeReturnTo(returnTo, fallback);
    if (target) navigate(target, { replace: true });
  }, [navigate, returnTo, signedInHere, state]);

  if (state.status === "ready") return <SignedInLanding />;
  // The same card (and heading) while the session is checked and after; the form inside holds what was typed, and
  // goes the moment the person is signed in, so the next person on this computer never finds it filled in.
  return (
    <AuthCard title={t("glossary.signIn")}>
      {state.status === "loading" ? (
        <ProgressIndicator role="status" label={t("signIn.checking")} />
      ) : (
        <SignInForm onSignedIn={() => setSignedInHere(true)} />
      )}
    </AuthCard>
  );
}

function SignInForm({ onSignedIn }: { readonly onSignedIn: () => void }) {
  const { state, signIn, retry } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useI18n();
  const keepHintId = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(false);
  const [errors, setErrors] = useState<{ email?: ValidationKey | undefined; password?: ValidationKey | undefined }>({});
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [pending, setPending] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const found = {
      email: emailProblem(email),
      password: password === "" ? ("validation.passwordMissing" as const) : undefined,
    };
    setErrors(found);
    setProblem(null);
    if (found.email) return emailRef.current?.focus();
    if (found.password) return passwordRef.current?.focus();
    setPending(true);
    const result = await signIn({ email: email.trim(), password, rememberMe: keepSignedIn });
    setPending(false);
    if (result.ok && result.value.status === "two-step") {
      // the password was right; the code comes next, and the place to return to goes along
      navigate(`${paths.twoStep()}${location.search}`);
      return;
    }
    if (result.ok) {
      onSignedIn();
      return;
    }
    if (result.error.kind === "answer" && result.error.code === "INVALID_EMAIL") {
      setErrors({ email: "validation.emailInvalid" });
      emailRef.current?.focus();
      return;
    }
    setProblem(result.error);
    if (result.error.kind === "answer" && result.error.code === "INVALID_EMAIL_OR_PASSWORD") {
      setPassword("");
      passwordRef.current?.focus();
    }
  };

  return (
    <>
      <OfflineNotice />
      {state.status === "signed-out" && (location.state as SignInRouteState | null)?.expired === true && (
        <InlineMessage variant="info" heading={t("signIn.expired.heading")} iconLabel={t("message.info")}>
          {t("signIn.expired.body")}
        </InlineMessage>
      )}
      {state.status === "unavailable" && (
        <Stack gap="3">
          <p className="pg-type-section-title">{t("signIn.checkFailed.heading")}</p>
          <SessionProblemMessage />
          <div>
            <Button variant="secondary" onClick={() => void retry()}>
              {t("form.retry")}
            </Button>
          </div>
        </Stack>
      )}
      {problem && <SignInProblem problem={problem} email={email} />}
      <form noValidate onSubmit={submit} aria-busy={pending}>
        <Stack gap="4">
          <Field label={t("form.email")} errors={fieldErrors(t, errors.email)}>
            <TextInput
              ref={emailRef}
              type="email"
              name="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field label={t("form.password")} errors={fieldErrors(t, errors.password)}>
            <TextInput
              ref={passwordRef}
              type={showPassword ? "text" : "password"}
              name="password"
              autoComplete="current-password"
              autoCapitalize="none"
              spellCheck={false}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Checkbox
            label={t("form.showPassword")}
            checked={showPassword}
            onChange={(event) => setShowPassword(event.target.checked)}
          />
          <div>
            <Checkbox
              label={t("signIn.keep")}
              checked={keepSignedIn}
              aria-describedby={keepHintId}
              onChange={(event) => setKeepSignedIn(event.target.checked)}
            />
            <p id={keepHintId} className="pg-type-body-small pg-auth__hint">
              {t("signIn.keepHint")}
            </p>
          </div>
          <div>
            <Button type="submit">{pending ? t("signIn.submitting") : t("signIn.submit")}</Button>
          </div>
        </Stack>
      </form>
      <ul className="pg-auth__links">
        <li>
          <Link to={paths.forgotPassword()}>{t("signIn.forgot")}</Link>
        </li>
        <li>
          <Link to={paths.signup()}>{t("signIn.noAccount")}</Link>
        </li>
      </ul>
    </>
  );
}
