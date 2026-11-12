/**
 * /signup: a new paper signs up here (POST /api/v1/signup/paper, through the paper sign-up service); a person joining a
 * paper that already uses Pageinator still needs that paper's invitation (plan §4.1, §4.3), whose own page holds the
 * account form (/invite/:id).
 *
 *   - The form asks for the paper's name, the owner's name and email, and the paper's language. Like the contact form,
 *     it carries a trap field that people never see and the time since it was opened; the answer is the same whether
 *     or not the email has an application already.
 *   - `?confirm=<token>` is the emailed link: the page confirms the address once (the token leaves the address bar at
 *     once), then says the request waits for approval, or that the link does not work.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { PAPER_SIGNUP_LIMITS } from "@pageinator/contracts";
import { Button, Field, InlineMessage, RadioGroup, Stack, TextInput } from "../../ui/index.ts";
import { paths } from "../../app/routes.ts";
import { LANGUAGE_NAMES, LANGUAGES, useI18n, type Language } from "../../i18n/index.ts";
import type { PaperConfirmOutcome, PaperSignupService } from "../../services/index.ts";
import { AuthCard } from "./AuthCard.tsx";
import { emailProblem, fieldErrors } from "./validation.ts";

type FieldName = "paperName" | "ownerName" | "email";
const ORDER: readonly FieldName[] = ["paperName", "ownerName", "email"];
type Status = "editing" | "sending" | "sent" | "busy" | "failed" | "invalid";

export function SignUpScreen({ service }: { readonly service: PaperSignupService }) {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [token] = useState(() => params.get("confirm"));
  const [confirmation, setConfirmation] = useState<PaperConfirmOutcome | "confirming" | null>(
    token ? "confirming" : null,
  );

  // once only (a token works once; React's development check runs effects twice)
  const confirming = useRef(false);
  useEffect(() => {
    if (!token || confirming.current) return;
    confirming.current = true;
    navigate(paths.signup(), { replace: true }); // the token leaves the address bar and the history
    void service.confirm(token).then(setConfirmation);
  }, [navigate, service, token]);

  if (confirmation === null) return <PaperSignupForm service={service} />;
  return (
    <AuthCard title={t("signUp.title")}>
      {confirmation === "confirming" ? (
        <p role="status">{t("paperSignup.confirming")}</p>
      ) : confirmation === "waiting" ? (
        <InlineMessage variant="success" heading={t("paperSignup.waiting.heading")} live iconLabel={t("message.success")}>
          {t("paperSignup.waiting.body")}
        </InlineMessage>
      ) : (
        <InlineMessage variant="error" heading={t("paperSignup.badLink.heading")} live iconLabel={t("message.error")}>
          {confirmation === "invalid" ? t("paperSignup.badLink.body") : t("paperSignup.confirmFailed.body")}
        </InlineMessage>
      )}
      <p>
        <Link to={paths.home()}>{t("nav.home")}</Link>
      </p>
    </AuthCard>
  );
}

function PaperSignupForm({ service }: { readonly service: PaperSignupService }) {
  const { t, language: pageLanguage } = useI18n();
  const [values, setValues] = useState<Record<FieldName, string>>({ paperName: "", ownerName: "", email: "" });
  const [language, setLanguage] = useState<Language>(pageLanguage);
  const [trap, setTrap] = useState("");
  const [tried, setTried] = useState(false);
  const [serverFields, setServerFields] = useState<readonly string[]>([]);
  const [status, setStatus] = useState<Status>("editing");
  const openedAt = useRef(Date.now());
  const refs = {
    paperName: useRef<HTMLInputElement>(null),
    ownerName: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
  };

  const missing = (field: FieldName) =>
    field === "email" ? emailProblem(values.email) !== undefined : values[field].trim() === "";
  const errorOf = (field: FieldName): string[] => {
    const refused = serverFields.includes(field);
    if (!(tried && missing(field)) && !refused) return [];
    if (field === "email") return fieldErrors(t, emailProblem(values.email) ?? "validation.emailInvalid");
    return [t(field === "paperName" ? "paperSignup.paperNameMissing" : "validation.nameMissing")];
  };

  const change = (field: FieldName) => (event: { target: { value: string } }) => {
    setValues((previous) => ({ ...previous, [field]: event.target.value }));
    setServerFields((previous) => previous.filter((name) => name !== field));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status === "sending") return;
    setTried(true);
    const first = ORDER.find(missing);
    if (first) return refs[first].current?.focus();
    setStatus("sending");
    const outcome = await service.apply({
      paperName: values.paperName.trim(),
      ownerName: values.ownerName.trim(),
      email: values.email.trim(),
      language,
      website: trap,
      filledInMs: Math.min(Math.max(0, Math.round(Date.now() - openedAt.current)), 86_400_000),
    });
    if (outcome.kind === "invalid") {
      setServerFields(outcome.fields);
      const firstBad = ORDER.find((field) => outcome.fields.includes(field));
      if (firstBad) refs[firstBad].current?.focus();
    }
    setStatus(outcome.kind);
  };

  return (
    <AuthCard title={t("signUp.title")} wide>
      {status === "sent" ? (
        <InlineMessage variant="success" heading={t("paperSignup.sent.heading")} live iconLabel={t("message.success")}>
          {t("paperSignup.sent.body")}
        </InlineMessage>
      ) : (
        <section aria-labelledby="paper-signup-title">
          <Stack gap="4">
            <h2 id="paper-signup-title" className="pg-type-section-title">
              {t("paperSignup.formTitle")}
            </h2>
            <p>{t("paperSignup.lede")}</p>
            <form noValidate onSubmit={(event) => void submit(event)} aria-busy={status === "sending"}>
              <Stack gap="4">
                <Field
                  label={t("paperSignup.paperName")}
                  required
                  requiredLabel={t("form.required")}
                  errors={errorOf("paperName")}
                >
                  <TextInput
                    ref={refs.paperName}
                    name="organization"
                    autoComplete="organization"
                    maxLength={PAPER_SIGNUP_LIMITS.paperName}
                    value={values.paperName}
                    onChange={change("paperName")}
                  />
                </Field>
                <Field
                  label={t("paperSignup.ownerName")}
                  description={t("paperSignup.ownerNameHint")}
                  required
                  requiredLabel={t("form.required")}
                  errors={errorOf("ownerName")}
                >
                  <TextInput
                    ref={refs.ownerName}
                    name="name"
                    autoComplete="name"
                    maxLength={PAPER_SIGNUP_LIMITS.ownerName}
                    value={values.ownerName}
                    onChange={change("ownerName")}
                  />
                </Field>
                <Field
                  label={t("paperSignup.email")}
                  required
                  requiredLabel={t("form.required")}
                  errors={errorOf("email")}
                >
                  <TextInput
                    ref={refs.email}
                    type="email"
                    name="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    maxLength={PAPER_SIGNUP_LIMITS.email}
                    value={values.email}
                    onChange={change("email")}
                  />
                </Field>
                <RadioGroup
                  legend={t("paperSignup.language")}
                  name="language"
                  value={language}
                  onChange={(value) => setLanguage(value === "mr" ? "mr" : "en")}
                  options={LANGUAGES.map((value) => ({ value, label: LANGUAGE_NAMES[value] }))}
                />
                {/* the trap: people never see it, so it stays empty */}
                <div hidden>
                  <label>
                    {t("paperSignup.trap")}
                    <input
                      type="text"
                      name="website"
                      tabIndex={-1}
                      autoComplete="off"
                      value={trap}
                      onChange={(event) => setTrap(event.target.value)}
                    />
                  </label>
                </div>
                {status === "invalid" && (
                  <InlineMessage variant="error" heading={t("paperSignup.invalid")} live iconLabel={t("message.error")} />
                )}
                {status === "busy" && (
                  <InlineMessage
                    variant="warning"
                    heading={t("paperSignup.busy.heading")}
                    live
                    iconLabel={t("message.warning")}
                  >
                    {t("paperSignup.busy.body")}
                  </InlineMessage>
                )}
                {status === "failed" && (
                  <InlineMessage
                    variant="error"
                    heading={t("paperSignup.failed.heading")}
                    live
                    iconLabel={t("message.error")}
                  >
                    {t("paperSignup.failed.body")}
                  </InlineMessage>
                )}
                <div>
                  <Button type="submit" aria-disabled={status === "sending" || undefined}>
                    {status === "sending" ? t("paperSignup.sending") : t("paperSignup.submit")}
                  </Button>
                </div>
              </Stack>
            </form>
          </Stack>
        </section>
      )}
      <section aria-labelledby="paper-signup-joining">
        <Stack gap="2">
          <h2 id="paper-signup-joining" className="pg-type-section-title">
            {t("paperSignup.joining.title")}
          </h2>
          <p>{t("signUp.byInvitation")}</p>
        </Stack>
      </section>
      <p>
        {t("signUp.haveAccount")} <Link to={paths.login()}>{t("glossary.signIn")}</Link>
      </p>
    </AuthCard>
  );
}
