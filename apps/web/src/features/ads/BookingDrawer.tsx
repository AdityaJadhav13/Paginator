/**
 * A booking, made or changed (ads.manage; POST …/bookings with an Idempotency-Key kept while the drawer is open, PATCH
 * …/bookings/:id): the advertiser (picked, or added here), the campaign, a size of the profile's real back-page slots
 * only (GET ads/sizes) with its position rule, colour or black-and-white (recorded, never checked), the run dates (a
 * list, or "every day from … to …"), a note. Once it exists, its artwork: a picture uploaded to the media library
 * (purpose library) and set on it (PUT …/artwork), with the API's check shown. A PDF, or any file that is not a JPEG,
 * PNG or WebP, is refused before anything is sent. The Idempotency-Key is new whenever what is sent changes, or after
 * the API answered a failure; a retry after a lost answer keeps it.
 */
import { useRef, useState, type FormEvent } from "react";
import { MAX_BOOKING_DATES } from "@pageinator/contracts";
import {
  Button,
  Cluster,
  Drawer,
  Field,
  Icon,
  InlineMessage,
  RadioGroup,
  Select,
  Stack,
  TextArea,
  TextInput,
} from "../../ui/index.ts";
import { randomUuid } from "../../api/client.ts";
import { formatDate } from "../../i18n/dates.ts";
import { useI18n } from "../../i18n/index.ts";
import type { AdSizesDto, AdvertiserDto, ApiProblem, BookingDto } from "../../services/index.ts";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";
import { ACCEPT, refuseFile, runUpload, uploadJob, UploadFailureMessage, type UploadFailure } from "../media/upload.tsx";
import { MediaGrid } from "../media/MediaGrid.tsx";
import { useMedia } from "../stories/media-context.tsx";
import { useAds } from "./ads-context.tsx";
import { ArtworkCard, slotText } from "./ads-words.tsx";

const NEW = "new";

