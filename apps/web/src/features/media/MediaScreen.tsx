/**
 * Media, /org/:orgId/pub/:pubId/media (plan §L2.2, §5.3; 07 row "Media library"): the photo desk. The publication's
 * pictures as a grid (MediaGrid), "Upload photos" (several at once, straight into the library, one after another,
 * each with its progress, Cancel and a retry from where it stopped) for whoever may upload (media.upload), and a
 * picture's detail in a side sheet: a big preview, its facts (type, size, pixels, SHA-256), how wide it prints sharp,
 * its own caption, credit and photographer (saved on its revision: 409 asset_changed shows theirs), the stories that
 * use it, Download original, and Delete for a full media.upload while no story uses it.
 *
 * Who does what: a Reporter sees and changes only their own pictures (the API answers with only those); a Viewer, a
 * Page Designer or Prepress sees all of them, read only; only the desk and a Photo Editor delete.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { reach } from "@pageinator/contracts";
import {
  Button,
  Cluster,
  Dialog,
  Drawer,
  Field,
  Icon,
  InlineMessage,
  PageHeader,
  Panel,
  ProgressIndicator,
  Stack,
  TextArea,
  TextInput,
} from "../../ui/index.ts";
import { paths, ROUTE_HEADING_ID } from "../../app/routes.ts";
import { useI18n, type Translate } from "../../i18n/index.ts";
import type { ApiProblem, MediaItemDto, MediaPatchDto } from "../../services/index.ts";
import { OfflineNotice } from "../auth/connection.tsx";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";
import { useSession } from "../auth/SessionProvider.tsx";
import { useLiveEvents } from "../live/live-context.tsx";
import { pubAccess } from "../stories/access.ts";
import { useMedia } from "../stories/media-context.tsx";
import { MediaGrid, MediaStatus, mediaName, mediaReason } from "./MediaGrid.tsx";
import { ACCEPT, refuseFile, runUpload, UploadFailureMessage, uploadJob, type UploadFailure, type UploadJob, type UploadStep } from "./upload.tsx";

type RowPhase =
  | { readonly step: "queued" }
  | UploadStep
  | { readonly step: "done" }
  | { readonly step: "failed"; readonly why: UploadFailure; readonly retry: boolean };

interface Row {
  readonly id: number;
  readonly name: string;
  readonly job: UploadJob | null;
  readonly phase: RowPhase;
}

const busyStep = (phase: RowPhase) => phase.step === "presigning" || phase.step === "sending" || phase.step === "completing";

export function MediaScreen() {
  const { orgId = "", pubId = "" } = useParams<{ orgId: string; pubId: string }>();
  const { state } = useSession();
  const { t } = useI18n();
  const org = state.status === "ready" ? state.workspace?.organizations.find((candidate) => candidate.org.id === orgId) : undefined;
  const publication = org?.publications.find((candidate) => candidate.id === pubId);
  const open = !!org && !(org.twoStep.required && !org.twoStep.satisfied);
  const uploadReach = org ? reach("media.upload", org.orgRole, pubAccess(org, pubId)) : null;
  const upload = open && uploadReach !== null;
  const [version, setVersion] = useState(0);
  const [chosen, setChosen] = useState<MediaItemDto | null>(null);
  const files = useRef<HTMLInputElement>(null);
  const uploads = useUploads(orgId, pubId, () => setVersion((count) => count + 1));

  return (
    <Stack gap="5">
      <PageHeader
        title={t("nav.media")}
        headingId={ROUTE_HEADING_ID}
        {...(publication ? { subtitle: publication.name } : {})}
        {...(upload
          ? {
              actions: (
                <>
                  <input
                    ref={files}
                    type="file"
                    multiple
                    accept={ACCEPT}
                    className="pg-visually-hidden"
                    tabIndex={-1}
                    aria-hidden="true"
                    aria-label={t("library.upload")}
                    onChange={(event) => {
                      const chosenFiles = [...(event.target.files ?? [])];
                      event.target.value = ""; // the same files may be chosen again
                      uploads.add(chosenFiles);
                    }}
                  />
                  <Button variant="primary" onClick={() => files.current?.click()}>
                    <Icon name="upload" size={16} />
                    {t("library.upload")}
                  </Button>
                </>
              ),
            }
          : {})}
      />
      <OfflineNotice />
      {upload && <p className="pg-media__note">{t("photo.formats")} {t("photo.privacy")}</p>}
      {uploads.rows.length > 0 && <UploadList {...uploads} />}
      {open && <MediaGrid orgId={orgId} pubId={pubId} version={version} onChoose={setChosen} />}
      <Drawer open={!!chosen} onClose={() => setChosen(null)} title={chosen ? mediaName(chosen, t) : ""} closeLabel={t("shell.closeDialog")} size="wide">
        {chosen && (
          <MediaDetail
            key={chosen.id}
            orgId={orgId}
            pubId={pubId}
            item={chosen}
            mayEdit={upload && chosen.mayEdit}
            mayDelete={uploadReach === "full"}
            onChanged={(item) => {
              setChosen(item);
              setVersion((count) => count + 1);
            }}
            onDeleted={() => {
              setChosen(null);
              setVersion((count) => count + 1);
            }}
          />
        )}
      </Drawer>
    </Stack>
  );
}

/** The uploads asked for on this screen, sent one after another; leaving the screen stops them. */
function useUploads(orgId: string, pubId: string, onDone: () => void) {
  const media = useMedia();
  const [rows, setRows] = useState<readonly Row[]>([]);
  const counter = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const current = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      current.current?.abort();
    };
  }, []);
  const update = (id: number, phase: RowPhase) => {
    if (mounted.current) setRows((all) => all.map((row) => (row.id === id ? { ...row, phase } : row)));
  };
  const enqueue = (row: Row) => {
    const job = row.job;
    if (!job) return;
    update(row.id, { step: "queued" });
    queue.current = queue.current.then(async () => {
      if (!mounted.current) return;
      const controller = new AbortController();
      current.current = controller;
      const result = await runUpload(media, { orgId, pubId }, job, controller.signal, (step) => update(row.id, step));
      current.current = null;
      if (!mounted.current) return;
      update(row.id, result.ok ? { step: "done" } : { step: "failed", why: result.why, retry: result.retry });
      if (result.ok) done.current();
    });
  };
  const add = (chosen: readonly File[]) => {
    const added = chosen.map((file): Row => {
      counter.current += 1;
      // checked here first: nothing is sent for a file the API would refuse
      const refusal = refuseFile(file);
      return {
        id: counter.current,
        name: file.name,
        job: refusal ? null : uploadJob(file, "library"),
        phase: refusal ? { step: "failed", why: refusal, retry: false } : { step: "queued" },
      };
    });
    setRows((all) => [...all, ...added]);
    added.forEach(enqueue);
  };
  return {
    rows,
    add,
    retry: enqueue,
    cancel: () => current.current?.abort(),
    clear: () => setRows((all) => all.filter((row) => busyStep(row.phase) || row.phase.step === "queued")),
  };
}

