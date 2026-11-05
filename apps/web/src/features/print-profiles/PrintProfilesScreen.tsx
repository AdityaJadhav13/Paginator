/**
 * Print profiles, /org/:orgId/pub/:pubId/print-profiles (@pageinator/contracts print-profiles.ts): the press this
 * publication prints with (GET …/print-profiles, print_profiles.view), each save a new version (POST, print_profiles.edit,
 * an Idempotency-Key kept for a retry); a release records the version in use when it is approved. Beside it, read-only
 * facts of what the engine and the checks actually do: the trim size of the front template, the PDF standard the
 * independent check tests, its checker, the output intent's colour profile, the minimum resolutions, and the delivery
 * method (the only one built).
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useParams } from "react-router";
import {
  Button,
  EmptyState,
  Field,
  PageHeader,
  Panel,
  ProgressIndicator,
  Stack,
  Table,
  TableCell,
  TableHeader,
  TextArea,
  TextInput,
} from "../../ui/index.ts";
import { ROUTE_HEADING_ID } from "../../app/routes.ts";
import { randomUuid } from "../../api/client.ts";
import { formatDateTime } from "../../i18n/dates.ts";
import { useI18n } from "../../i18n/index.ts";
import type { ApiProblem } from "../../services/index.ts";
import type { PrintProfilesDto } from "../../services/release-service.ts";
import { OfflineNotice } from "../auth/connection.tsx";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";
import { useSession } from "../auth/SessionProvider.tsx";
import { may } from "../people/navigation.ts";
import { useRelease } from "../release/release-context.tsx";
import "./print-profiles.css";

type Load =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly problem: ApiProblem }
  | { readonly status: "ready"; readonly value: PrintProfilesDto };

/** A hash shown short: its first 12 characters (the whole one in its title). */
const short = (sha: string) => `${sha.slice(0, 12)}…`;

export function PrintProfilesScreen() {
  const { orgId = "", pubId = "" } = useParams<{ orgId: string; pubId: string }>();
  const { state } = useSession();
  const { t } = useI18n();
  const org =
    state.status === "ready"
      ? state.workspace?.organizations.find((candidate) => candidate.org.id === orgId)
      : undefined;
  const publication = org?.publications.find((candidate) => candidate.id === pubId);
  // the API refuses every screen of the organisation (403 two_step_required) until this session has two-step
  const open = !!org && !(org.twoStep.required && !org.twoStep.satisfied);
  const view = open && may(org, "print_profiles.view", pubId);
  const edit = open && may(org, "print_profiles.edit", pubId);
  return (
    <Stack gap="5">
      <PageHeader
        title={t("nav.printProfiles")}
        headingId={ROUTE_HEADING_ID}
        {...(publication ? { subtitle: publication.name } : {})}
      />
      <OfflineNotice />
      {view && <ProfilesContent orgId={orgId} pubId={pubId} edit={edit} />}
    </Stack>
  );
}

