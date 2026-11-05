/**
 * A publication's name, languages, primary language and timezone (@pageinator/contracts settings.ts): the form the
 * "Add publication" panel and the publication settings screen share. Checked here as the API checks it (a name, at
 * least one language, the primary among them); the API's own refusal is shown under the form.
 */
import { useState, type FormEvent } from "react";
import { Button, Checkbox, Field, Select, Stack, TextInput } from "../../ui/index.ts";
import { useI18n, type PlainKey } from "../../i18n/index.ts";
import type { ApiProblem, ServiceResult } from "../../services/index.ts";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";

export interface PublicationValues {
  readonly name: string;
  readonly languages: readonly string[];
  readonly primaryLanguage: string;
  readonly timezone: string;
}

/** The languages a publication is offered (the interface's own); any other it already has stays listed. */
const OFFERED = ["mr", "en"] as const;
const LANGUAGE_NAMES: Readonly<Record<string, PlainKey>> = { mr: "settings.language.mr", en: "settings.language.en" };

/** The browser's (ICU's) old names that the database's time zone list (pg_timezone_names) knows only by their
 * current names: offered under the current name, which the API accepts. */
const CURRENT_NAME: Readonly<Record<string, string>> = {
  "Africa/Asmera": "Africa/Asmara",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Catamarca": "America/Argentina/Catamarca",
  "America/Cordoba": "America/Argentina/Cordoba",
  "America/Godthab": "America/Nuuk",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Jujuy": "America/Argentina/Jujuy",
  "America/Louisville": "America/Kentucky/Louisville",
  "America/Mendoza": "America/Argentina/Mendoza",
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Europe/Kiev": "Europe/Kyiv",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Truk": "Pacific/Chuuk",
};

export function timezones(current: string): string[] {
  const known = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const names = known.map((zone) => CURRENT_NAME[zone] ?? zone);
  return [...new Set(names.includes(current) ? names : [current, ...names])];
}

export function PublicationForm({
  initial,
  edit,
  submitLabel,
  pendingLabel,
  doneLabel,
  onSubmit,
}: {
  readonly initial: PublicationValues;
  readonly edit: boolean;
  readonly submitLabel: string;
  readonly pendingLabel: string;
  /** Said once a save went through (its result's name filled in). */
  readonly doneLabel: (name: string) => string;
  /** The save; on success the form shows `doneLabel`, and takes `reset` as its new values. */
  readonly onSubmit: (values: PublicationValues) => Promise<ServiceResult<{ readonly reset: PublicationValues; readonly name: string }, ApiProblem>>;
}) {
  const { t } = useI18n();
  const [values, setValues] = useState(initial);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [errors, setErrors] = useState({ name: false, languages: false });
  const set = (change: Partial<PublicationValues>) => {
    setDone(null);
    setValues((now) => ({ ...now, ...change }));
  };
  const offered = [...OFFERED, ...values.languages.filter((code) => !(OFFERED as readonly string[]).includes(code))];
  const languageName = (code: string) => (LANGUAGE_NAMES[code] ? t(LANGUAGE_NAMES[code]) : code);

  const toggle = (code: string, on: boolean) => {
    const languages = on ? [...values.languages, code] : values.languages.filter((other) => other !== code);
    // the primary stays among the languages: the first one left takes its place
    const primaryLanguage = languages.includes(values.primaryLanguage) ? values.primaryLanguage : (languages[0] ?? "");
    set({ languages, primaryLanguage });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setProblem(null);
    const wrong = { name: values.name.trim() === "", languages: values.languages.length === 0 };
    setErrors(wrong);
    if (wrong.name || wrong.languages) return;
    setPending(true);
    const result = await onSubmit(values);
    setPending(false);
    if (!result.ok) return setProblem(result.error);
    setValues(result.value.reset);
    setDone(doneLabel(result.value.name));
  };

  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      <Stack gap="4">
        <Field
          label={t("settings.pub.name")}
          required
          requiredLabel={t("form.required")}
          {...(errors.name ? { errors: [t("settings.name.required")] } : {})}
        >
          <TextInput value={values.name} maxLength={200} disabled={!edit} onChange={(event) => set({ name: event.target.value })} />
        </Field>
        <fieldset className="pg-settings__languages" disabled={!edit}>
          <legend>{t("settings.pub.languages")}</legend>
          <Stack gap="2">
            <p className="pg-type-body-small">{t("settings.pub.languages.hint")}</p>
            {offered.map((code) => (
              <Checkbox
                key={code}
                label={languageName(code)}
                checked={values.languages.includes(code)}
                onChange={(event) => toggle(code, event.target.checked)}
              />
            ))}
            {errors.languages && <p className="pg-settings__error">{t("settings.pub.languages.required")}</p>}
          </Stack>
        </fieldset>
        <Field label={t("settings.pub.primary")}>
          <Select
            value={values.primaryLanguage}
            disabled={!edit || values.languages.length === 0}
            onChange={(event) => set({ primaryLanguage: event.target.value })}
          >
            {values.languages.map((code) => (
              <option key={code} value={code}>
                {languageName(code)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("settings.pub.timezone")} description={t("settings.pub.timezone.hint")}>
          <Select value={values.timezone} disabled={!edit} onChange={(event) => set({ timezone: event.target.value })}>
            {timezones(values.timezone).map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </Select>
        </Field>
        {edit && (
          <div>
            <Button type="submit" variant="primary" disabled={pending} aria-busy={pending}>
              {pending ? pendingLabel : submitLabel}
            </Button>
          </div>
        )}
        <div aria-live="polite">{done && <p>{done}</p>}</div>
        {problem && <ProblemMessage problem={problem} />}
      </Stack>
    </form>
  );
}
