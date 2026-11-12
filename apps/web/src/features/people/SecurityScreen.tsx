/**
 * Account → Security, /account/security (03 §5.2; plan §10 PR 14, §4.4–4.5):
 *   - two-step sign-in with an authenticator app: set up with a QR code (and its key as text), confirmed with the
 *     app's first code, which also signs the account out on every other device (said before and after);
 *   - backup codes, shown once, and new ones on request;
 *   - turning two-step off, warned when an organisation's rule needs it;
 *   - the browsers where the account is signed in, each with its own Sign out, and Sign out on every other device.
 * Each change asks for the password again.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Navigate } from "react-router";
import {
  Badge,
  Button,
  Cluster,
  Container,
  Field,
  Icon,
  InlineMessage,
  PageHeader,
  Panel,
  ProgressIndicator,
  Stack,
  TextInput,
} from "../../ui/index.ts";
import { paths, ROUTE_HEADING_ID } from "../../app/routes.ts";
import { formatDateTime } from "../../i18n/dates.ts";
import { useI18n } from "../../i18n/index.ts";
import type { ApiProblem, DeviceDto } from "../../services/index.ts";
import { OfflineNotice } from "../auth/connection.tsx";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";
import { useSession } from "../auth/SessionProvider.tsx";
import { SessionFailure } from "../auth/SessionStatus.tsx";
import { describeDevice } from "./devices.ts";
import { QrCode, totpKey } from "./QrCode.tsx";
import { useSecurity } from "./services-context.tsx";
import "../auth/auth.css";
import "./people.css";

type Answer = { readonly problem: ApiProblem } | null;

/** The password again, for one change. A wrong one is said on the field. */
function PasswordStep({
  intro,
  warning,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  readonly intro?: string;
  readonly warning?: string;
  readonly submitLabel: string;
  readonly onSubmit: (password: string) => Promise<Answer>;
  readonly onCancel: () => void;
}) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [wrong, setWrong] = useState(false);
  const [missing, setMissing] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [pending, setPending] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus(), []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setWrong(false);
    setProblem(null);
    setMissing(password === "");
    if (password === "") return field.current?.focus();
    setPending(true);
    const answer = await onSubmit(password);
    setPending(false);
    if (!answer) return;
    if (answer.problem.kind === "answer" && answer.problem.code === "INVALID_PASSWORD") {
      setWrong(true);
      setPassword("");
      return field.current?.focus();
    }
    setProblem(answer.problem);
  };

  const errors = wrong ? [t("security.wrongPassword")] : missing ? [t("validation.passwordMissing")] : [];
  return (
    <Stack gap="4">
      {warning && (
        <InlineMessage variant="warning" heading={warning} iconLabel={t("message.warning")} />
      )}
      {intro && <p>{intro}</p>}
      {problem && <ProblemMessage problem={problem} />}
      <form noValidate onSubmit={submit} aria-busy={pending}>
        <Stack gap="4">
          <Field label={t("security.password")} description={t("security.passwordHint")} errors={errors}>
            <TextInput
              ref={field}
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Cluster gap="3">
            <Button type="submit">{submitLabel}</Button>
            <Button variant="secondary" onClick={onCancel}>
              {t("security.cancel")}
            </Button>
          </Cluster>
        </Stack>
      </form>
    </Stack>
  );
}

function BackupCodes({ codes }: { readonly codes: readonly string[] }) {
  const { t } = useI18n();
  return (
    <Stack gap="3">
      <h3 className="pg-people-step__title">{t("security.backup.heading")}</h3>
      <p className="pg-people-muted">{t("security.backup.body")}</p>
      <ul className="pg-people-codes" lang="en">
        {codes.map((code) => (
          <li key={code}>
            <code className="pg-type-code">{code}</code>
          </li>
        ))}
      </ul>
    </Stack>
  );
}

type TwoStepMode =
  | { readonly step: "idle"; readonly notice?: "on" | "off" | "codes"; readonly codes?: readonly string[] }
  | { readonly step: "password-on" }
  | { readonly step: "setup"; readonly totpUri: string; readonly codes: readonly string[] }
  | { readonly step: "password-codes" }
  | { readonly step: "password-off" };