function ProfilesContent({ orgId, pubId, edit }: { readonly orgId: string; readonly pubId: string; readonly edit: boolean }) {
  const release = useRelease();
  const { t, language } = useI18n();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const ask = useRef(0);
  const fetchList = useCallback(async () => {
    const mine = ++ask.current;
    const result = await release.printProfiles({ orgId, pubId });
    if (mine !== ask.current) return;
    setLoad(result.ok ? { status: "ready", value: result.value } : { status: "failed", problem: result.error });
  }, [release, orgId, pubId]);
  useEffect(() => {
    setLoad({ status: "loading" });
    void fetchList();
  }, [fetchList]);

  if (load.status === "loading") return <ProgressIndicator role="status" label={t("printProfiles.loading")} />;
  if (load.status === "failed") {
    return (
      <Stack gap="3">
        <ProblemMessage problem={load.problem} />
        {!(load.problem.kind === "answer" && load.problem.status === 403) && (
          <div>
            <Button variant="secondary" onClick={() => void fetchList()}>
              {t("form.retry")}
            </Button>
          </div>
        )}
      </Stack>
    );
  }
  const { items, facts } = load.value;
  const [current, ...earlier] = items;
  return (
    <Stack gap="5">
      <p>{t("printProfiles.lede")}</p>
      {current ? (
        <Panel title={t("printProfiles.inUse", { version: current.version })}>
          <Stack gap="2">
            <p>
              <strong>{current.pressName}</strong>
            </p>
            {current.contact && <p>{current.contact}</p>}
            {current.note && <p>{current.note}</p>}
            <p className="pg-layout__note">
              {t("printProfiles.savedBy", {
                name: current.createdBy.name,
                time: formatDateTime(current.createdAt, language),
              })}
            </p>
          </Stack>
        </Panel>
      ) : (
        <Panel>
          <EmptyState icon="printer" heading={t("printProfiles.none")}>
            {t("printProfiles.noneBody")}
          </EmptyState>
        </Panel>
      )}
      {edit && <NewVersion orgId={orgId} pubId={pubId} current={current ?? null} onSaved={() => void fetchList()} />}
      <Panel title={t("printProfiles.facts")}>
        <Stack gap="3">
          <p className="pg-layout__note">{t("printProfiles.factsLede")}</p>
          <dl className="pg-print__facts">
            <dt>{t("printProfiles.trim")}</dt>
            <dd>
              {facts.trim && facts.engineProfileVersion !== null
                ? t("printProfiles.trimValue", {
                    w: facts.trim.wMm,
                    h: facts.trim.hMm,
                    version: facts.engineProfileVersion,
                  })
                : t("printProfiles.trimNone")}
            </dd>
            <dt>{t("printProfiles.pdf")}</dt>
            <dd>
              {/* what the independent checker tests, said only once a run has been checked (never a validity claim) */}
              {facts.checkerSha256
                ? t("printProfiles.pdfValue", { standard: facts.pdfStandard })
                : t("printProfiles.checkerNone")}
            </dd>
            <dt>{t("printProfiles.checker")}</dt>
            <dd>
              {facts.checkerSha256 ? (
                <code title={facts.checkerSha256}>{short(facts.checkerSha256)}</code>
              ) : (
                t("printProfiles.checkerNone")
              )}
            </dd>
            <dt>{t("printProfiles.icc")}</dt>
            <dd>
              {facts.iccSha256 ? (
                <code title={facts.iccSha256}>{short(facts.iccSha256)}</code>
              ) : (
                t("printProfiles.notRecorded")
              )}
            </dd>
            <dt>{t("printProfiles.ppi")}</dt>
            <dd>{t("printProfiles.ppiValue", { ad: facts.adMinPpi, photo: facts.photoSharpPpi })}</dd>
            <dt>{t("printProfiles.delivery")}</dt>
            <dd>{t("printProfiles.deliveryValue")}</dd>
          </dl>
        </Stack>
      </Panel>
      {earlier.length > 0 && (
        <Panel title={t("printProfiles.history")} flush>
          <Table caption={t("printProfiles.history")}>
            <thead>
              <tr>
                <TableHeader numeric>{t("printProfiles.version")}</TableHeader>
                <TableHeader>{t("printProfiles.pressName")}</TableHeader>
                <TableHeader>{t("printProfiles.by")}</TableHeader>
                <TableHeader>{t("printProfiles.when")}</TableHeader>
              </tr>
            </thead>
            <tbody>
              {earlier.map((item) => (
                <tr key={item.id}>
                  <TableCell numeric>{item.version}</TableCell>
                  <TableCell>{item.pressName}</TableCell>
                  <TableCell>{item.createdBy.name}</TableCell>
                  <TableCell>{formatDateTime(item.createdAt, language)}</TableCell>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}
    </Stack>
  );
}

function NewVersion({
  orgId,
  pubId,
  current,
  onSaved,
}: {
  readonly orgId: string;
  readonly pubId: string;
  readonly current: PrintProfilesDto["items"][number] | null;
  readonly onSaved: () => void;
}) {
  const release = useRelease();
  const { t } = useI18n();
  // the form starts from the version in use
  const [pressName, setPressName] = useState(current?.pressName ?? "");
  const [contact, setContact] = useState(current?.contact ?? "");
  const [note, setNote] = useState(current?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  // one key per intended save: a retry after a lost answer is the same save
  const key = useRef(randomUuid());

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!pressName.trim()) return;
    setBusy(true);
    setProblem(null);
    setSaved(null);
    const result = await release.addPrintProfile({
      orgId,
      pubId,
      pressName: pressName.trim(),
      ...(contact.trim() ? { contact: contact.trim() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      idempotencyKey: key.current,
    });
    setBusy(false);
    if (!result.ok) return setProblem(result.error);
    key.current = randomUuid();
    setSaved(result.value.version);
    onSaved();
  };

  return (
    <Panel title={t("printProfiles.new")}>
      <form onSubmit={(event) => void save(event)}>
        <Stack gap="3">
          <Field label={t("printProfiles.pressName")} required>
            <TextInput
              value={pressName}
              maxLength={200}
              onChange={(event) => {
                setPressName(event.target.value);
                key.current = randomUuid();
              }}
            />
          </Field>
          <Field label={t("printProfiles.contact")}>
            <TextInput
              value={contact}
              maxLength={500}
              onChange={(event) => {
                setContact(event.target.value);
                key.current = randomUuid();
              }}
            />
          </Field>
          <Field label={t("printProfiles.note")}>
            <TextArea
              value={note}
              maxLength={2000}
              onChange={(event) => {
                setNote(event.target.value);
                key.current = randomUuid();
              }}
            />
          </Field>
          {problem && <ProblemMessage problem={problem} />}
          <div aria-live="polite">
            {saved !== null && (
              <p>{t("printProfiles.saved", { version: saved })}</p>
            )}
          </div>
          <div>
            <Button type="submit" disabled={busy || !pressName.trim()} aria-busy={busy}>
              {t("printProfiles.save")}
            </Button>
          </div>
        </Stack>
      </form>
    </Panel>
  );
}
