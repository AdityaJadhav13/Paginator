/**
 * The engine profile, /org/:orgId/pub/:pubId/engine-profile (plan §1 L2.3): the paper's dataset bundle and the config
 * the engine set up from it (GET …/engine-profiles, settings.view). Shows the profile in use (its version, dataset
 * SHA-256 and size, engine version, templates, grid), a newer one still setting up or failed (in the Desk's or the
 * engine's words), and the earlier versions. Whoever may change the settings (settings.edit) uploads a new bundle: a
 * ZIP of at most 4 GiB, sent straight to the store with its progress (POST …/uploads, purpose engine_dataset), then
 * made a profile (POST …/engine-profiles, an Idempotency-Key kept for a retry). A live `profile` update, a `resync` or,
 * while one is setting up, a fetch every 3 s shows when the engine is done. Below it, the publication's sections
 * (SectionsPanel).
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useParams } from "react-router";
import { DATASET_TYPE, MAX_DATASET_BYTES } from "@pageinator/contracts";
import {
  Badge,
  Button,
  Cluster,
  EmptyState,
  Field,
  InlineMessage,
  PageHeader,
  Panel,
  ProgressIndicator,
  Stack,
  Table,
  TableCell,
  TableHeader,
} from "../../ui/index.ts";
import { ROUTE_HEADING_ID } from "../../app/routes.ts";
import { randomUuid } from "../../api/client.ts";
import { formatDateTime } from "../../i18n/dates.ts";
import { useI18n, type PlainKey, type Translate } from "../../i18n/index.ts";
import type { ApiProblem, EngineProfileDto, EngineProfileListDto } from "../../services/index.ts";
import { OfflineNotice } from "../auth/connection.tsx";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";
import { useSession } from "../auth/SessionProvider.tsx";
import { useLiveEvents } from "../live/live-context.tsx";
import { fileName } from "../media/upload.tsx";
import { useMedia } from "../stories/media-context.tsx";
import { layoutAccess } from "./access.ts";
import { DeskWords } from "./desk-text.tsx";
import { useLayout } from "./layout-context.tsx";
import { POLL_MS } from "./EditionLayoutScreen.tsx";
import { SectionsPanel } from "./SectionsPanel.tsx";
import { OnboardingPanel } from "../onboarding/OnboardingPanel.tsx";
import "./layout.css";

type Load =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly problem: ApiProblem; readonly live: boolean }
  | { readonly status: "ready"; readonly value: EngineProfileListDto };

export function EngineProfileScreen() {
  const { orgId = "", pubId = "" } = useParams<{ orgId: string; pubId: string }>();
  const { state } = useSession();
  const { t } = useI18n();
  const org =
    state.status === "ready"
      ? state.workspace?.organizations.find((candidate) => candidate.org.id === orgId)
      : undefined;
  const publication = org?.publications.find((candidate) => candidate.id === pubId);
  const access = layoutAccess(org, pubId);
  return (
    <Stack gap="5" className="pg-layout">
      <PageHeader
        title={t("nav.engineProfile")}
        headingId={ROUTE_HEADING_ID}
        {...(publication ? { subtitle: publication.name } : {})}
      />
      <OfflineNotice />
      {access.settings && <ProfileContent orgId={orgId} pubId={pubId} edit={access.settingsEdit} generate={access.generate} />}
      {access.settings && <SectionsPanel orgId={orgId} pubId={pubId} edit={access.settingsEdit} />}
      {org && !access.settings && (
        <InlineMessage variant="info" heading={t("onboarding.profileNoAccess.heading")} iconLabel={t("message.info")}>
          {t("onboarding.profileNoAccess.body")}
        </InlineMessage>
      )}
    </Stack>
  );
}

function StateBadge({ profile, t }: { readonly profile: EngineProfileDto; readonly t: Translate }) {
  if (profile.state === "ready")
    return (
      <Badge tone="success" icon="circle-check">
        {t("profile.state.ready")}
      </Badge>
    );
  if (profile.state === "failed")
    return (
      <Badge tone="danger" icon="circle-x">
        {t("profile.state.failed")}
      </Badge>
    );
  return (
    <Badge tone="info" icon="loader-circle">
      {t("profile.state.setting_up")}
    </Badge>
  );
}

function ProfileContent({
  orgId,
  pubId,
  edit,
  generate,
}: {
  readonly orgId: string;
  readonly pubId: string;
  readonly edit: boolean;
  readonly generate: boolean;
}) {
  const layout = useLayout();
  const { t, language } = useI18n();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const ask = useRef(0);

  const fetchList = useCallback(
    async (live: boolean) => {
      const mine = ++ask.current;
      const result = await layout.listProfiles({ orgId, pubId });
      if (mine !== ask.current) return;
      setLoad(result.ok ? { status: "ready", value: result.value } : { status: "failed", problem: result.error, live });
    },
    [layout, orgId, pubId],
  );
  useEffect(() => {
    setLoad({ status: "loading" });
    void fetchList(false);
  }, [fetchList]);
  useLiveEvents((event) => {
    if ((event.type === "profile" && event.publicationId === pubId) || event.type === "resync") void fetchList(true);
  });
  const settingUp = load.status === "ready" && load.value.items.some((item) => item.state === "setting_up");
  useEffect(() => {
    if (!settingUp) return;
    const timer = setInterval(() => void fetchList(true), POLL_MS);
    return () => clearInterval(timer);
  }, [fetchList, settingUp]);

  if (load.status === "loading") return <ProgressIndicator role="status" label={t("profile.loading")} />;
  if (load.status === "failed") {
    return (
      <Stack gap="3">
        <ProblemMessage problem={load.problem} live={load.live} />
        {!(load.problem.kind === "answer" && load.problem.status === 403) && (
          <div>
            <Button variant="secondary" onClick={() => void fetchList(true)}>
              {t("form.retry")}
            </Button>
          </div>
        )}
      </Stack>
    );
  }
  const { items, inUse } = load.value;
  const current = items.find((item) => item.id === inUse) ?? null;
  // a newer upload than the one in use: still setting up, or failed
  const newest =
    items[0] && items[0].id !== inUse && (!current || items[0].version > current.version) ? items[0] : null;
  const earlier = items.filter((item) => item !== current && item !== newest);
  // set up from past editions (L4): the main step without a ready profile, a quieter one with
  const onboarding = edit && (
    <OnboardingPanel
      orgId={orgId}
      pubId={pubId}
      prominent={!current}
      generate={generate}
      templatesLink
      onUsed={() => void fetchList(true)}
    />
  );

  return (
    <Stack gap="5">
      <p>{t("profile.lede")}</p>
      {!current && onboarding}
      {newest?.state === "setting_up" && (
        <div aria-live="polite">
          <InlineMessage
            variant="info"
            heading={t("profile.version", { version: newest.version })}
            iconLabel={t("message.info")}
          >
            {t("profile.settingUp")}
          </InlineMessage>
        </div>
      )}
      {newest?.state === "failed" && (
        <InlineMessage variant="error" heading={t("profile.failed")} iconLabel={t("message.error")}>
          {newest.error && <SetupError error={newest.error} />}
        </InlineMessage>
      )}
      {current ? (
        <Panel title={t("profile.inUse", { version: current.version })}>
          <ProfileFacts profile={current} />
        </Panel>
      ) : (
        <Panel>
          <EmptyState icon="settings" heading={t("profile.none")}>
            {edit ? `${t("profile.noneBody")} ${t("profile.noneUpload")}` : t("profile.noneBody")}
          </EmptyState>
        </Panel>
      )}
      {current && onboarding}
      {edit && (
        // the operator's path: a new paper sets its design up from past editions above
        <details className="pg-layout__advanced">
          <summary>{t("profile.advanced")}</summary>
          <UploadDataset
            orgId={orgId}
            pubId={pubId}
            failed={newest?.state === "failed"}
            onMade={() => void fetchList(true)}
          />
        </details>
      )}
      {earlier.length > 0 && (
        <Panel title={t("profile.earlier")} flush>
          <Table caption={t("profile.earlier")}>
            <thead>
              <tr>
                <TableHeader numeric>{t("profile.versionColumn")}</TableHeader>
                <TableHeader>{t("profile.state")}</TableHeader>
                <TableHeader>{t("profile.uploaded")}</TableHeader>
                <TableHeader>{t("profile.dataset")}</TableHeader>
              </tr>
            </thead>
            <tbody>
              {earlier.map((item) => (
                <tr key={item.id}>
                  <TableCell numeric>{item.version}</TableCell>
                  <TableCell>
                    <StateBadge profile={item} t={t} />
                  </TableCell>
                  <TableCell>{formatDateTime(item.createdAt, language)}</TableCell>
                  <TableCell>
                    <code>{item.datasetSha256.slice(0, 12)}…</code>
                  </TableCell>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}
    </Stack>
  );
}

/** The engine's refusal codes (pgn_worker/engine.py), in plain words; any other in the engine's own words. */
const SETUP_ERROR: Readonly<Record<string, PlainKey>> = {
  not_zip: "profile.error.not_zip",
  too_large: "profile.error.too_large",
  unsafe_path: "profile.error.unsafe_path",
  no_pages: "profile.error.no_pages",
  setup: "profile.error.setup",
};