/** The day after `iso` (YYYY-MM-DD), as a calendar date. */
export function nextDay(iso: string): string {
  const day = new Date(`${iso}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

/** Every day from `from` to `to`, both included; null when that is more than a booking may run. */
export function everyDay(from: string, to: string): string[] | null {
  const days: string[] = [];
  for (let day = from; day <= to; day = nextDay(day)) {
    if (days.length === MAX_BOOKING_DATES) return null;
    days.push(day);
  }
  return days;
}

interface Where {
  readonly orgId: string;
  readonly pubId: string;
}

export function BookingDrawer({
  where,
  booking,
  sizes,
  advertisers,
  date,
  mayUpload,
  onClose,
  onSaved,
  onAdvertiserAdded,
}: {
  readonly where: Where;
  /** media.upload or ads.manage: a new picture may be uploaded as artwork */
  readonly mayUpload: boolean;
  /** null: a new booking */
  readonly booking: BookingDto | null;
  readonly sizes: AdSizesDto["slots"];
  readonly advertisers: readonly AdvertiserDto[];
  /** the desk's date: a new booking's first run date */
  readonly date: string;
  readonly onClose: () => void;
  readonly onSaved: (booking: BookingDto) => void;
  /** an advertiser was added here: the list is asked for again */
  readonly onAdvertiserAdded: () => void;
}) {
  const ads = useAds();
  const { t, language } = useI18n();
  const [advertiserId, setAdvertiserId] = useState(booking?.advertiser.id ?? "");
  const [newName, setNewName] = useState("");
  const [campaign, setCampaign] = useState(booking?.campaign ?? "");
  const [slot, setSlot] = useState(
    booking
      ? (booking.slot ?? sizes.find((size) => size.wMm === booking.wMm && size.hMm === booking.hMm)?.slot ?? "")
      : "",
  );
  const [rule, setRule] = useState<"slot" | "any">(booking && booking.slot === null ? "any" : "slot");
  const [colour, setColour] = useState<BookingDto["colour"]>(booking?.colour ?? "colour");
  const [dates, setDates] = useState<string[]>(booking ? [...booking.dates] : [date]);
  const [adding, setAdding] = useState("");
  const [from, setFrom] = useState(date);
  const [to, setTo] = useState(date);
  const [note, setNote] = useState(booking?.note ?? "");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [said, setSaid] = useState("");
  const sent = useRef<{ readonly key: string; readonly body: string } | null>(null);

  const size = sizes.find((one) => one.slot === slot);
  const errors = {
    advertiser: !advertiserId || (advertiserId === NEW && !newName.trim()) ? [t("adsDesk.form.advertiser.missing")] : [],
    size: !size ? [t("adsDesk.form.size.missing")] : [],
    dates: dates.length === 0 ? [t("adsDesk.form.dates.missing")] : [],
  };
  const shown = (list: string[]) => (tried ? list : []);
  const addDates = (more: readonly string[]) => setDates((now) => [...new Set([...now, ...more])].sort());

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTried(true);
    setSaid("");
    if (errors.advertiser.length || errors.size.length || errors.dates.length || !size) return;
    setBusy(true);
    setProblem(null);
    const fields = {
      campaign: campaign.trim(),
      wMm: size.wMm,
      hMm: size.hMm,
      colour,
      slot: rule === "slot" ? size.slot : null,
      dates,
      note: note.trim(),
    };
    let result;
    if (booking) {
      result = await ads.editBooking({ ...where, id: booking.id, patch: fields });
    } else {
      let id = advertiserId;
      if (id === NEW) {
        const made = await ads.addAdvertiser({ ...where, input: { name: newName.trim() } });
        if (!made.ok) {
          setBusy(false);
          return setProblem(made.error);
        }
        id = made.value.id;
        setAdvertiserId(id);
        onAdvertiserAdded();
      }
      const input = { advertiserId: id, ...fields };
      const body = JSON.stringify(input);
      if (sent.current?.body !== body) sent.current = { key: randomUuid(), body };
      result = await ads.book({ ...where, input, idempotencyKey: sent.current.key });
      // an answered failure is final for that key; a lost answer is retried with the same one
      if (result.ok || result.error.kind === "answer") sent.current = null;
    }
    setBusy(false);
    if (!result.ok) return setProblem(result.error);
    setSaid(t("adsDesk.form.saved"));
    onSaved(result.value);
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={booking ? t("adsDesk.form.editTitle", { advertiser: booking.advertiser.name }) : t("adsDesk.form.newTitle")}
      closeLabel={t("shell.closeDialog")}
      size="wide"
      footer={
        <Cluster gap="3">
          <Button type="submit" form="pg-ads-booking" disabled={busy || sizes.length === 0} aria-busy={busy}>
            {booking ? t("adsDesk.form.save") : t("adsDesk.form.book")}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {t("adsDesk.form.close")}
          </Button>
        </Cluster>
      }
    >
      <Stack gap="5">
        {sizes.length === 0 && (
          <InlineMessage variant="info" heading={t("adsDesk.sizes.none")} iconLabel={t("message.info")} />
        )}
        <form id="pg-ads-booking" onSubmit={(event) => void save(event)} noValidate>
          <Stack gap="4">
            {booking ? (
              <p>
                <strong>{t("adsDesk.form.advertiser")}:</strong> <bdi>{booking.advertiser.name}</bdi>
              </p>
            ) : (
              <>
                <Field label={t("adsDesk.form.advertiser")} errors={shown(errors.advertiser)} required requiredLabel={t("form.required")}>
                  <Select value={advertiserId} onChange={(event) => setAdvertiserId(event.target.value)}>
                    <option value="">{t("adsDesk.form.advertiser.pick")}</option>
                    {advertisers
                      .filter((one) => !one.archived)
                      .map((one) => (
                        <option key={one.id} value={one.id}>
                          {one.name}
                        </option>
                      ))}
                    <option value={NEW}>{t("adsDesk.form.advertiser.new")}</option>
                  </Select>
                </Field>
                {advertiserId === NEW && (
                  <Field label={t("adsDesk.advertiser.name")} required requiredLabel={t("form.required")}>
                    <TextInput value={newName} maxLength={200} onChange={(event) => setNewName(event.target.value)} />
                  </Field>
                )}
              </>
            )}
            <Field label={t("adsDesk.form.campaign")}>
              <TextInput value={campaign} maxLength={200} onChange={(event) => setCampaign(event.target.value)} />
            </Field>
            <Field
              label={t("adsDesk.form.size")}
              description={t("adsDesk.form.size.hint")}
              errors={shown(errors.size)}
              required
              requiredLabel={t("form.required")}
            >
              <Select value={slot} onChange={(event) => setSlot(event.target.value)}>
                <option value="">{t("adsDesk.form.size.pick")}</option>
                {sizes.map((one) => (
                  <option key={one.slot} value={one.slot}>
                    {slotText(one, t)}
                  </option>
                ))}
              </Select>
            </Field>
            <RadioGroup
              legend={t("adsDesk.form.position")}
              name="pg-ads-position"
              value={rule}
              onChange={(value) => setRule(value as "slot" | "any")}
              options={[
                { value: "slot", label: t("adsDesk.form.position.slot") },
                { value: "any", label: t("adsDesk.form.position.any") },
              ]}
            />
            <RadioGroup
              legend={t("adsDesk.form.colour")}
              name="pg-ads-colour"
              value={colour}
              onChange={(value) => setColour(value as BookingDto["colour"])}
              options={[
                { value: "colour", label: t("adsDesk.colour.colour") },
                { value: "mono", label: t("adsDesk.colour.mono") },
              ]}
            />
            <fieldset className="pg-ads__dates">
              <legend>{t("adsDesk.form.dates")}</legend>
              <Stack gap="3">
                {shown(errors.dates).map((error) => (
                  <p key={error} className="pg-ads__error" role="alert">
                    {error}
                  </p>
                ))}
                <ul className="pg-ads__date-list" aria-label={t("adsDesk.form.dates.list", { count: dates.length })}>
                  {dates.map((day) => (
                    <li key={day}>
                      <span>{formatDate(day, language)}</span>
                      <Button
                        variant="quiet"
                        size="sm"
                        onClick={() => setDates((now) => now.filter((one) => one !== day))}
                        aria-label={t("adsDesk.form.dates.remove", { date: formatDate(day, language) })}
                      >
                        <Icon name="x" size={16} />
                      </Button>
                    </li>
                  ))}
                </ul>
                <Cluster gap="2" className="pg-ads__date-add">
                  <Field label={t("adsDesk.form.dates.add")}>
                    <TextInput type="date" value={adding} onChange={(event) => setAdding(event.target.value)} />
                  </Field>
                  <Button variant="secondary" disabled={!adding} onClick={() => (addDates([adding]), setAdding(""))}>
                    {t("adsDesk.form.dates.addButton")}
                  </Button>
                </Cluster>
                <Cluster gap="2" className="pg-ads__date-add">
                  <Field label={t("adsDesk.form.dates.from")}>
                    <TextInput type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
                  </Field>
                  <Field label={t("adsDesk.form.dates.to")}>
                    <TextInput type="date" value={to} onChange={(event) => setTo(event.target.value)} />
                  </Field>
                  <Button
                    variant="secondary"
                    disabled={!from || !to || to < from}
                    onClick={() => {
                      const days = everyDay(from, to);
                      if (days) addDates(days);
                      else setSaid(t("adsDesk.form.dates.tooMany", { count: MAX_BOOKING_DATES }));
                    }}
                  >
                    {t("adsDesk.form.dates.fill")}
                  </Button>
                </Cluster>
              </Stack>
            </fieldset>
            <Field label={t("adsDesk.form.note")}>
              <TextArea rows={3} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} />
            </Field>
          </Stack>
        </form>
        {problem && <ProblemMessage problem={problem} />}
        <div aria-live="polite">{said && <p>{said}</p>}</div>
        {booking && <ArtworkPanel where={where} booking={booking} mayUpload={mayUpload} onSaved={onSaved} />}
      </Stack>
    </Drawer>
  );
}

type Sending = { readonly step: "idle" } | { readonly step: "sending" } | { readonly step: "failed"; readonly why: UploadFailure | "pdf" };

const isPdf = (file: File) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);

/** The booking's artwork: uploaded, checked by the API, its card; taken off. */
function ArtworkPanel({
  where,
  booking,
  mayUpload,
  onSaved,
}: {
  readonly where: Where;
  readonly booking: BookingDto;
  readonly mayUpload: boolean;
  readonly onSaved: (booking: BookingDto) => void;
}) {
  const ads = useAds();
  const media = useMedia();
  const { t } = useI18n();
  const [sending, setSending] = useState<Sending>({ step: "idle" });
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [picking, setPicking] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const set = async (assetId: string) => {
    setProblem(null);
    const result = await ads.setArtwork({ ...where, id: booking.id, assetId });
    setSending({ step: "idle" });
    if (!result.ok) return setProblem(result.error);
    onSaved(result.value);
  };

  const choose = async (file: File) => {
    setProblem(null);
    const refusal = refuseFile(file);
    // a PDF (or any file not a JPEG, PNG or WebP) is not sent at all: PDF artwork needs sandboxed intake first
    if (refusal) return setSending({ step: "failed", why: refusal === "type" && isPdf(file) ? "pdf" : refusal });
    setSending({ step: "sending" });
    const uploaded = await runUpload(media, where, uploadJob(file, "library"), new AbortController().signal, () => {});
    if (!uploaded.ok) return setSending({ step: "failed", why: uploaded.why });
    await set(uploaded.asset.id);
  };

  const remove = async () => {
    setProblem(null);
    const result = await ads.clearArtwork({ ...where, id: booking.id });
    if (!result.ok) return setProblem(result.error);
    onSaved(result.value);
  };

  return (
    <section aria-labelledby="pg-ads-artwork" className="pg-ads__artwork">
      <Stack gap="3">
        <h3 id="pg-ads-artwork">{t("adsDesk.artwork.heading")}</h3>
        <p className="pg-ads__note">{t("adsDesk.artwork.hint")}</p>
        {/* only a ready picture has a preview (and only a ready one may be seen without media.view) */}
        {booking.artwork?.status === "ready" && (
          <div className="pg-ads__thumb">
            <img
              src={`${media.fileUrl({ ...where, assetId: booking.artwork.assetId })}?variant=preview`}
              alt={t("adsDesk.artwork.picture", { advertiser: booking.advertiser.name })}
            />
          </div>
        )}
        <ArtworkCard booking={booking} t={t} />
        <div aria-live="polite">{sending.step === "sending" && <p role="status">{t("adsDesk.artwork.sending")}</p>}</div>
        {sending.step === "failed" &&
          (sending.why === "pdf" ? (
            <InlineMessage variant="error" heading={t("adsDesk.artwork.pdf")} live iconLabel={t("message.error")} />
          ) : (
            <UploadFailureMessage why={sending.why} />
          ))}
        {problem && <ProblemMessage problem={problem} />}
        {mayUpload && (
        <input
          ref={input}
          type="file"
          className="pg-visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          aria-label={t("adsDesk.artwork.upload")}
          accept={`${ACCEPT},application/pdf`}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void choose(file);
          }}
        />
        )}
        <Cluster gap="3">
          {mayUpload && (
            <Button variant="secondary" disabled={sending.step === "sending"} onClick={() => input.current?.click()}>
              <Icon name="upload" size={16} />
              {booking.artwork ? t("adsDesk.artwork.replace") : t("adsDesk.artwork.upload")}
            </Button>
          )}
          <Button variant="secondary" disabled={sending.step === "sending"} onClick={() => setPicking((now) => !now)}>
            <Icon name="images" size={16} />
            {t("adsDesk.artwork.library")}
          </Button>
          {booking.artwork && (
            <Button variant="danger" disabled={sending.step === "sending"} onClick={() => void remove()}>
              {t("adsDesk.artwork.remove")}
            </Button>
          )}
        </Cluster>
        {picking && (
          <MediaGrid
            orgId={where.orgId}
            pubId={where.pubId}
            compact
            picker
            photoFilters={false}
            onChoose={(item) => {
              setPicking(false);
              void set(item.id);
            }}
          />
        )}
      </Stack>
    </section>
  );
}
