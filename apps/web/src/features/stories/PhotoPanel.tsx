/**
 * The story's photo in the editor (plan §10 PR 22, §5.2, §6.2): take one with the camera or choose one from the
 * gallery, see it, give it a caption and a credit, replace it or take it off.
 *
 * - Upload: presign (with an Idempotency-Key kept with its exact body, so a retry asks for the same thing), the file
 *   straight to the store with the policy's fields (progress, Cancel at any step), then complete; then the photo is
 *   attached to the story on its version. A retry goes on from where it stopped: the same presign, the same upload's
 *   complete (never the file again once it arrived), or attaching the same picture. A policy whose time is over is
 *   asked for afresh, with a new key, once; a policy the store refuses for another reason is not retried.
 * - Before anything is sent: only JPEG, PNG and WebP up to 40 MB. An iPhone's HEIC is explained, with how to send
 *   JPEG instead (the input asks for JPEG, PNG or WebP; whether a phone converts for it is the phone's).
 * - The API's refusals in plain words: not a picture, too large, the upload quotas (a 429 at presign only), a policy
 *   that ran out or was refused, a file that changed while it was sent.
 * - Privacy: the photo is kept as it was taken, EXIF and place included; said where the photo is added.
 * - Its state, from the engine (L2.2): being prepared for print, refused by the Desk's rules (in the Desk's words, by
 *   its message code), or not prepared (the engine failed: not the photo's fault); an open editor hears the change live.
 * - Showing it: the original loads only when asked (this panel does not use the engine's preview yet, L2-322),
 *   through a fresh 5-minute link each time, held in memory only and let go when the screen goes. Only for whoever
 *   may see the publication's pictures (media.view), and never for a refused or failed photo: it no longer holds its
 *   bytes, so neither Show nor Download is offered.
 * - Choose from library (L2.2 media library): a picture already in the publication's library, attached the same way;
 *   its own caption and credit fill the story's where those are empty.
 * - Leaving the screen stops every step: nothing is attached after the person has gone.
 * - A caption and credit typed for a photo that is no longer there (removed by someone, or no longer theirs to
 *   change) are kept, read only, until a photo comes back or the person lets them go.
 */
import { useEffect, useId, useRef, useState } from "react";
import { Button, Cluster, Dialog, Drawer, Field, InlineMessage, ProgressIndicator, Stack, TextArea, TextInput } from "../../ui/index.ts";
import { useI18n } from "../../i18n/index.ts";
import type { ApiProblem, StoryDto } from "../../services/index.ts";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";
import { MediaGrid } from "../media/MediaGrid.tsx";
import { ACCEPT, deskWords, refuseFile, runUpload, UploadFailureMessage, uploadJob, type UploadFailure, type UploadJob, type UploadStep } from "../media/upload.tsx";
import { useMedia } from "./media-context.tsx";

export { fileName } from "../media/upload.tsx";

export type PhotoOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly problem?: ApiProblem;
      readonly conflict?: boolean;
      /** The conflict is over the photo itself: someone attached another, or took it off. */
      readonly photoChanged?: boolean;
      readonly cancelled?: boolean;
    };

/** A library picture's own caption and credit, used where the story's are empty. */
export interface PhotoDefaults {
  readonly caption: string;
  readonly credit: string;
}

type Failure = UploadFailure | "conflict" | "conflictPhoto";

type Phase =
  | { readonly step: "idle" }
  | UploadStep
  | { readonly step: "attaching" }
  | { readonly step: "failed"; readonly why: Failure; readonly retry: boolean };

/** The photo being added: a file to upload (and how far it went), or a picture of the library, then attached. */
interface Pending {
  readonly job?: UploadJob;
  assetId?: string;
  readonly defaults?: PhotoDefaults;
}

function FailureMessage({ why }: { readonly why: Failure }) {
  const { t } = useI18n();
  if (why === "conflict") return <InlineMessage variant="warning" heading={t("photo.conflict")} live iconLabel={t("message.warning")} />;
  if (why === "conflictPhoto") {
    return <InlineMessage variant="warning" heading={t("photo.conflictPhoto")} live iconLabel={t("message.warning")} />;
  }
  return <UploadFailureMessage why={why} />;
}


