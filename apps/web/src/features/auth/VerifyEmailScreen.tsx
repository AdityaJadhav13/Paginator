/**
 * Verify email (03 §5.1). Better Auth confirms an address with an emailed link, not a code: the plan enables no email
 * one-time codes (§4.1), so the spec's 6-digit field becomes "open the link we sent". The link signs the person in and
 * comes back here with `?confirmed=1` (and `&invitation=<id>` from an invitation's sign-up); a bad link comes back
 * with `?error=TOKEN_EXPIRED` or another code. A new link can be asked for 60 seconds after the last one; the answer
 * is the same whether or not the address has an account.
 */
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Button, Field, InlineMessage, ProgressIndicator, Stack, TextInput } from "../../ui/index.ts";
import { paths } from "../../app/routes.ts";
import { useI18n } from "../../i18n/index.ts";
import type { ApiProblem } from "../../services/index.ts";
import { useAccount } from "./account-context.tsx";
import { AuthCard } from "./AuthCard.tsx";
import { OfflineNotice } from "./connection.tsx";
import { ProblemMessage } from "./ProblemMessage.tsx";
import { isInvitationId } from "./return-to.ts";
import { useSession } from "./SessionProvider.tsx";
import type { VerifyRouteState } from "./SignInScreen.tsx";
import { emailProblem, fieldErrors, type ValidationKey } from "./validation.ts";

/** How long a person waits before asking for another link (03 §5.1: "Resend (after 60 s)"). */
export const RESEND_WAIT_SECONDS = 60;

/** Where a confirmation link brings the browser back. */
export function verifyReturnPath(invitationId: string | null): string {
  return invitationId ? `${paths.verify()}?confirmed=1&invitation=${invitationId}` : `${paths.verify()}?confirmed=1`;
}

/** Seconds left until a deadline, counted from the clock (so a slow or a background tab cannot stretch it). */
function useCountdown(initialSeconds: number) {
  const [until, setUntil] = useState(() => (initialSeconds > 0 ? Date.now() + initialSeconds * 1000 : 0));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === 0) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= until) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [until]);
  const restart = useCallback((seconds: number) => {
    const start = Date.now();
    setNow(start);
    setUntil(start + seconds * 1000);
  }, []);
  const left = until === 0 ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
  return [left, restart] as const;
}

export function VerifyEmailScreen() {
  const account = useAccount();
  const { state } = useSession();
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const waitId = useId();
  const params = new URLSearchParams(location.search);
  const routeState = (location.state as VerifyRouteState | null) ?? {};
  const linkError = params.get("error");
  const confirmed = params.get("confirmed") === "1";
  const invitationCandidate = params.get("invitation") ?? routeState.invitationId ?? "";
  const invitationId = isInvitationId(invitationCandidate) ? invitationCandidate : null;
  const knownEmail = routeState.email ?? "";
  const [email, setEmail] = useState(knownEmail);
  const [error, setError] = useState<ValidationKey | undefined>();
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [pending, setPending] = useState(false);
  const [resent, setResent] = useState(false);
  const [wait, setWait] = useCountdown(routeState.reason === "signed-up" ? RESEND_WAIT_SECONDS : 0);
  const emailRef = useRef<HTMLInputElement>(null);

  const resend = async (address: string) => {
    if (pending || wait > 0) return;
    setProblem(null);
    setResent(false);
    setPending(true);
    const result = await account.sendVerificationEmail({ email: address, returnPath: verifyReturnPath(invitationId) });
    setPending(false);
    if (!result.ok) return setProblem(result.error);
    setResent(true);
    setWait(RESEND_WAIT_SECONDS);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = emailProblem(email);
    setError(found);
    if (found) return emailRef.current?.focus();
    await resend(email.trim());
  };

  if (confirmed && !linkError) {
    if (state.status === "loading") {
      return (
        <AuthCard title={t("verify.title")}>
          <ProgressIndicator role="status" label={t("signIn.checking")} />
        </AuthCard>
      );
    }
    const signedIn = state.status === "ready";
    const workspace = state.status === "ready" ? state.workspace : null;
    const next = invitationId
      ? paths.invitation(invitationId)
      : workspace
        ? paths.orgHome(workspace.activeOrganizationId)
        : paths.login();
    const signInPath = invitationId
      ? `${paths.login()}?returnTo=${encodeURIComponent(paths.invitation(invitationId))}`
      : paths.login();
    return (
      <AuthCard title={t("verify.title")}>
        <InlineMessage variant="success" heading={t("verify.confirmed.heading")} iconLabel={t("message.success")}>
          {signedIn ? t("verify.confirmed.signedIn") : t("verify.confirmed.signIn")}
        </InlineMessage>
        <div>
          {signedIn ? (
            <Button onClick={() => navigate(next)}>{t("verify.continue")}</Button>
          ) : (
            <Link to={signInPath}>{t("glossary.signIn")}</Link>
          )}
        </div>
      </AuthCard>
    );
  }

  const waitNote = wait > 0 && (
    <p id={waitId} className="pg-type-body-small pg-auth__hint">
      {t("verify.wait", { seconds: wait })}
    </p>
  );
  const sentNote = (
    <div aria-live="polite">{resent && <p>{t("verify.resent")}</p>}</div>
  );

  // arrived from a sign-up or a sign-in: the address is known, the link can be sent again
  if (knownEmail && !linkError) {
    return (
      <AuthCard title={t("verify.title")}>
        <OfflineNotice />
        {routeState.reason === "signed-up" ? (
          <p>{t("verify.sent", { email: knownEmail })}</p>
        ) : (
          <InlineMessage variant="warning" heading={t("signIn.unverified.heading")} iconLabel={t("message.warning")}>
            {t("signIn.unverified.body")}
          </InlineMessage>
        )}
        {problem && <ProblemMessage problem={problem} />}
        {sentNote}
        <div>
          <Button
            variant="secondary"
            denied={wait > 0}
            aria-describedby={wait > 0 ? waitId : undefined}
            onClick={() => void resend(knownEmail)}
          >
            {pending ? t("verify.resending") : t("verify.resend")}
          </Button>
        </div>
        {waitNote}
        {invitationId && (
          <p>
            <Link to={paths.invitation(invitationId)}>{t("verify.otherEmail")}</Link>
          </p>
        )}
      </AuthCard>
    );
  }

  // a bad link, or no address known: ask for one
  return (
    <AuthCard title={t("verify.title")}>
      <OfflineNotice />
      {linkError ? (
        <InlineMessage
          variant="error"
          heading={linkError === "TOKEN_EXPIRED" ? t("verify.expired.heading") : t("verify.invalid.heading")}
          iconLabel={t("message.error")}
        >
          {t("verify.again.lead")}
        </InlineMessage>
      ) : (
        <p>{t("verify.again.lead")}</p>
      )}
      {problem && <ProblemMessage problem={problem} />}
      {sentNote}
      <form noValidate onSubmit={submit} aria-busy={pending}>
        <Stack gap="4">
          <Field label={t("form.email")} errors={fieldErrors(t, error)}>
            <TextInput
              ref={emailRef}
              type="email"
              name="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <div>
            <Button type="submit" denied={wait > 0} aria-describedby={wait > 0 ? waitId : undefined}>
              {pending ? t("verify.resending") : t("verify.again.submit")}
            </Button>
          </div>
          {waitNote}
        </Stack>
      </form>
    </AuthCard>
  );
}