function TwoStepSection({
  enabled,
  requiredBy,
  onEnrolled,
}: {
  readonly enabled: boolean;
  readonly requiredBy: readonly string[];
  /** Turning two-step on ended every other session: the devices list reads them again. */
  readonly onEnrolled: () => void;
}) {
  const security = useSecurity();
  const { refresh } = useSession();
  const { t, language } = useI18n();
  const [mode, setMode] = useState<TwoStepMode>({ step: "idle" });
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<"validation.codeMissing" | "mfa.wrong.heading" | undefined>();
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [pending, setPending] = useState(false);
  const codeField = useRef<HTMLInputElement>(null);
  const required = requiredBy.length > 0;
  const organizations = new Intl.ListFormat(language, { type: "conjunction" }).format(requiredBy);

  const confirm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || mode.step !== "setup") return;
    const entered = code.replace(/\s/g, "");
    setProblem(null);
    if (!/^\d{6}$/.test(entered)) {
      setCodeError("validation.codeMissing");
      return codeField.current?.focus();
    }
    setPending(true);
    const result = await security.confirmTwoStep({ code: entered });
    setPending(false);
    if (result.ok) {
      setCode("");
      setCodeError(undefined);
      setMode({ step: "idle", notice: "on", codes: mode.codes });
      void refresh(); // the session was replaced, with two-step; the other sessions are gone
      onEnrolled();
      return;
    }
    if (result.error.kind === "answer" && result.error.code === "INVALID_CODE") {
      setCodeError("mfa.wrong.heading");
      setCode("");
      return codeField.current?.focus();
    }
    setProblem(result.error);
  };

  return (
    <Panel
      title={t("security.twoStep.heading")}
      actions={
        enabled ? (
          <Badge tone="success" icon="shield-check">
            {t("security.twoStep.badgeOn")}
          </Badge>
        ) : (
          <Badge tone="warning" icon="triangle-alert">
            {t("security.twoStep.badgeOff")}
          </Badge>
        )
      }
    >
      <Stack gap="4">
        <div aria-live="polite">
          {mode.step === "idle" && mode.notice === "on" && (
            <InlineMessage variant="success" heading={t("security.on.done")} iconLabel={t("message.success")} />
          )}
          {mode.step === "idle" && mode.notice === "off" && (
            <InlineMessage variant="success" heading={t("security.turnOff.done")} iconLabel={t("message.success")} />
          )}
          {mode.step === "idle" && mode.notice === "codes" && (
            <InlineMessage variant="success" heading={t("security.newCodes.done")} iconLabel={t("message.success")} />
          )}
        </div>
        <p className="pg-people-muted">{enabled ? t("security.twoStep.on") : t("security.twoStep.off")}</p>
        {required && !enabled && (
          <InlineMessage
            variant="warning"
            heading={t("security.twoStep.required", { organization: organizations })}
            iconLabel={t("message.warning")}
          />
        )}
        {mode.step === "idle" && mode.codes && <BackupCodes codes={mode.codes} />}

        {mode.step === "idle" && !enabled && (
          <div>
            <Button onClick={() => setMode({ step: "password-on" })}>{t("security.turnOn")}</Button>
          </div>
        )}
        {mode.step === "idle" && enabled && (
          <Cluster gap="3">
            <Button variant="secondary" onClick={() => setMode({ step: "password-codes" })}>
              {t("security.newCodes")}
            </Button>
            <Button variant="danger" onClick={() => setMode({ step: "password-off" })}>
              {t("security.turnOff")}
            </Button>
          </Cluster>
        )}

        {mode.step === "password-on" && (
          <PasswordStep
            warning={t("security.turnOn.warning")}
            submitLabel={t("security.continue")}
            onCancel={() => setMode({ step: "idle" })}
            onSubmit={async (password) => {
              const result = await security.startTwoStep({ password });
              if (!result.ok) return { problem: result.error };
              setMode({ step: "setup", totpUri: result.value.totpUri, codes: result.value.backupCodes });
              return null;
            }}
          />
        )}

        {mode.step === "setup" && (
          <Stack gap="4">
            <InlineMessage variant="warning" heading={t("security.turnOn.warning")} iconLabel={t("message.warning")} />
            <ol className="pg-people-steps">
              <li className="pg-people-step">
                <h3 className="pg-people-step__title">{t("security.scan.heading")}</h3>
                <div className="pg-people-scan">
                  <QrCode text={mode.totpUri} label={t("security.scan.qr")} />
                  <p className="pg-people-muted">{t("security.scan.key", { key: totpKey(mode.totpUri) })}</p>
                </div>
              </li>
              <li className="pg-people-step">
                <BackupCodes codes={mode.codes} />
              </li>
              <li className="pg-people-step">
                <h3 className="pg-people-step__title">{t("security.step.confirm")}</h3>
                {problem && <ProblemMessage problem={problem} />}
                <form noValidate onSubmit={confirm} aria-busy={pending}>
                  <Stack gap="4">
                    <Field label={t("mfa.code")} errors={codeError ? [t(codeError)] : []} className="pg-people-code-field">
                      <TextInput
                        ref={codeField}
                        name="code"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        value={code}
                        onChange={(event) => setCode(event.target.value)}
                      />
                    </Field>
                    <Cluster gap="3">
                      <Button type="submit">
                        {pending ? t("security.confirm.submitting") : t("security.confirm.submit")}
                      </Button>
                      <Button variant="secondary" onClick={() => setMode({ step: "idle" })}>
                        {t("security.cancel")}
                      </Button>
                    </Cluster>
                  </Stack>
                </form>
              </li>
            </ol>
          </Stack>
        )}

        {mode.step === "password-codes" && (
          <PasswordStep
            submitLabel={t("security.newCodes")}
            onCancel={() => setMode({ step: "idle" })}
            onSubmit={async (password) => {
              const result = await security.newBackupCodes({ password });
              if (!result.ok) return { problem: result.error };
              setMode({ step: "idle", notice: "codes", codes: result.value });
              return null;
            }}
          />
        )}

        {mode.step === "password-off" && (
          <PasswordStep
            warning={
              required
                ? `${t("security.turnOff.warning")} ${t("security.twoStep.required", { organization: organizations })}`
                : t("security.turnOff.warning")
            }
            submitLabel={t("security.turnOff")}
            onCancel={() => setMode({ step: "idle" })}
            onSubmit={async (password) => {
              const result = await security.turnOffTwoStep({ password });
              if (!result.ok) return { problem: result.error };
              setMode({ step: "idle", notice: "off" });
              void refresh();
              return null;
            }}
          />
        )}
      </Stack>
    </Panel>
  );
}

