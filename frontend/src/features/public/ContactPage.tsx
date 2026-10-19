/**
 * `/contact` — a real form that sends nothing (§18).
 *
 * The form element carries no `action`, no `method` and no `target`, and its
 * submit handler calls `preventDefault()` as its first statement. There is
 * no fetch, XHR, beacon, socket, `mailto:` or storage write anywhere on this
 * page, and no displayed address — a real-looking address would imply a
 * channel that does not exist, and a fictional one would be an invented
 * claim.
 *
 * `noValidate` is set so the browser's own required-field handling cannot
 * pre-empt the local error path this page owns.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Button,
  Field,
  InlineMessage,
  TextArea,
  TextInput,
} from "../../ui/index.ts";
import { ROUTE_HEADING_ID } from "../../app/routes.ts";
import { t } from "./content.ts";
import { Section } from "./Section.tsx";
import { PrimaryCta } from "./PrimaryCta.tsx";
import { ClosingBand } from "./ClosingBand.tsx";

export function ContactPage() {
  const [name, setName] = useState("");
  const [organization, setOrganization] = useState("");
  const [reach, setReach] = useState("");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const acknowledgementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (acknowledged) acknowledgementRef.current?.focus();
  }, [acknowledged]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (message.trim() === "") {
      setErrors([t("contact-error-message-required")]);
      setAcknowledged(false);
      return;
    }

    // Nothing leaves this function. The values are dropped, not queued.
    setErrors([]);
    setName("");
    setOrganization("");
    setReach("");
    setMessage("");
    setAcknowledged(true);
  };

  return (
    <div className="pg-public">
      {/* Page title, lead, and the standing qualification */}
      <section className="pg-public__band">
        <div className="pg-public__measure">
          <h1
            id={ROUTE_HEADING_ID}
            tabIndex={-1}
            className="pg-public__page-title"
          >
            {t("contact-title")}
          </h1>
          <div className="pg-public__grid">
            <div className="pg-public__span-7">
              <p className="pg-public__lead">{t("contact-lead")}</p>
              <div className="pg-public__actions">
                <PrimaryCta />
              </div>
            </div>
            <div className="pg-public__span-5 pg-public__hero-aside">
              <p className="pg-public__note">{t("qualification-standing")}</p>
            </div>
          </div>
        </div>
      </section>

      {/* The form */}
      <Section
        label={t("contact-form-standing")}
        title={t("contact-form-title")}
      >
        <p className="pg-public__body">{t("contact-qualification")}</p>

        <form className="pg-public__form" noValidate onSubmit={handleSubmit}>
          <Field
            label={t("contact-label-name")}
            description={t("contact-description-optional")}
          >
            <TextInput
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>

          <Field label={t("contact-label-organization")}>
            <TextInput
              value={organization}
              onChange={(event) => setOrganization(event.target.value)}
            />
          </Field>

          {/*
           * Deliberately type="text", not type="email": nothing here is
           * collected, so nothing should be presented as an address field.
           */}
          <Field
            label={t("contact-label-reach")}
            description={t("contact-description-optional")}
          >
            <TextInput
              type="text"
              value={reach}
              onChange={(event) => setReach(event.target.value)}
            />
          </Field>

          <Field
            label={t("contact-label-message")}
            description={t("contact-description-message")}
            required
            errors={errors}
          >
            <TextArea
              rows={6}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
          </Field>

          <div>
            <Button type="submit">{t("contact-submit")}</Button>
          </div>
        </form>

        {acknowledged && (
          <div ref={acknowledgementRef} tabIndex={-1}>
            <InlineMessage
              variant="info"
              heading={t("contact-acknowledgement-heading")}
              live
            >
              {t("contact-acknowledgement-body")}
            </InlineMessage>
          </div>
        )}
      </Section>

      <ClosingBand />
    </div>
  );
}
