/**
 * The Ads desk, /org/:orgId/pub/:pubId/ads?date=YYYY-MM-DD (plan §1 L2.6; doc 04 §7.7; ads.view): a date to work on
 * (tomorrow by default), the bookings running that day and that day's edition (its cut-off, its bookings not placed
 * and why, "Place booked ads"), all bookings, the advertisers, and the cut-off settings. Booking, artwork and
 * advertisers need ads.manage; placing needs ads.manage or layout.generate; the cut-off ads.manage or settings.edit.
 * Only back-page ads in the engine's real slots are offered; inside-page ads, PDF artwork and a colour/mono page map
 * are not (they do not work yet).
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import {
  Badge,
  Button,
  Cluster,
  Dialog,
  EmptyState,
  Field,
  Icon,
  InlineMessage,
  PageHeader,
  Panel,
  Stack,
  Table,
  TableCell,
  TableHeader,
  TextArea,
  TextInput,
} from "../../ui/index.ts";
import { paths, ROUTE_HEADING_ID } from "../../app/routes.ts";
import { formatDate, formatDateTime } from "../../i18n/dates.ts";
import { useI18n } from "../../i18n/index.ts";
import type {
  AdSettingsDto,
  AdSizesDto,
  AdvertiserDto,
  ApiProblem,
  BookingDto,
  EditionPlanDto,
} from "../../services/index.ts";
import { OfflineNotice } from "../auth/connection.tsx";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";
import { useSession } from "../auth/SessionProvider.tsx";
import { usePublicationEditions } from "../editions/editions-context.tsx";
import { todayInIndia } from "../layout/TodayCard.tsx";
import { adsAccess, type AdsAccess } from "./access.ts";
import { useAds } from "./ads-context.tsx";
import {
  ArtworkBadge,
  artworkState,
  colourText,
  datesText,
  positionText,
  reasonText,
  sizeText,
} from "./ads-words.tsx";
import { BookingDrawer, nextDay } from "./BookingDrawer.tsx";
import "./ads.css";

interface Where {
  readonly orgId: string;
  readonly pubId: string;
}

type Editing = { readonly booking: BookingDto | null } | null;

export function AdsScreen() {
  const { orgId = "", pubId = "" } = useParams<{ orgId: string; pubId: string }>();
  const { state } = useSession();
  const { t } = useI18n();
  const org =
    state.status === "ready"
      ? state.workspace?.organizations.find((candidate) => candidate.org.id === orgId)
      : undefined;
  const publication = org?.publications.find((candidate) => candidate.id === pubId);
  const access = adsAccess(org, pubId);
  const where = useMemo(() => ({ orgId, pubId }), [orgId, pubId]);
  return (
    <Stack gap="5" className="pg-ads">
      <PageHeader
        title={t("adsDesk.title")}
        headingId={ROUTE_HEADING_ID}
        {...(publication ? { subtitle: publication.name } : {})}
      />
      <OfflineNotice />
      {access.view && <Desk where={where} access={access} />}
    </Stack>
  );
}

function Desk({ where, access }: { readonly where: Where; readonly access: AdsAccess }) {
  const ads = useAds();
  const { t, language } = useI18n();
  const [search, setSearch] = useSearchParams();
  const asked = search.get("date") ?? "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : nextDay(todayInIndia());
  const [sizes, setSizes] = useState<AdSizesDto["slots"] | null>(null);
  const [advertisers, setAdvertisers] = useState<readonly AdvertiserDto[]>([]);
  const [running, setRunning] = useState<readonly BookingDto[] | null>(null);
  const [all, setAll] = useState<readonly BookingDto[] | null>(null);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<Editing>(null);
  const [cancelling, setCancelling] = useState<BookingDto | null>(null);
  const refresh = useCallback(() => setVersion((count) => count + 1), []);

  useEffect(() => {
    let current = true;
    void Promise.all([
      ads.sizes(where),
      ads.advertisers(where),
      ads.bookings({ ...where, from: date, to: date }),
      ads.bookings(where),
    ]).then(([sized, listed, day, every]) => {
      if (!current) return;
      const failed = [sized, listed, day, every].find((result) => !result.ok);
      setProblem(failed && !failed.ok ? failed.error : null);
      if (sized.ok) setSizes(sized.value.slots);
      if (listed.ok) setAdvertisers(listed.value);
      if (day.ok) setRunning(day.value);
      if (every.ok) setAll(every.value);
    });
    return () => {
      current = false;
    };
  }, [ads, where, date, version]);

  const choose = (next: string) =>
    setSearch(
      (now) => {
        const params = new URLSearchParams(now);
        params.set("date", next);
        return params;
      },
      { replace: true },
    );

  const cancel = async (booking: BookingDto) => {
    setCancelling(null);
    const result = await ads.editBooking({ ...where, id: booking.id, patch: { status: "cancelled" } });
    if (!result.ok) setProblem(result.error);
    refresh();
  };

  const table = (list: readonly BookingDto[] | null, caption: string) =>
    list && (
      <BookingTable
        bookings={list}
        caption={caption}
        manage={access.manage}
        onEdit={(booking) => setEditing({ booking })}
        onCancel={setCancelling}
      />
    );

  return (
    <Stack gap="5">
      <Cluster gap="3" className="pg-ads__toolbar">
        <Field label={t("adsDesk.date")}>
          <TextInput type="date" value={date} onChange={(event) => event.target.value && choose(event.target.value)} />
        </Field>
        {access.manage && (
          // the sizes come first: a booking is for one of them
          <Button disabled={!sizes?.length} onClick={() => setEditing({ booking: null })}>
            <Icon name="plus" size={16} />
            {t("adsDesk.newBooking")}
          </Button>
        )}
      </Cluster>
      {access.manage && sizes?.length === 0 && (
        <InlineMessage variant="info" heading={t("adsDesk.sizes.none")} iconLabel={t("message.info")} />
      )}
      {problem && <ProblemMessage problem={problem} />}

      <Panel title={t("adsDesk.running", { date: formatDate(date, language) })}>
        {running && running.length === 0 ? (
          <p>{t("adsDesk.running.none")}</p>
        ) : (
          table(running, t("adsDesk.running", { date: formatDate(date, language) }))
        )}
      </Panel>

      <EditionDay where={where} access={access} date={date} version={version} onPlaced={refresh} />

      <Panel title={t("adsDesk.all")}>
        {all && all.length === 0 ? (
          <EmptyState icon="megaphone" heading={t("adsDesk.all.none")} headingLevel={3} />
        ) : (
          table(all, t("adsDesk.all"))
        )}
      </Panel>

      <Advertisers where={where} manage={access.manage} advertisers={advertisers} onChanged={refresh} />

      {access.settings && <CutoffSettings where={where} />}

      {editing && sizes && (
        <BookingDrawer
          where={where}
          booking={editing.booking}
          sizes={sizes}
          advertisers={advertisers}
          date={date}
          mayUpload={access.upload}
          onClose={() => setEditing(null)}
          onAdvertiserAdded={refresh}
          onSaved={(booking) => {
            setEditing({ booking });
            refresh();
          }}
        />
      )}
      {cancelling && (
        <Dialog
          open
          onClose={() => setCancelling(null)}
          title={t("adsDesk.cancel.title")}
          closeLabel={t("shell.closeDialog")}
        >
          <Stack gap="4">
            <p>{t("adsDesk.cancel.message", { advertiser: cancelling.advertiser.name })}</p>
            <Cluster gap="3">
              <Button variant="danger" onClick={() => void cancel(cancelling)}>
                {t("adsDesk.cancel.confirm")}
              </Button>
              <Button variant="secondary" onClick={() => setCancelling(null)}>
                {t("adsDesk.cancel.keep")}
              </Button>
            </Cluster>
          </Stack>
        </Dialog>
      )}
    </Stack>
  );
}

function BookingTable({
  bookings,
  caption,
  manage,
  onEdit,
  onCancel,
}: {
  readonly bookings: readonly BookingDto[];
  readonly caption: string;
  readonly manage: boolean;
  readonly onEdit: (booking: BookingDto) => void;
  readonly onCancel: (booking: BookingDto) => void;
}) {
  const { t, language } = useI18n();
  return (
    <Table caption={caption}>
      <thead>
        <tr>
          <TableHeader>{t("adsDesk.col.advertiser")}</TableHeader>
          <TableHeader>{t("adsDesk.col.size")}</TableHeader>
          <TableHeader>{t("adsDesk.col.dates")}</TableHeader>
          <TableHeader>{t("adsDesk.col.artwork")}</TableHeader>
          <TableHeader>{t("adsDesk.col.placed")}</TableHeader>
          {manage && (
            <TableHeader>
              <span className="pg-visually-hidden">{t("adsDesk.col.actions")}</span>
            </TableHeader>
          )}
        </tr>
      </thead>
      <tbody>
        {bookings.map((booking) => (
          <tr key={booking.id}>
            <TableCell>
              <bdi className="pg-ads__name">{booking.advertiser.name}</bdi>
              {booking.campaign && <bdi className="pg-ads__note">{booking.campaign}</bdi>}
              {booking.status === "cancelled" && <Badge tone="neutral">{t("adsDesk.status.cancelled")}</Badge>}
            </TableCell>
            <TableCell>
              {sizeText(booking, t)}
              <span className="pg-ads__note">
                {positionText(booking.slot, t)} · {colourText(booking.colour, t)}
              </span>
            </TableCell>
            <TableCell>{datesText(booking.dates, t, language)}</TableCell>
            <TableCell>
              <ArtworkBadge artwork={artworkState(booking)} t={t} />
            </TableCell>
            <TableCell>
              {booking.placements.length === 0 ? (
                t("adsDesk.placed.none")
              ) : (
                <ul className="pg-ads__plain">
                  {booking.placements.map((placement) => (
                    <li key={`${placement.editionId}:${placement.slot}`}>
                      {t("adsDesk.placed.one", { date: formatDate(placement.date, language), slot: placement.slot })}
                    </li>
                  ))}
                </ul>
              )}
            </TableCell>
            {manage && (
              <TableCell>
                <Cluster gap="2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onEdit(booking)}
                    aria-label={t("adsDesk.edit.label", { advertiser: booking.advertiser.name })}
                  >
                    {t("adsDesk.edit")}
                  </Button>
                  {booking.status === "booked" && (
                    <Button
                      variant="quiet"
                      size="sm"
                      onClick={() => onCancel(booking)}
                      aria-label={t("adsDesk.cancel.label", { advertiser: booking.advertiser.name })}
                    >
                      {t("adsDesk.cancel")}
                    </Button>
                  )}
                </Cluster>
              </TableCell>
            )}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** The chosen date's edition: its cut-off, its bookings not placed and why, and "Place booked ads". */