function SetupError({ error }: { readonly error: NonNullable<EngineProfileDto["error"]> }) {
  const { t } = useI18n();
  const key = SETUP_ERROR[error.code.replace(/^profile\./, "")];
  if (key) return <>{t(key)}</>;
  if (error.code.startsWith("worker.")) return <>{t("profile.error.worker")}</>;
  return <DeskWords text={error.message} />;
}

function ProfileFacts({ profile }: { readonly profile: EngineProfileDto }) {
  const { t, language } = useI18n();
  const facts: [string, ReactNode][] = [
    [t("profile.state"), <StateBadge key="state" profile={profile} t={t} />],
    [t("profile.dataset"), <code key="sha">{profile.datasetSha256}</code>],
    [t("profile.datasetSize"), t("profile.megabytes", { size: (profile.datasetBytes / 1024 ** 2).toFixed(1) })],
    ...(profile.engineVersion
      ? [
          [
            t("profile.engine"),
            <span key="engine" lang="en">
              {profile.engineVersion}
            </span>,
          ] as [string, ReactNode],
        ]
      : []),
    ...(profile.templates
      ? [
          [
            t("profile.templates"),
            <span key="templates" lang="en">
              {Object.entries(profile.templates)
                .map(([role, name]) => `${role}: ${name}`)
                .join(" · ")}
            </span>,
          ] as [string, ReactNode],
        ]
      : []),
    ...(profile.grid
      ? [
          [
            t("profile.grid"),
            t("profile.gridValue", {
              columns: profile.grid.columns,
              width: profile.grid.columnMm,
              gutter: profile.grid.gutterMm,
            }),
          ] as [string, ReactNode],
        ]
      : []),
    [
      t("profile.uploaded"),
      profile.createdBy
        ? t("profile.uploadedBy", { name: profile.createdBy.name, time: formatDateTime(profile.createdAt, language) })
        : formatDateTime(profile.createdAt, language),
    ],
  ];
  return (
    <dl className="pg-layout__facts">
      {facts.map(([name, value]) => (
        <div key={name}>
          <dt>{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

type Sending =
  | { readonly step: "idle" }
  | { readonly step: "sending"; readonly fraction: number }
  | { readonly step: "making" }
  | { readonly step: "done" }
  | { readonly step: "cancelled" }
  | { readonly step: "refused"; readonly why: "notZip" | "tooLarge" }
  | { readonly step: "failed"; readonly problem: ApiProblem };

const isZip = (file: File) =>
  /\.zip$/i.test(file.name) || file.type === DATASET_TYPE || file.type === "application/x-zip-compressed";

function UploadDataset({
  orgId,
  pubId,
  failed,
  onMade,
}: {
  readonly orgId: string;
  readonly pubId: string;
  /** the newest profile failed to set up: "Uploaded, setting it up" is no longer true */
  readonly failed: boolean;
  readonly onMade: () => void;
}) {
  const media = useMedia();
  const layout = useLayout();
  const { t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState<Sending>({ step: "idle" });
  const stop = useRef<AbortController | null>(null);
  /** The file arrived in the store under this upload (and the key to make it a profile): a retry only makes it. */
  const arrived = useRef<{ readonly file: File; readonly uploadId: string; readonly key: string } | null>(null);
  useEffect(() => () => stop.current?.abort(), []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file || sending.step === "sending" || sending.step === "making") return;
    if (!isZip(file)) return setSending({ step: "refused", why: "notZip" });
    if (file.size > MAX_DATASET_BYTES) return setSending({ step: "refused", why: "tooLarge" });
    const where = { orgId, pubId };
    if (arrived.current?.file !== file) {
      arrived.current = null;
      const controller = new AbortController();
      stop.current = controller;
      setSending({ step: "sending", fraction: 0 });
      const presigned = await media.presign({
        ...where,
        filename: fileName(file.name),
        contentType: DATASET_TYPE,
        bytes: file.size,
        idempotencyKey: randomUuid(),
        purpose: "engine_dataset",
      });
      if (controller.signal.aborted) return setSending({ step: "cancelled" });
      if (!presigned.ok) return setSending({ step: "failed", problem: presigned.error });
      const sent = await media.send({
        upload: presigned.value,
        file,
        signal: controller.signal,
        onProgress: (fraction) => {
          if (!controller.signal.aborted) setSending({ step: "sending", fraction });
        },
      });
      if (!sent.ok) {
        const code = sent.error.kind === "answer" ? sent.error.code : "";
        return setSending(
          code === "upload_cancelled" ? { step: "cancelled" } : { step: "failed", problem: sent.error },
        );
      }
      arrived.current = { file, uploadId: presigned.value.uploadId, key: randomUuid() };
    }
    const { uploadId, key } = arrived.current!;
    setSending({ step: "making" });
    const made = await layout.createProfile({ ...where, uploadId, idempotencyKey: key });
    if (!made.ok) return setSending({ step: "failed", problem: made.error });
    arrived.current = null;
    setFile(null);
    setSending({ step: "done" });
    onMade();
  };

  const busy = sending.step === "sending" || sending.step === "making";
  return (
    <Panel title={t("profile.upload.heading")}>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <Stack gap="4">
          <Field label={t("profile.upload.label")}>
            <input
              type="file"
              accept=".zip,application/zip"
              disabled={busy}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setSending({ step: "idle" });
              }}
            />
          </Field>
          <Cluster gap="3">
            <Button type="submit" variant="primary" disabled={!file || busy} aria-busy={busy}>
              {t("profile.upload.submit")}
            </Button>
            {sending.step === "sending" && (
              <Button variant="secondary" onClick={() => stop.current?.abort()}>
                {t("profile.upload.cancel")}
              </Button>
            )}
          </Cluster>
          <div aria-live="polite">
            {sending.step === "sending" && (
              <ProgressIndicator
                label={t("profile.upload.sending", { percent: Math.round(sending.fraction * 100) })}
                value={Math.round(sending.fraction * 100)}
                max={100}
              />
            )}
            {sending.step === "making" && <ProgressIndicator label={t("profile.settingUp")} />}
            {sending.step === "done" && !failed && <p>{t("profile.upload.done")}</p>}
            {sending.step === "cancelled" && <p>{t("profile.upload.cancelled")}</p>}
          </div>
          {sending.step === "refused" && (
            <InlineMessage
              variant="error"
              heading={sending.why === "notZip" ? t("profile.upload.notZip") : t("profile.upload.tooLarge")}
              live
              iconLabel={t("message.error")}
            />
          )}
          {sending.step === "failed" && <ProblemMessage problem={sending.problem} />}
        </Stack>
      </form>
    </Panel>
  );
}
