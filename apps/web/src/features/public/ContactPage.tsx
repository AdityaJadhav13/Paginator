/**
 * `/contact` (03 §4.2): the contact form, which sends (POST /api/v1/contact, through the contact service).
 *
 *   - `?intent=demo|pilot|press|other` presets what the person wants; "demo" otherwise.
 *   - The fields are checked as the API checks them (@pageinator/contracts ContactRequest): after a first try, each
 *     problem shows under its field, in the page's language, and goes away as it is fixed; focus moves to the first.
 *   - A phone number written in Devanagari digits is sent in ASCII digits, which the API accepts.
 *   - A trap field, hidden from people and from assistive technology, stays empty; the time since the form was
 *     opened goes with the message (the API drops a message filled in faster than a person could).
 *   - The form is shown only when the API says it is connected (GET /api/v1/contact); otherwise the page says the form
 *     is not connected (or could not be reached), with no form that would fail on Send.
 *   - A message goes no sooner than the API's minimum fill time after the form opened (the contact service waits out
 *     the rest, while the page says "Sending…"), so a person who is quick is never dropped as a program.
 *   - Sent: a confirmation that takes focus. Not sent: a plain message for each reason, and what was typed stays.
 */
import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { useSearchParams } from "react-router";
import {
  CONTACT_INTENTS,
  CONTACT_LIMITS,
  ContactRequest,
  type ContactIntent,
} from "@pageinator/contracts";
import { Button, Field, InlineMessage, RadioGroup, TextArea, TextInput } from "../../ui/index.ts";
import { ROUTE_HEADING_ID } from "../../app/routes.ts";
import { useI18n } from "../../i18n/index.ts";
import { Section } from "./Section.tsx";
import { useContact, useContactConnection } from "../contact/contact-context.tsx";
import { usePublicText } from "./usePublicText.ts";

type FieldName = "name" | "newspaper" | "city" | "phone" | "email" | "message";
type Values = Record<FieldName, string>;
type Errors = Partial<Record<FieldName, string>>;
type Status = "editing" | "sending" | "sent" | "unavailable" | "sendFailed" | "busy" | "refused" | "failed" | "invalid";

const EMPTY: Values = { name: "", newspaper: "", city: "", phone: "", email: "", message: "" };
const FIELD_ORDER: readonly FieldName[] = ["name", "newspaper", "city", "phone", "email", "message"];

function intentOf(value: string | null): ContactIntent {
  return (CONTACT_INTENTS as readonly string[]).includes(value ?? "") ? (value as ContactIntent) : "demo";
}

/** ०–९ to 0–9, so a number typed with a Marathi keyboard is accepted. */
function asciiDigits(text: string): string {
  return text.replace(/[०-९]/g, (digit) => String(digit.charCodeAt(0) - 0x0966));
}

/** The content-record id of the message for a field's problem (`tooLong`: the check said it is longer than allowed). */
function problemId(field: FieldName, values: Values, tooLong = false): string {
  if (tooLong) return "contact-error-too-long";
  switch (field) {
    case "name":
      return values.name.trim() === "" ? "contact-error-name" : "contact-error-line";
    case "phone":
      return "contact-error-phone";
    case "email":
      return values.email.trim() === "" && values.phone.trim() === "" ? "contact-error-reach" : "contact-error-email";
    case "message":
      return "contact-error-text";
    default:
      return "contact-error-line";
  }
}

function isField(name: unknown): name is FieldName {
  return typeof name === "string" && (FIELD_ORDER as readonly string[]).includes(name);
}