function EditionDay({
  where,
  access,
  date,
  version,
  onPlaced,
}: {
  readonly where: Where;
  readonly access: AdsAccess;
  readonly date: string;
  readonly version: number;
  readonly onPlaced: () => void;
}) {
  const ads = useAds();
  const { t, language } = useI18n();
  const editions = usePublicationEditions(where.orgId, where.pubId, access.plan);
  const edition = editions?.find((candidate) => candidate.date === date);
  const [plan, setPlan] = useState<EditionPlanDto | null>(null);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [busy, setBusy] = useState(false);
  const editionId = edition?.id;

  useEffect(() => {
    setPlan(null);
    setProblem(null);
    if (!editionId) return;
    let current = true;
    void ads.plan({ ...where, editionId }).then((result) => {
      if (!current) return;
      if (result.ok) setPlan(result.value);
      else setProblem(result.error);
    });
    return () => {
      current = false;
    };
  }, [ads, where, editionId, version]);

  if (!access.plan || editions === null) return null;
  const title = t("adsDesk.edition", { date: formatDate(date, language) });
  if (!edition) {
    return (
      <Panel title={title}>
        <p>{t("adsDesk.edition.none")}</p>
      </Panel>
    );
  }
  const place = async () => {
    setBusy(true);
    setProblem(null);
    const result = await ads.placeBooked({ ...where, editionId: edition.id });
    setBusy(false);
    if (!result.ok) return setProblem(result.error);
    setPlan(result.value);
    onPlaced();
  };
  return (
    <Panel
      title={title}
      actions={
        <Link to={`${paths.pubEditionLayout(where.orgId, where.pubId, edition.id)}?tab=plan`}>
          {t("adsDesk.edition.open")}
        </Link>
      }
    >
      <Stack gap="3">
        {problem && <ProblemMessage problem={problem} />}
        {plan && (
          <>
            <p>{t("adsDesk.cutoff.at", { at: formatDateTime(plan.cutoff.at, language) })}</p>
            {plan.unplaced.length === 0 ? (
              <p>{t("adsDesk.unplaced.none")}</p>
            ) : (
              <UnplacedList plan={plan} />
            )}
            {access.place && !plan.released && plan.unplaced.length > 0 && (
              <div>
                <Button variant="secondary" disabled={busy} aria-busy={busy} onClick={() => void place()}>
                  {t("adsDesk.placeBooked")}
                </Button>
              </div>
            )}
          </>
        )}
      </Stack>
    </Panel>
  );
}