/** The original, loaded only when asked, from a fresh link each time; held in memory and let go. */
function PhotoView({ orgId, pubId, story }: { readonly orgId: string; readonly pubId: string; readonly story: StoryDto }) {
  const media = useMedia();
  const { t } = useI18n();
  const photo = story.photo!;
  const [shown, setShown] = useState<{ readonly url: string; readonly assetId: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  // another picture, or the screen going: the one in memory goes
  useEffect(() => {
    if (shown && shown.assetId !== photo.assetId) {
      URL.revokeObjectURL(shown.url);
      setShown(null);
    }
  }, [photo.assetId, shown]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, []);
  useEffect(() => () => (shown ? URL.revokeObjectURL(shown.url) : undefined), [shown]);

  const show = async () => {
    setProblem(null);
    setLoading(true);
    const controller = new AbortController();
    abort.current = controller;
    const result = await media.loadOriginal({ orgId, pubId, assetId: photo.assetId, signal: controller.signal });
    // gone meanwhile, or stopped: no picture is made to be kept
    if (!mounted.current || controller.signal.aborted) return;
    setLoading(false);
    if (!result.ok) return setProblem(result.error);
    setShown({ url: URL.createObjectURL(result.value), assetId: photo.assetId });
  };

  return (
    <Stack gap="3">
      {shown ? (
        <img className="pg-photo__img" src={shown.url} alt={photo.caption || t("photo.alt")} width={photo.widthPx} height={photo.heightPx} />
      ) : (
        <div className="pg-photo__placeholder">
          <Stack gap="2">
            <p className="pg-type-body-small">{t("photo.noPreview")}</p>
            {loading ? (
              <ProgressIndicator role="status" label={t("photo.loading")} />
            ) : (
              <div>
                <Button variant="secondary" size="sm" onClick={() => void show()}>
                  {problem ? t("photo.retry") : t("photo.show")}
                </Button>
              </div>
            )}
          </Stack>
        </div>
      )}
      {problem && (
        <InlineMessage variant="error" heading={t("photo.loadFailed")} live iconLabel={t("message.error")}>
          <ProblemMessage problem={problem} live={false} />
        </InlineMessage>
      )}
      <p className="pg-type-body-small">
        {t("photo.size", { width: photo.widthPx, height: photo.heightPx })} ·{" "}
        <a href={media.fileUrl({ orgId, pubId, assetId: photo.assetId })} download>
          {t("photo.download")}
        </a>
      </p>
    </Stack>
  );
}

/** The photo's state from the engine: being prepared for print, refused in the Desk's words, or not prepared. */
function PhotoState({ photo }: { readonly photo: NonNullable<StoryDto["photo"]> }) {
  const { t } = useI18n();
  const words = deskWords(photo.problem);
  if (photo.status === "received") return <ProgressIndicator role="status" label={t("photo.processing")} />;
  if (photo.status === "rejected") {
    return (
      <InlineMessage variant="error" heading={t("photo.rejected")} iconLabel={t("message.error")}>
        {words && <p>{t(words)}</p>}
      </InlineMessage>
    );
  }
  if (photo.status === "failed") {
    return (
      <InlineMessage variant="error" heading={t("photo.failed")} iconLabel={t("message.error")}>
        <p>{t("photo.failed.body")}</p>
      </InlineMessage>
    );
  }
  return null;
}

/** A caption and credit with no photo to go on: shown read only, to copy, until a photo comes back or they are let go. */
function KeptCaption({
  caption,
  credit,
  why,
  onDiscard,
}: {
  readonly caption: string;
  readonly credit: string;
  readonly why: string;
  readonly onDiscard: () => void;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const text = [caption, credit].filter(Boolean).join("\n");
  return (
    <InlineMessage variant="warning" heading={why} iconLabel={t("message.warning")}>
      <Stack gap="3">
        <p>{t("photo.kept.body")}</p>
        <Field label={t("glossary.caption")}>
          <TextArea rows={2} value={caption} readOnly />
        </Field>
        <Field label={t("glossary.photoCredit")}>
          <TextInput value={credit} readOnly />
        </Field>
        <Cluster gap="3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void navigator.clipboard?.writeText(text).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            {t("photo.kept.copy")}
          </Button>
          <Button variant="quiet" size="sm" onClick={onDiscard}>
            {t("photo.kept.discard")}
          </Button>
        </Cluster>
        <div aria-live="polite">{copied && <p className="pg-type-body-small">{t("photo.kept.copied")}</p>}</div>
      </Stack>
    </InlineMessage>
  );
}

export function PhotoPanel({
  orgId,
  pubId,
  story,
  may,
  mayView,
  locked,
  caption,
  credit,
  keptBecause,
  lang,
  onCaption,
  onCredit,
  onLeave,
  onDiscardKept,
  onAttach,
  onRemove,
}: {
  readonly orgId: string;
  readonly pubId: string;
  readonly story: StoryDto;
  /** The person may set this story's photo. */
  readonly may: boolean;
  /** The person may see the publication's pictures (media.view): showing and downloading the original. */
  readonly mayView: boolean;
  /** The boxes take no typing now (a question is open, a move is being made). */
  readonly locked: boolean;
  readonly caption: string;
  readonly credit: string;
  /** Why a typed caption and credit cannot be saved now, when they cannot (they are then kept, read only). */
  readonly keptBecause: string | null;
  readonly lang: string | undefined;
  readonly onCaption: (value: string) => void;
  readonly onCredit: (value: string) => void;
  readonly onLeave: () => void;
  readonly onDiscardKept: () => void;
  readonly onAttach: (assetId: string, signal: AbortSignal, defaults?: PhotoDefaults) => Promise<PhotoOutcome>;
  readonly onRemove: () => Promise<PhotoOutcome>;
}) {
  const media = useMedia();
  const { t } = useI18n();
  const headingId = useId();
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [picking, setPicking] = useState(false);
  const pending = useRef<Pending | null>(null);
  const abort = useRef<AbortController | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort(); // every step stops: nothing is attached after the person has gone
    };
  }, []);
  const busy = phase.step !== "idle" && phase.step !== "failed";
  const set = (next: Phase) => mounted.current && setPhase(next);
  const failed = (why: Failure, retry: boolean) => set({ step: "failed", why, retry });

  /** From where it stopped: the presign, the upload's complete, or attaching the same picture. */
  const run = async () => {
    const pendingNow = pending.current;
    if (!pendingNow) return;
    setNotice(null);
    const controller = new AbortController();
    abort.current = controller;
    const stopped = () => controller.signal.aborted || !mounted.current;
    const cancelled = () => failed("cancelled", true);

    if (!pendingNow.assetId && pendingNow.job) {
      const uploaded = await runUpload(media, { orgId, pubId }, pendingNow.job, controller.signal, set);
      if (stopped()) return cancelled();
      if (!uploaded.ok) return failed(uploaded.why, uploaded.retry);
      pendingNow.assetId = uploaded.asset.id;
    }
    if (!pendingNow.assetId) return;
    set({ step: "attaching" });
    const attached = await onAttach(pendingNow.assetId, controller.signal, pendingNow.defaults);
    if (stopped() || (!attached.ok && attached.cancelled)) return cancelled();
    if (!attached.ok) {
      if (attached.conflict) return failed(attached.photoChanged ? "conflictPhoto" : "conflict", true);
      return failed(attached.problem ? { problem: attached.problem, stage: "attach" } : "conflict", true);
    }
    pending.current = null;
    set({ step: "idle" });
    if (mounted.current) setNotice(t("photo.attached"));
  };

  const start = (file: File | undefined) => {
    if (!file) return;
    setNotice(null);
    // checked here first: nothing is sent for a file the API would refuse
    const refusal = refuseFile(file);
    if (refusal) return failed(refusal, false);
    pending.current = { job: uploadJob(file, "story_photo") };
    void run();
  };

  const picker = (ref: React.RefObject<HTMLInputElement | null>, capture: boolean, label: string) => (
    <input
      ref={ref}
      type="file"
      accept={ACCEPT}
      {...(capture ? { capture: "environment" as const } : {})}
      className="pg-visually-hidden"
      tabIndex={-1}
      aria-hidden="true"
      aria-label={label}
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = ""; // the same file may be chosen again
        start(file);
      }}
    />
  );

  const photo = story.photo;
  const kept = keptBecause !== null && (caption !== "" || credit !== "");
  if (!photo && !may && !kept) return null;
  return (
    <section aria-labelledby={headingId} className="pg-photo">
      <Stack gap="3">
        <h2 id={headingId} className="pg-type-section-title">
          {t("glossary.photo")}
        </h2>
        <div aria-live="polite">{notice && <p>{notice}</p>}</div>
        {photo && mayView && photo.status !== "rejected" && photo.status !== "failed" && (
          <PhotoView orgId={orgId} pubId={pubId} story={story} />
        )}
        {photo && <PhotoState photo={photo} />}
        {kept && keptBecause ? (
          <KeptCaption caption={caption} credit={credit} why={keptBecause} onDiscard={onDiscardKept} />
        ) : (
          photo && (
            <>
              <Field label={t("glossary.caption")}>
                <TextArea data-field="caption" lang={lang} rows={2} value={caption} readOnly={locked} onChange={(event) => onCaption(event.target.value)} onBlur={onLeave} />
              </Field>
              <Field label={t("glossary.photoCredit")}>
                <TextInput data-field="credit" value={credit} readOnly={locked} onChange={(event) => onCredit(event.target.value)} onBlur={onLeave} />
              </Field>
            </>
          )
        )}
        {may && (
          <Stack gap="2">
            <p className="pg-type-body-small">{t("photo.privacy")}</p>
            <p className="pg-type-body-small">{t("photo.formats")}</p>
          </Stack>
        )}

        {(phase.step === "presigning" || phase.step === "sending") && (
          <Stack gap="2">
            {phase.step === "sending" ? (
              <ProgressIndicator
                role="status"
                label={t("photo.sending", { percent: Math.round(phase.fraction * 100) })}
                value={Math.round(phase.fraction * 100)}
              />
            ) : (
              <ProgressIndicator role="status" label={t("photo.preparing")} />
            )}
          </Stack>
        )}
        {phase.step === "completing" && <ProgressIndicator role="status" label={t("photo.completing")} />}
        {phase.step === "attaching" && <ProgressIndicator role="status" label={t("photo.attaching")} />}
        {busy && (
          <div>
            <Button variant="secondary" size="sm" onClick={() => abort.current?.abort()}>
              {t("photo.cancel")}
            </Button>
          </div>
        )}
        {phase.step === "failed" && (
          <Stack gap="2">
            <FailureMessage why={phase.why} />
            {phase.retry && pending.current && (
              <div>
                <Button variant="secondary" size="sm" onClick={() => void run()}>
                  {pending.current.assetId ? t("photo.attachAgain") : t("photo.retry")}
                </Button>
              </div>
            )}
          </Stack>
        )}

        {may && (
          <Cluster gap="3">
            {picker(camera, true, photo ? t("photo.replaceTake") : t("photo.take"))}
            {picker(gallery, false, photo ? t("photo.replaceChoose") : t("photo.choose"))}
            <Button variant="secondary" disabled={busy || locked} onClick={() => camera.current?.click()}>
              {photo ? t("photo.replaceTake") : t("photo.take")}
            </Button>
            <Button variant="secondary" disabled={busy || locked} onClick={() => gallery.current?.click()}>
              {photo ? t("photo.replaceChoose") : t("photo.choose")}
            </Button>
            {mayView && (
              <Button variant="secondary" disabled={busy || locked} onClick={() => setPicking(true)}>
                {t("library.choose")}
              </Button>
            )}
            {photo && (
              <Button variant="danger" disabled={busy || locked} onClick={() => setRemoving(true)}>
                {t("photo.remove")}
              </Button>
            )}
          </Cluster>
        )}
      </Stack>
      <Drawer open={picking} onClose={() => setPicking(false)} title={t("library.choose")} closeLabel={t("shell.closeDialog")} size="wide">
        <MediaGrid
          orgId={orgId}
          pubId={pubId}
          compact
          picker
          onChoose={(item) => {
            setPicking(false);
            pending.current = { assetId: item.id, defaults: { caption: item.caption, credit: item.credit } };
            void run();
          }}
        />
      </Drawer>
      {removing && (
        <Dialog open onClose={() => setRemoving(false)} title={t("photo.remove.title")} closeLabel={t("shell.closeDialog")}>
          <Stack gap="4">
            <p>{t("photo.remove.body")}</p>
            <Cluster gap="3">
              <Button
                variant="danger"
                onClick={async () => {
                  setRemoving(false);
                  const removed = await onRemove();
                  if (!mounted.current) return;
                  if (removed.ok) setNotice(t("photo.removed"));
                  else failed(removed.problem ? { problem: removed.problem, stage: "attach" } : "conflict", false);
                }}
              >
                {t("photo.remove.confirm")}
              </Button>
              <Button variant="secondary" onClick={() => setRemoving(false)}>
                {t("security.cancel")}
              </Button>
            </Cluster>
          </Stack>
        </Dialog>
      )}
    </section>
  );
}
