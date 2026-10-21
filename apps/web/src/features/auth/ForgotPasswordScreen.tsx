/**
 * Forgot password (03 §5.1): one email address, one link. The answer never says whether the address has an account:
 * "If that email address has an account, a link is on its way."
 */
import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Button, Field, InlineMessage, Stack, TextInput } from "../../ui/index.ts";
import { paths } from "../../app/routes.ts";
import { useI18n } from "../../i18n/index.ts";
import type { ApiProblem } from "../../services/index.ts";
import { useAccount } from "./account-context.tsx";
import { AuthCard } from "./AuthCard.tsx";
import { OfflineNotice } from "./connection.tsx";
import { ProblemMessage } from "./ProblemMessage.tsx";
import { emailProblem, fieldErrors, type ValidationKey } from "./validation.ts";

export function ForgotPasswordScreen() {
  const account = useAccount();
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<ValidationKey | undefined>();
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const found = emailProblem(email);
    setError(found);
    setProblem(null);
    if (found) return emailRef.current?.focus();
    setPending(true);
    const result = await account.requestPasswordReset({ email: email.trim() });
    setPending(false);
    if (result.ok) setSent(true);
    else setProblem(result.error);
  };

  return (
    <AuthCard title={t("forgot.title")}>
      <OfflineNotice />
      {sent ? (
        <InlineMessage variant="success" heading={t("forgot.sent.heading")} live iconLabel={t("message.success")}>
          {t("forgot.sent.body")}
        </InlineMessage>
      ) : (
        <>
          <p>{t("forgot.lead")}</p>
          {problem && <ProblemMessage problem={problem} />}
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
                <Button type="submit">{pending ? t("forgot.sending") : t("forgot.submit")}</Button>
              </div>
            </Stack>
          </form>
        </>
      )}
      <p>
        <Link to={paths.login()}>{t("forgot.back")}</Link>
      </p>
    </AuthCard>
  );
}
