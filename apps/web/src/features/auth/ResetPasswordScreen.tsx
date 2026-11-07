/**
 * Reset password (03 §5.1): the emailed link brings the browser here with `?token=` (or `?error=INVALID_TOKEN` when the
 * link was bad: Better Auth checks it first). The token leaves the address bar at once and waits in the page's
 * history state instead. A new password of at least 12 characters, typed twice; setting it ends every session of the
 * account (plan §4.1, revokeSessionsOnPasswordReset).
 *
 * The spec's strength meter is a length count here: no strength estimator is part of the app.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Button, Checkbox, Field, InlineMessage, Stack, TextInput } from "../../ui/index.ts";
import { paths } from "../../app/routes.ts";
import { useI18n } from "../../i18n/index.ts";
import type { ApiProblem } from "../../services/index.ts";
import { useAccount } from "./account-context.tsx";
import { AuthCard } from "./AuthCard.tsx";
import { OfflineNotice } from "./connection.tsx";
import { ProblemMessage } from "./ProblemMessage.tsx";
import { useSession } from "./SessionProvider.tsx";
import {
  MIN_PASSWORD,
  fieldErrors,
  newPasswordProblem,
  passwordAnswerProblem,
  type ValidationKey,
} from "./validation.ts";

interface ResetRouteState {
  readonly resetToken?: string;
}

export function ResetPasswordScreen() {
  const account = useAccount();
  const { refresh } = useSession();
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const urlToken = params.get("token");
  const linkError = params.get("error");
  const token = urlToken ?? (location.state as ResetRouteState | null)?.resetToken ?? null;
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{ password?: ValidationKey | undefined; confirm?: ValidationKey | undefined }>(
    {}
  );
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [tokenRefused, setTokenRefused] = useState(false);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  // once the token is spent or refused, it leaves the history entry too
  const tokenInHistory = Boolean((location.state as ResetRouteState | null)?.resetToken);
  useEffect(() => {
    if ((done || tokenRefused) && tokenInHistory) navigate(paths.resetPassword(), { replace: true, state: null });
  }, [done, navigate, tokenInHistory, tokenRefused]);

  useEffect(() => {
    if (urlToken) {
      navigate(paths.resetPassword(), { replace: true, state: { resetToken: urlToken } satisfies ResetRouteState });
    }
  }, [navigate, urlToken]);

  if (done) {
    return (
      <AuthCard title={t("reset.title")}>
        <InlineMessage variant="success" heading={t("reset.done.heading")} live iconLabel={t("message.success")}>
          {t("reset.done.body")}
        </InlineMessage>
        <p>
          <Link to={paths.login()}>{t("glossary.signIn")}</Link>
        </p>
      </AuthCard>
    );
  }

  if (linkError || !token || tokenRefused) {
    return (
      <AuthCard title={t("reset.title")}>
        <InlineMessage
          variant="error"
          heading={t("reset.invalid.heading")}
          live={tokenRefused}
          iconLabel={t("message.error")}
        >
          {t("reset.invalid.body")}
        </InlineMessage>
        <p>
          <Link to={paths.forgotPassword()}>{t("reset.askAgain")}</Link>
        </p>
      </AuthCard>
    );
  }

  const count = password.length;
  const lengthText =
    count >= MIN_PASSWORD ? t("reset.lengthOk", { count }) : t("reset.length", { count, min: MIN_PASSWORD });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const found = {
      password: newPasswordProblem(password),
      confirm: password !== confirm ? ("validation.passwordsDiffer" as const) : undefined,
    };
    setErrors(found);
    setProblem(null);
    if (found.password) return passwordRef.current?.focus();
    if (found.confirm) return confirmRef.current?.focus();
    setPending(true);
    const result = await account.resetPassword({ token, newPassword: password });
    setPending(false);
    if (result.ok) {
      setDone(true);
      void refresh(); // every session of the account ended, this browser's included
      return;
    }
    const code = result.error.kind === "answer" ? result.error.code : "";
    if (code === "INVALID_TOKEN") return setTokenRefused(true);
    const refused = passwordAnswerProblem(code);
    if (refused) {
      setErrors({ password: refused });
      return passwordRef.current?.focus();
    }
    setProblem(result.error);
  };

  return (
    <AuthCard title={t("reset.title")}>
      <OfflineNotice />
      {problem && <ProblemMessage problem={problem} />}
      <form noValidate onSubmit={submit} aria-busy={pending}>
        <Stack gap="4">
          <Field
            label={t("reset.new")}
            description={`${t("reset.hint", { min: MIN_PASSWORD })} ${lengthText}`}
            errors={fieldErrors(t, errors.password)}
          >
            <TextInput
              ref={passwordRef}
              type={showPassword ? "text" : "password"}
              name="new-password"
              autoComplete="new-password"
              autoCapitalize="none"
              spellCheck={false}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Field label={t("reset.confirm")} errors={fieldErrors(t, errors.confirm)}>
            <TextInput
              ref={confirmRef}
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
            <Button type="submit">{pending ? t("reset.submitting") : t("reset.submit")}</Button>
          </div>
        </Stack>
      </form>
    </AuthCard>
  );
}