export function ContactPage() {
  const { t, language } = usePublicText();
  const i18n = useI18n();
  const contact = useContact();
  const connection = useContactConnection();
  const [params] = useSearchParams();
  const [intent, setIntent] = useState<ContactIntent>(() => intentOf(params.get("intent")));
  const [values, setValues] = useState<Values>(EMPTY);
  const [trap, setTrap] = useState("");
  const [tried, setTried] = useState(false);
  const [status, setStatus] = useState<Status>("editing");
  const [serverFields, setServerFields] = useState<readonly FieldName[]>([]);
  const openedAt = useRef(Date.now());
  const outcomeRef = useRef<HTMLDivElement>(null);
  const refs: Record<FieldName, RefObject<HTMLInputElement | HTMLTextAreaElement | null>> = {
    name: useRef<HTMLInputElement>(null),
    newspaper: useRef<HTMLInputElement>(null),
    city: useRef<HTMLInputElement>(null),
    phone: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
    message: useRef<HTMLTextAreaElement>(null),
  };

  // the link's intent wins when the address changes (a "Book a demo" from the header while on this page)
  const linkIntent = params.get("intent");
  useEffect(() => {
    if (linkIntent !== null) setIntent(intentOf(linkIntent));
  }, [linkIntent]);

  useEffect(() => {
    if (status !== "editing" && status !== "sending" && status !== "invalid") outcomeRef.current?.focus();
  }, [status]);

  const request = (): ContactRequest => ({
    name: values.name,
    newspaper: values.newspaper,
    city: values.city,
    phone: asciiDigits(values.phone),
    email: values.email,
    message: values.message,
    intent,
    language,
    website: trap,
    filledInMs: Math.min(Math.max(0, Math.round(Date.now() - openedAt.current)), 86_400_000),
  });

  const errorsOf = (current: Values): Errors => {
    const checked = ContactRequest.safeParse({ ...request(), ...current, phone: asciiDigits(current.phone) });
    const errors: Errors = {};
    if (!checked.success) {
      for (const issue of checked.error.issues) {
        const field = issue.path[0];
        if (isField(field) && !errors[field]) errors[field] = t(problemId(field, current, issue.code === "too_big"));
      }
    }
    for (const field of serverFields) errors[field] ??= t(problemId(field, current));
    return errors;
  };

  const errors = tried ? errorsOf(values) : {};

  const change = (field: FieldName) => (event: { target: { value: string } }) => {
    setValues((previous) => ({ ...previous, [field]: event.target.value }));
    setServerFields((previous) => previous.filter((name) => name !== field));
    if (status !== "sending") setStatus("editing");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status === "sending") return;
    setTried(true);
    const found = errorsOf(values);
    const first = FIELD_ORDER.find((field) => found[field]);
    if (first) {
      refs[first].current?.focus();
      return;
    }
    setStatus("sending");
    const outcome = await contact.send(request());
    if (outcome.kind === "invalid") {
      const fields = outcome.fields.filter(isField);
      // only a field the person cannot see was refused (intent, language, the trap, the time): nothing to fix here
      if (fields.length === 0) {
        setStatus("refused");
        return;
      }
      setServerFields(fields);
      setStatus("invalid");
      const firstBad = FIELD_ORDER.find((field) => fields.includes(field));
      if (firstBad) refs[firstBad].current?.focus();
      return;
    }
    if (outcome.kind === "sent") {
      setValues(EMPTY);
      setTried(false);
    }
    setStatus(outcome.kind);
  };

  const again = () => {
    openedAt.current = Date.now();
    setStatus("editing");
    window.setTimeout(() => refs.name.current?.focus(), 0);
  };

  const fieldErrors = (field: FieldName) => (errors[field] ? [errors[field]] : []);
  const requiredLabel = t("contact-required");
  const notSent = {
    unavailable: ["contact-unavailable-heading", "contact-unavailable-body"],
    sendFailed: ["contact-down-heading", "contact-down-body"],
    busy: ["contact-busy-heading", "contact-busy-body"],
    refused: ["contact-refused-heading", "contact-refused-body"],
    failed: ["contact-failed-heading", "contact-failed-body"],
  } as const;
  const notSentStatus = status in notSent ? (status as keyof typeof notSent) : null;

  const intro = (
    <section className="pg-public__band">
      <div className="pg-public__measure">
        <h1 id={ROUTE_HEADING_ID} tabIndex={-1} className="pg-public__page-title">
          {t("contact-title")}
        </h1>
        <p className="pg-public__lead">{t("contact-lead")}</p>
        {connection === "connected" && <p className="pg-public__body">{t("contact-connected")}</p>}
      </div>
    </section>
  );

  // no form, so no "Tell us about your paper" heading over an empty section: only what is true now
  if (connection !== "connected") {
    return (
      <div className="pg-public">
        {intro}
        <section className="pg-public__band">
          <div className="pg-public__measure">
            <div className="pg-public__prose">
              {connection === "checking" ? (
                <p className="pg-public__body" role="status">
                  {t("contact-checking")}
                </p>
              ) : (
                <InlineMessage
                  variant={connection === "unknown" ? "error" : "info"}
                  heading={t(connection === "unknown" ? "contact-unknown-heading" : "contact-unavailable-heading")}
                  iconLabel={i18n.t(connection === "unknown" ? "message.error" : "message.info")}
                >
                  {t(connection === "unknown" ? "contact-unknown-body" : "contact-off-body")}
                </InlineMessage>
              )}
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="pg-public">
      {intro}
      <Section label={t("contact-form-standing")} title={t("contact-form-title")}>
        {status === "sent" ? (
          <div ref={outcomeRef} tabIndex={-1} className="pg-public__outcome">
            <InlineMessage
              variant="success"
              heading={t("contact-sent-heading")}
              live
              iconLabel={i18n.t("message.success")}
            >
              {t("contact-sent-body")}
            </InlineMessage>
            <div>
              <Button variant="secondary" onClick={again}>
                {t("contact-send-another")}
              </Button>
            </div>
          </div>
        ) : (
          <form className="pg-public__form" noValidate onSubmit={(event) => void handleSubmit(event)}>
            <RadioGroup
              legend={t("contact-intent-legend")}
              name="intent"
              value={intent}
              onChange={(value) => setIntent(intentOf(value))}
              options={CONTACT_INTENTS.map((value) => ({ value, label: t(`contact-intent-${value}`) }))}
            />

            <Field label={t("contact-label-name")} required requiredLabel={requiredLabel} errors={fieldErrors("name")}>
              <TextInput
                ref={refs.name as RefObject<HTMLInputElement>}
                name="name"
                autoComplete="name"
                maxLength={CONTACT_LIMITS.name}
                value={values.name}
                onChange={change("name")}
              />
            </Field>

            <div className="pg-public__form-row">
              <Field label={t("contact-label-newspaper")} errors={fieldErrors("newspaper")}>
                <TextInput
                  ref={refs.newspaper as RefObject<HTMLInputElement>}
                  name="organization"
                  autoComplete="organization"
                  maxLength={CONTACT_LIMITS.newspaper}
                  value={values.newspaper}
                  onChange={change("newspaper")}
                />
              </Field>
              <Field label={t("contact-label-city")} errors={fieldErrors("city")}>
                <TextInput
                  ref={refs.city as RefObject<HTMLInputElement>}
                  name="city"
                  autoComplete="address-level2"
                  maxLength={CONTACT_LIMITS.city}
                  value={values.city}
                  onChange={change("city")}
                />
              </Field>
            </div>

            <p className="pg-public__body pg-public__form-hint">
              {t("contact-hint-reach")}
            </p>
            <div className="pg-public__form-row">
              <Field label={t("contact-label-phone")} errors={fieldErrors("phone")}>
                <TextInput
                  ref={refs.phone as RefObject<HTMLInputElement>}
                  type="tel"
                  name="phone"
                  autoComplete="tel"
                  inputMode="tel"
                  maxLength={CONTACT_LIMITS.phone}
                  value={values.phone}
                  onChange={change("phone")}
                />
              </Field>
              <Field label={t("contact-label-email")} errors={fieldErrors("email")}>
                <TextInput
                  ref={refs.email as RefObject<HTMLInputElement>}
                  type="email"
                  name="email"
                  autoComplete="email"
                  maxLength={CONTACT_LIMITS.email}
                  value={values.email}
                  onChange={change("email")}
                />
              </Field>
            </div>

            <Field label={t("contact-label-message")} description={t("contact-hint-message")} errors={fieldErrors("message")}>
              <TextArea
                ref={refs.message as RefObject<HTMLTextAreaElement>}
                name="message"
                rows={6}
                maxLength={CONTACT_LIMITS.message}
                value={values.message}
                onChange={change("message")}
              />
            </Field>

            {/* the trap: people never see it, so it stays empty */}
            <div className="pg-public__trap" hidden>
              <label>
                {t("contact-label-trap")}
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
              <InlineMessage variant="error" heading={t("contact-invalid-heading")} live iconLabel={i18n.t("message.error")} />
            )}
            {notSentStatus && (
              <div ref={outcomeRef} tabIndex={-1} className="pg-public__outcome">
                <InlineMessage
                  variant={notSentStatus === "busy" || notSentStatus === "unavailable" ? "warning" : "error"}
                  heading={t(notSent[notSentStatus][0])}
                  live
                  iconLabel={i18n.t(notSentStatus === "busy" || notSentStatus === "unavailable" ? "message.warning" : "message.error")}
                >
                  {t(notSent[notSentStatus][1])}
                </InlineMessage>
              </div>
            )}

            <p className="pg-public__note pg-public__privacy">{t("contact-privacy")}</p>
            <div>
              <Button type="submit" aria-disabled={status === "sending" || undefined}>
                {status === "sending" ? t("contact-sending") : t("contact-submit")}
              </Button>
            </div>
          </form>
        )}
      </Section>
    </div>
  );
}