function UploadList({
  rows,
  retry,
  cancel,
  clear,
}: {
  readonly rows: readonly Row[];
  readonly retry: (row: Row) => void;
  readonly cancel: () => void;
  readonly clear: () => void;
}) {
  const { t } = useI18n();
  const working = rows.some((row) => busyStep(row.phase) || row.phase.step === "queued");
  return (
    <Panel
      title={t("library.uploads")}
      {...(!working
        ? {
            actions: (
              <Button variant="quiet" size="sm" onClick={clear}>
                {t("library.uploads.clear")}
              </Button>
            ),
          }
        : {})}
    >
      <ul className="pg-media__uploads">
        {rows.map((row) => {
          const { phase } = row;
          return (
            <li key={row.id}>
              <Stack gap="2">
                <bdi className="pg-media__upload-name">{row.name}</bdi>
                {phase.step === "queued" && <p>{t("library.uploads.waiting")}</p>}
                {phase.step === "presigning" && <ProgressIndicator role="status" label={t("photo.preparing")} />}
                {phase.step === "sending" && (
                  <ProgressIndicator
                    role="status"
                    label={t("photo.sending", { percent: Math.round(phase.fraction * 100) })}
                    value={Math.round(phase.fraction * 100)}
                  />
                )}
                {phase.step === "completing" && <ProgressIndicator role="status" label={t("photo.completing")} />}
                {phase.step === "done" && <p role="status">{t("library.uploads.done")}</p>}
                {phase.step === "failed" && <UploadFailureMessage why={phase.why} />}
                {busyStep(phase) && (
                  <div>
                    <Button variant="secondary" size="sm" onClick={cancel}>
                      {t("photo.cancel")}
                    </Button>
                  </div>
                )}
                {phase.step === "failed" && phase.retry && row.job && (
                  <div>
                    <Button variant="secondary" size="sm" onClick={() => retry(row)}>
                      {t("photo.retry")}
                    </Button>
                  </div>
                )}
              </Stack>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/** Under 0.1 MB in whole KB, else MB to one decimal. */
const fileSize = (bytes: number, t: Translate) =>
  bytes < 104_858
    ? t("library.kilobytes", { size: Math.max(1, Math.round(bytes / 1024)) })
    : t("library.megabytes", { size: (bytes / 1_048_576).toFixed(1) });

const TYPE_NAMES: Readonly<Record<MediaItemDto["mime"], string>> = { "image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WebP" };
type Facts = Pick<MediaItemDto, "caption" | "credit" | "photographer">;
const FACTS = ["caption", "credit", "photographer"] as const;
const factsOf = (item: MediaItemDto): Facts => ({ caption: item.caption, credit: item.credit, photographer: item.photographer });

/** A 409 asset_changed's picture as it is now (the service keeps `current` only when it is one). */
const theirsOf = (problem: ApiProblem): MediaItemDto | null =>
  problem.kind === "answer" && problem.code === "asset_changed" && problem.current ? (problem.current as MediaItemDto) : null;

function MediaDetail({
  orgId,
  pubId,
  item: first,
  mayEdit,
  mayDelete,
  onChanged,
  onDeleted,
}: {
  readonly orgId: string;
  readonly pubId: string;
  readonly item: MediaItemDto;
  readonly mayEdit: boolean;
  readonly mayDelete: boolean;
  readonly onChanged: (item: MediaItemDto) => void;
  readonly onDeleted: () => void;
}) {
  const media = useMedia();
  const { t } = useI18n();
  const [item, setItem] = useState(first);
  const [typed, setTyped] = useState<Facts>(() => factsOf(first));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [theirs, setTheirs] = useState<MediaItemDto | null>(null);
  const [confirming, setConfirming] = useState(false);
  const dirty = FACTS.some((field) => typed[field] !== item[field]);
  const latest = useRef({ dirty, saving });
  latest.current = { dirty, saving };

  // a change elsewhere (the picture became ready, someone else's edit): the facts shown follow, unless being typed
  const reload = () => {
    if (latest.current.saving) return;
    void media.get({ orgId, pubId, assetId: item.id }).then((result) => {
      if (!result.ok || latest.current.saving) return;
      setItem(result.value);
      if (!latest.current.dirty) setTyped(factsOf(result.value));
    });
  };
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useLiveEvents((event) => {
    if ((event.type === "story" && event.publicationId === pubId) || event.type === "resync") reloadRef.current();
  });
  // as the grid: a picture no story uses has no live update of its own, so while it is prepared, ask every 3 s
  useEffect(() => {
    if (item.status !== "received") return;
    const timer = setTimeout(() => reloadRef.current(), 3_000);
    return () => clearTimeout(timer);
  }, [item]);

  const save = async (baseRevision: number) => {
    setSaving(true);
    setSaved(false);
    setProblem(null);
    setTheirs(null);
    const patch: MediaPatchDto = { baseRevision, ...Object.fromEntries(FACTS.map((field) => [field, typed[field]])) };
    const result = await media.update({ orgId, pubId, assetId: item.id, patch });
    setSaving(false);
    if (!result.ok) {
      const now = theirsOf(result.error);
      if (now) return setTheirs(now);
      return setProblem(result.error);
    }
    setItem(result.value);
    setTyped(factsOf(result.value));
    setSaved(true);
    onChanged(result.value);
  };

  const remove = async () => {
    setConfirming(false);
    setProblem(null);
    const result = await media.remove({ orgId, pubId, assetId: item.id, baseRevision: item.revision });
    if (!result.ok) {
      const now = theirsOf(result.error);
      if (now) setItem(now);
      return setProblem(result.error);
    }
    onDeleted();
  };

  const reason = mediaReason(item, t);
  const unusable = item.status === "rejected" || item.status === "failed";
  const facts: readonly [string, string][] = [
    [t("library.fact.type"), TYPE_NAMES[item.mime]],
    [t("library.fact.size"), fileSize(item.bytes, t)],
    [t("library.fact.pixels"), t("library.pixels", { width: item.widthPx, height: item.heightPx })],
    [t("library.fact.sha"), item.sha256.slice(0, 12)],
    [t("library.fact.uploadedBy"), item.uploadedBy.name],
  ];
  const field = (name: (typeof FACTS)[number]) => ({
    value: typed[name],
    readOnly: !mayEdit || saving,
    onChange: (event: { target: { value: string } }) => {
      setSaved(false);
      setTyped((now) => ({ ...now, [name]: event.target.value }));
    },
  });

  return (
    <Stack gap="5">
      <div className="pg-media__preview">
        {item.previewUrl ? (
          <img src={item.previewUrl} alt={item.caption || t("photo.alt")} width={item.widthPx} height={item.heightPx} />
        ) : (
          <p>{unusable ? t("library.noPreview.unusable") : t("library.noPreview")}</p>
        )}
      </div>
      <Cluster gap="2">
        <MediaStatus item={item} t={t} />
      </Cluster>
      {reason && <p>{reason}</p>}
      {item.sharpUpToCols !== null && (
        <p className="pg-media__sharp">
          {item.sharpUpToCols === 0
            ? t("library.sharp.none")
            : item.sharpUpToCols === 1
              ? t("library.sharp.one")
              : t("library.sharp", { count: item.sharpUpToCols })}
        </p>
      )}
      <dl className="pg-media__facts">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <bdi>{value}</bdi>
            </dd>
          </div>
        ))}
      </dl>

      <form
        className="pg-media__form"
        onSubmit={(event) => {
          event.preventDefault();
          if (mayEdit && dirty && !saving) void save(item.revision);
        }}
      >
        <Field label={t("glossary.caption")}>
          <TextArea rows={2} {...field("caption")} />
        </Field>
        <Field label={t("glossary.photoCredit")}>
          <TextInput {...field("credit")} />
        </Field>
        <Field label={t("library.photographer")}>
          <TextInput {...field("photographer")} />
        </Field>
        {mayEdit && (
          <div>
            <Button type="submit" variant="primary" disabled={!dirty || saving} aria-busy={saving}>
              {saving ? t("library.saving") : t("library.save")}
            </Button>
          </div>
        )}
      </form>
      <div aria-live="polite">{saved && !dirty && <p>{t("library.saved")}</p>}</div>
      {theirs && (
        <InlineMessage variant="warning" heading={t("error.asset_changed")} live iconLabel={t("message.warning")}>
          <Stack gap="3">
            <p>{t("library.conflict.body")}</p>
            <dl className="pg-media__facts">
              {FACTS.map((name) => (
                <div key={name}>
                  <dt>{name === "caption" ? t("glossary.caption") : name === "credit" ? t("glossary.photoCredit") : t("library.photographer")}</dt>
                  <dd>
                    <bdi>{theirs[name] || "—"}</bdi>
                  </dd>
                </div>
              ))}
            </dl>
            <Cluster gap="3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setItem(theirs);
                  setTyped(factsOf(theirs));
                  setTheirs(null);
                }}
              >
                {t("library.conflict.theirs")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setItem(theirs);
                  void save(theirs.revision);
                }}
              >
                {t("library.conflict.mine")}
              </Button>
            </Cluster>
          </Stack>
        </InlineMessage>
      )}
      {problem && <ProblemMessage problem={problem} />}

      <section aria-labelledby={`used-${item.id}`}>
        <Stack gap="2">
          <h3 id={`used-${item.id}`} className="pg-type-section-title">
            {t("library.usedIn")}
          </h3>
          {item.usedBy.length === 0 ? (
            <p>{t("library.usedIn.none")}</p>
          ) : (
            <ul className="pg-media__used">
              {item.usedBy.map((use) => (
                <li key={use.storyId}>
                  <Link to={paths.pubStory(orgId, pubId, use.storyId)}>
                    <bdi>{use.headline}</bdi>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Stack>
      </section>

      <Cluster gap="3">
        {!unusable && (
          <a className="pg-button pg-button--secondary pg-button--md" href={media.fileUrl({ orgId, pubId, assetId: item.id })} download>
            <Icon name="download" size={16} />
            {t("photo.download")}
          </a>
        )}
        {mayDelete && !item.inUse && (
          <Button variant="danger" onClick={() => setConfirming(true)}>
            {t("library.delete")}
          </Button>
        )}
      </Cluster>
      {mayDelete && item.inUse && <p className="pg-media__note">{t("library.delete.inUse")}</p>}
      {confirming && (
        <Dialog open onClose={() => setConfirming(false)} title={t("library.delete.title")} closeLabel={t("shell.closeDialog")}>
          <Stack gap="4">
            <p>{t("library.delete.body")}</p>
            <Cluster gap="3">
              <Button variant="danger" onClick={() => void remove()}>
                {t("library.delete.confirm")}
              </Button>
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                {t("security.cancel")}
              </Button>
            </Cluster>
          </Stack>
        </Dialog>
      )}
    </Stack>
  );
}