/** The bookings of an edition's date not placed in it, and why. */
export function UnplacedList({ plan }: { readonly plan: EditionPlanDto }) {
  const { t } = useI18n();
  return (
    <section aria-labelledby={`pg-ads-unplaced-${plan.editionId}`}>
      <h3 id={`pg-ads-unplaced-${plan.editionId}`} className="pg-ads__subhead">
        {plan.unplaced.length === 1 ? t("adsDesk.unplaced.one") : t("adsDesk.unplaced", { count: plan.unplaced.length })}
      </h3>
      <ul className="pg-ads__plain">
        {plan.unplaced.map(({ booking, reason }) => (
          <li key={booking.id}>
            <bdi className="pg-ads__name">{booking.advertiser}</bdi> · {sizeText(booking, t)} — {reasonText(reason, t)}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ----------------------------------------------------------------------------------------------------- Advertisers

function Advertisers({
  where,
  manage,
  advertisers,
  onChanged,
}: {
  readonly where: Where;
  readonly manage: boolean;
  readonly advertisers: readonly AdvertiserDto[];
  readonly onChanged: () => void;
}) {
  const ads = useAds();
  const { t } = useI18n();
  const [editing, setEditing] = useState<{ readonly advertiser: AdvertiserDto | null } | null>(null);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [archiving, setArchiving] = useState<AdvertiserDto | null>(null);

  const archive = async (advertiser: AdvertiserDto) => {
    setArchiving(null);
    setProblem(null);
    const result = await ads.editAdvertiser({ ...where, id: advertiser.id, patch: { archived: !advertiser.archived } });
    if (!result.ok) setProblem(result.error);
    onChanged();
  };

  return (
    <Panel
      title={t("adsDesk.advertisers")}
      actions={
        manage && (
          <Button variant="secondary" size="sm" onClick={() => setEditing({ advertiser: null })}>
            <Icon name="plus" size={16} />
            {t("adsDesk.advertiser.add")}
          </Button>
        )
      }
    >
      <Stack gap="3">
        {problem && <ProblemMessage problem={problem} />}
        {advertisers.length === 0 ? (
          <p>{t("adsDesk.advertisers.none")}</p>
        ) : (
          <Table caption={t("adsDesk.advertisers")}>
            <thead>
              <tr>
                <TableHeader>{t("adsDesk.advertiser.name")}</TableHeader>
                <TableHeader>{t("adsDesk.advertiser.contact")}</TableHeader>
                <TableHeader numeric>{t("adsDesk.advertiser.bookings")}</TableHeader>
                {manage && (
                  <TableHeader>
                    <span className="pg-visually-hidden">{t("adsDesk.col.actions")}</span>
                  </TableHeader>
                )}
              </tr>
            </thead>
            <tbody>
              {advertisers.map((advertiser) => (
                <tr key={advertiser.id}>
                  <TableCell>
                    <bdi className="pg-ads__name">{advertiser.name}</bdi>
                    {advertiser.archived && <Badge tone="neutral">{t("adsDesk.advertiser.archived")}</Badge>}
                  </TableCell>
                  <TableCell>
                    {[advertiser.contactName, advertiser.phone, advertiser.email].filter(Boolean).join(" · ")}
                  </TableCell>
                  <TableCell numeric>{advertiser.bookings}</TableCell>
                  {manage && (
                    <TableCell>
                      <Cluster gap="2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setEditing({ advertiser })}
                          aria-label={t("adsDesk.advertiser.edit.label", { name: advertiser.name })}
                        >
                          {t("adsDesk.edit")}
                        </Button>
                        <Button
                          variant="quiet"
                          size="sm"
                          onClick={() => (advertiser.archived ? void archive(advertiser) : setArchiving(advertiser))}
                        >
                          {advertiser.archived
                            ? t("adsDesk.advertiser.restore", { name: advertiser.name })
                            : t("adsDesk.advertiser.archive", { name: advertiser.name })}
                        </Button>
                      </Cluster>
                    </TableCell>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Stack>
      {archiving && (
        <Dialog
          open
          onClose={() => setArchiving(null)}
          title={t("adsDesk.advertiser.archiveTitle", { name: archiving.name })}
          closeLabel={t("shell.closeDialog")}
        >
          <Stack gap="4">
            <p>{t("adsDesk.advertiser.archiveMessage")}</p>
            <Cluster gap="3">
              <Button variant="danger" onClick={() => void archive(archiving)}>
                {t("adsDesk.advertiser.archiveConfirm")}
              </Button>
              <Button variant="secondary" onClick={() => setArchiving(null)}>
                {t("adsDesk.advertiser.keep")}
              </Button>
            </Cluster>
          </Stack>
        </Dialog>
      )}
      {editing && (
        <AdvertiserDialog
          where={where}
          advertiser={editing.advertiser}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
    </Panel>
  );
}

function AdvertiserDialog({
  where,
  advertiser,
  onClose,
  onSaved,
}: {
  readonly where: Where;
  readonly advertiser: AdvertiserDto | null;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const ads = useAds();
  const { t } = useI18n();
  const [fields, setFields] = useState({
    name: advertiser?.name ?? "",
    contactName: advertiser?.contactName ?? "",
    phone: advertiser?.phone ?? "",
    email: advertiser?.email ?? "",
    note: advertiser?.note ?? "",
  });
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const set = (field: keyof typeof fields) => (event: { target: { value: string } }) =>
    setFields((now) => ({ ...now, [field]: event.target.value }));
  const missing = !fields.name.trim();

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTried(true);
    if (missing) return;
    setBusy(true);
    setProblem(null);
    const input = {
      name: fields.name.trim(),
      contactName: fields.contactName.trim(),
      phone: fields.phone.trim(),
      email: fields.email.trim(),
      note: fields.note.trim(),
    };
    const result = advertiser
      ? await ads.editAdvertiser({ ...where, id: advertiser.id, patch: input })
      : await ads.addAdvertiser({ ...where, input });
    setBusy(false);
    if (!result.ok) return setProblem(result.error);
    onSaved();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={advertiser ? t("adsDesk.advertiser.editTitle") : t("adsDesk.advertiser.add")}
      closeLabel={t("shell.closeDialog")}
    >
      <form onSubmit={(event) => void save(event)} noValidate>
        <Stack gap="4">
          <Field
            label={t("adsDesk.advertiser.name")}
            required
            requiredLabel={t("form.required")}
            errors={tried && missing ? [t("adsDesk.advertiser.name.missing")] : []}
          >
            <TextInput value={fields.name} maxLength={200} onChange={set("name")} />
          </Field>
          <Field label={t("adsDesk.advertiser.contactName")}>
            <TextInput value={fields.contactName} maxLength={200} onChange={set("contactName")} />
          </Field>
          <Field label={t("adsDesk.advertiser.phone")}>
            <TextInput type="tel" value={fields.phone} maxLength={200} onChange={set("phone")} />
          </Field>
          <Field label={t("adsDesk.advertiser.email")}>
            <TextInput type="email" value={fields.email} maxLength={200} onChange={set("email")} />
          </Field>
          <Field label={t("adsDesk.form.note")}>
            <TextArea rows={3} maxLength={2000} value={fields.note} onChange={set("note")} />
          </Field>
          {problem && <ProblemMessage problem={problem} />}
          <Cluster gap="3">
            <Button type="submit" disabled={busy} aria-busy={busy}>
              {t("adsDesk.form.save")}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              {t("adsDesk.form.close")}
            </Button>
          </Cluster>
        </Stack>
      </form>
    </Dialog>
  );
}

// --------------------------------------------------------------------------------------------------------- Cut-off

function CutoffSettings({ where }: { readonly where: Where }) {
  const ads = useAds();
  const { t } = useI18n();
  const [settings, setSettings] = useState<AdSettingsDto | null>(null);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  /** the days field as typed: it may be empty or out of range while being edited */
  const [days, setDays] = useState("");
  const daysOk = /^[0-7]$/.test(days.trim());

  useEffect(() => {
    let current = true;
    void ads.settings(where).then((result) => {
      if (!current) return;
      if (!result.ok) return setProblem(result.error);
      setSettings(result.value);
      setDays(String(result.value.daysBefore));
    });
    return () => {
      current = false;
    };
  }, [ads, where]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!settings || !daysOk) return;
    setBusy(true);
    setSaved(false);
    setProblem(null);
    const result = await ads.saveSettings({ ...where, settings: { ...settings, daysBefore: Number(days) } });
    setBusy(false);
    if (!result.ok) return setProblem(result.error);
    setSettings(result.value);
    setSaved(true);
  };

  return (
    <Panel title={t("adsDesk.cutoff")}>
      <Stack gap="3">
        <p className="pg-ads__note">{t("adsDesk.cutoff.hint")}</p>
        {problem && <ProblemMessage problem={problem} />}
        {settings && (
          <form onSubmit={(event) => void save(event)}>
            <Cluster gap="3" className="pg-ads__toolbar">
              <Field label={t("adsDesk.cutoff.time")}>
                <TextInput
                  type="time"
                  required
                  value={settings.cutoffTime}
                  onChange={(event) => (setSaved(false), setSettings({ ...settings, cutoffTime: event.target.value }))}
                />
              </Field>
              <Field label={t("adsDesk.cutoff.days")} errors={daysOk ? [] : [t("adsDesk.cutoff.days.invalid")]}>
                <TextInput
                  type="number"
                  min={0}
                  max={7}
                  step={1}
                  inputMode="numeric"
                  value={days}
                  onChange={(event) => (setSaved(false), setDays(event.target.value))}
                />
              </Field>
              <Button type="submit" disabled={busy || !daysOk} aria-busy={busy}>
                {t("adsDesk.cutoff.save")}
              </Button>
            </Cluster>
          </form>
        )}
        <div aria-live="polite">{saved && <p>{t("adsDesk.cutoff.saved")}</p>}</div>
      </Stack>
    </Panel>
  );
}