function deviceName(device: DeviceDto, t: ReturnType<typeof useI18n>["t"]): string {
  const { browser, system } = describeDevice(device.userAgent);
  return t("security.devices.device", {
    browser: browser ?? t("security.devices.unknownBrowser"),
    system: system ?? t("security.devices.unknownSystem"),
  });
}

function DevicesSection({ revision }: { readonly revision: number }) {
  const security = useSecurity();
  const { t, language } = useI18n();
  const [devices, setDevices] = useState<readonly DeviceDto[] | null>(null);
  const [problem, setProblem] = useState<{ readonly problem: ApiProblem; readonly live: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const load = useCallback(
    async (live: boolean) => {
      setProblem(null);
      const result = await security.listDevices();
      if (result.ok) setDevices(result.value);
      else setProblem({ problem: result.error, live });
    },
    [security],
  );
  useEffect(() => {
    void load(revision > 0);
  }, [load, revision]);

  const signOut = async (device: DeviceDto | "others") => {
    if (pending) return;
    setNotice(null);
    setPending(device === "others" ? "others" : device.token);
    const result =
      device === "others" ? await security.signOutOtherDevices() : await security.signOutDevice({ token: device.token });
    setPending(null);
    if (!result.ok) {
      setProblem({ problem: result.error, live: true });
      return;
    }
    setNotice(
      device === "others"
        ? t("security.devices.othersSignedOut")
        : t("security.devices.signedOut", { device: deviceName(device, t) }),
    );
    await load(true);
  };

  const others = devices?.filter((device) => !device.current) ?? [];
  return (
    <Panel
      title={t("security.devices.heading")}
      flush
      actions={
        others.length > 0 ? (
          <Button variant="danger" size="sm" onClick={() => void signOut("others")}>
            {t("security.devices.signOutOthers")}
          </Button>
        ) : undefined
      }
    >
      <div aria-live="polite">
        {notice && (
          <div className="pg-people-panel-pad">
            <InlineMessage variant="success" heading={notice} iconLabel={t("message.success")} />
          </div>
        )}
      </div>
      {problem && (
        <Stack gap="3" className="pg-people-panel-pad">
          <ProblemMessage problem={problem.problem} live={problem.live} />
          {!devices && (
            <div>
              <Button variant="secondary" onClick={() => void load(true)}>
                {t("form.retry")}
              </Button>
            </div>
          )}
        </Stack>
      )}
      {!devices && !problem && (
        <div className="pg-people-panel-pad">
          <ProgressIndicator role="status" label={t("security.devices.loading")} />
        </div>
      )}
      {devices && (
        <ul className="pg-people-devices">
          {devices.map((device) => {
            const name = deviceName(device, t);
            return (
              <li key={device.id} className="pg-people-device">
                <span className="pg-people-device__icon">
                  <Icon name="globe" size={20} />
                </span>
                <div className="pg-people-device__text">
                  <p className="pg-people-device__name">
                    <strong>{name}</strong>
                    {device.current && (
                      <Badge tone="success" icon="circle-check">
                        {t("security.devices.thisDevice")}
                      </Badge>
                    )}
                  </p>
                  <p className="pg-people-device__meta">
                    <span>{t("security.devices.signedInAt", { date: formatDateTime(device.signedInAt, language) })}</span>
                    <span>{t("security.devices.lastActive", { date: formatDateTime(device.lastActiveAt, language) })}</span>
                    {device.ipAddress && <span>{t("security.devices.address", { address: device.ipAddress })}</span>}
                  </p>
                </div>
                {!device.current && (
                  <Button variant="secondary" size="sm" onClick={() => void signOut(device)}>
                    {t("security.devices.signOut", { device: name })}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {devices && others.length === 0 && <p className="pg-people-panel-foot pg-people-muted">{t("security.devices.none")}</p>}
    </Panel>
  );
}

export function SecurityScreen() {
  const { state } = useSession();
  const { t } = useI18n();
  const [devicesRevision, setDevicesRevision] = useState(0);
  if (state.status === "signed-out") {
    return <Navigate replace to={`${paths.login()}?returnTo=${encodeURIComponent(paths.accountSecurity())}`} />;
  }
  if (state.status === "unavailable") {
    // the session or /me could not be read: why, with Retry (and Sign out)
    return (
      <Container>
        <SessionFailure />
      </Container>
    );
  }
  if (state.status !== "ready") {
    return (
      <SecurityPage>
        <ProgressIndicator role="status" label={t("security.loading")} />
      </SecurityPage>
    );
  }
  const requiredBy =
    state.workspace?.organizations.filter((org) => org.twoStep.required).map((org) => org.org.name) ?? [];
  return (
    <SecurityPage>
      <OfflineNotice />
      <TwoStepSection
        enabled={state.session.user.twoFactorEnabled}
        requiredBy={requiredBy}
        onEnrolled={() => setDevicesRevision((count) => count + 1)}
      />
      <DevicesSection revision={devicesRevision} />
    </SecurityPage>
  );
}

/** The account's settings in one column (720–880 px), under the page header. */
function SecurityPage({ children }: { readonly children: ReactNode }) {
  const { t } = useI18n();
  return (
    <Stack gap="5" className="pg-people pg-people-account">
      <PageHeader title={t("security.title")} headingId={ROUTE_HEADING_ID} subtitle={t("security.subtitle")} />
      {children}
    </Stack>
  );
}
