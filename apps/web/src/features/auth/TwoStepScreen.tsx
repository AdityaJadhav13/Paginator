/**
 * Two-step verification at sign-in, /mfa (03 §5.1; plan §4.4): after a right password, the 6-digit code from the
 * authenticator app, or a backup code, with "Trust this device for 30 days". Better Auth keeps the pending sign-in in a
 * cookie for 10 minutes and locks it after 5 wrong codes; this page says which happened. Codes by email are off.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Button, Checkbox, Field, InlineMessage, Stack, TextInput } from "../../ui/index.ts";
import { paths } from "../../app/routes.ts";
import { useI18n } from "../../i18n/index.ts";
import type { ApiProblem } from "../../services/index.ts";
import { AuthCard } from "./AuthCard.tsx";
import { OfflineNotice } from "./connection.tsx";
import { ProblemMessage } from "./ProblemMessage.tsx";
import { safeReturnTo } from "./return-to.ts";
import { useSession } from "./SessionProvider.tsx";

type CodeError = "validation.codeMissing" | "validation.backupMissing";

function TwoStepProblem({ problem }: { readonly problem: ApiProblem }) {
  const { t } = useI18n();
  const code = problem.kind === "answer" ? problem.code : "";
  const [heading, body] =
    code === "INVALID_CODE"
      ? (["mfa.wrong.heading", "mfa.wrong.body"] as const)
      : code === "INVALID_BACKUP_CODE"
        ? (["mfa.wrongBackup.heading", "mfa.wrongBackup.body"] as const)
        : code === "ACCOUNT_TEMPORARILY_LOCKED" || code === "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE"
          ? (["mfa.locked.heading", "mfa.locked.body"] as const)
          : code === "INVALID_TWO_FACTOR_COOKIE"
            ? (["mfa.expired.heading", "mfa.expired.body"] as const)
            : [undefined, undefined];
  if (!heading || !body) return <ProblemMessage problem={problem} />;
  const startAgain = code === "INVALID_TWO_FACTOR_COOKIE" || code.includes("ATTEMPTS") || code.includes("LOCKED");
  return (
    <div role="alert">
      <InlineMessage variant="error" heading={t(heading)} iconLabel={t("message.error")}>
        {t(body)}
      </InlineMessage>
      {startAgain && (
        <p>
          <Link to={paths.login()}>{t("glossary.signIn")}</Link>
        </p>
      )}
    </div>
  );
}

export function TwoStepScreen() {
  const { state, verifyTwoStep } = useSession();
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const trustHintId = useId();
  const [kind, setKind] = useState<"totp" | "backup">("totp");
  const [code, setCode] = useState("");
  const [trust, setTrust] = useState(false);
  const [error, setError] = useState<CodeError | undefined>();
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [pending, setPending] = useState(false);
  /** Set before the code is sent: the session may turn ready before the answer reaches this page. */
  const verifying = useRef(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const returnTo = new URLSearchParams(location.search).get("returnTo");

  // signed in (by this code, or already): back to where the person was, else their organisation, else the signed-in page
  useEffect(() => {
    if (state.status !== "ready") return;
    const { workspace } = state;
    const fallback = workspace ? paths.orgHome(workspace.activeOrganizationId) : paths.login();
    navigate(verifying.current ? safeReturnTo(returnTo, fallback) : paths.login(), { replace: true });
  }, [navigate, returnTo, state]);

  const switchKind = () => {
    setKind((current) => (current === "totp" ? "backup" : "totp"));
    setCode("");
    setError(undefined);
    setProblem(null);
    codeRef.current?.focus();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const entered = code.trim();
    const invalid =
      kind === "totp" ? (/^\d{6}$/.test(entered.replace(/\s/g, "")) ? undefined : "validation.codeMissing") : entered === "" ? "validation.backupMissing" : undefined;
    setError(invalid);
    setProblem(null);
    if (invalid) return codeRef.current?.focus();
    setPending(true);
    verifying.current = true;
    const result = await verifyTwoStep({ code: kind === "totp" ? entered.replace(/\s/g, "") : entered, kind, trustDevice: trust });
    setPending(false);
    if (result.ok) return; // the session is ready: the effect above moves on
    verifying.current = false;
    setProblem(result.error);
    setCode("");
    codeRef.current?.focus();
  };

  return (
    <AuthCard title={t("mfa.title")}>
      <OfflineNotice />
      <p>{kind === "totp" ? t("mfa.lead") : t("mfa.backupLead")}</p>
      {problem && <TwoStepProblem problem={problem} />}
      <form noValidate onSubmit={submit} aria-busy={pending}>
        <Stack gap="4">
          <Field label={kind === "totp" ? t("mfa.code") : t("mfa.backupCode")} errors={error ? [t(error)] : []}>
            <TextInput
              ref={codeRef}
              name="code"
              inputMode={kind === "totp" ? "numeric" : "text"}
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </Field>
          <div>
            <Checkbox
              label={t("mfa.trust")}
              checked={trust}
              aria-describedby={trustHintId}
              onChange={(event) => setTrust(event.target.checked)}
            />
            <p id={trustHintId} className="pg-type-body-small pg-auth__hint">
              {t("signIn.keepHint")}
            </p>
          </div>
          <div>
            <Button type="submit">{pending ? t("mfa.submitting") : t("mfa.submit")}</Button>
          </div>
        </Stack>
      </form>
      <div>
        <Button variant="quiet" onClick={switchKind}>
          {kind === "totp" ? t("mfa.useBackup") : t("mfa.useApp")}
        </Button>
      </div>
    </AuthCard>
  );
}
