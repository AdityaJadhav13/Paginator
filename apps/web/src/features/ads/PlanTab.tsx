/**
 * An edition's Plan tab (plan §1 L2.6; doc 04 §7.3.1 the flatplan; GET …/editions/:e/plan, edition.view): a tile per
 * page with its role, its template role, its planned section and note to the designer (edition.edit, the whole cell),
 * the sections the last run placed on it, and on the back page its ad slots drawn to scale with the booking each
 * holds; the bookings not placed and why; a booking put into an empty slot or taken out, and "Place booked ads"
 * (ads.manage or layout.generate); "Copy plan from…" another edition of as many pages (edition.edit). A released
 * edition's plan is shown, never changed.
 */
import { useEffect, useState } from "react";
import { Badge, Button, Cluster, Dialog, Field, InlineMessage, RadioGroup, Select, Stack, TextArea } from "../../ui/index.ts";
import { formatDate, formatDateTime } from "../../i18n/dates.ts";
import { useI18n, type PlainKey, type Translate } from "../../i18n/index.ts";
import type { ApiProblem, EditionPlanDto, PlanPageDto, PlanSlotDto, PubEditionDto } from "../../services/index.ts";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";
import { usePublicationEditions } from "../editions/editions-context.tsx";
import { roleText } from "../layout/layout-words.tsx";
import type { AdsAccess } from "./access.ts";
import { useAds } from "./ads-context.tsx";
import { slotText } from "./ads-words.tsx";
import { UnplacedList } from "./AdsScreen.tsx";
import "./ads.css";

interface Where {
  readonly orgId: string;
  readonly pubId: string;
  readonly editionId: string;
}

type Section = { readonly id: string; readonly name: string };
type BookingRef = EditionPlanDto["unplaced"][number]["booking"];

/** A booking fits a slot: its size, and its position rule (that slot, or any of its size). */
const fitsSlot = (booking: BookingRef, slot: PlanSlotDto) =>
  booking.wMm === slot.wMm && booking.hMm === slot.hMm && (booking.slot === null || booking.slot === slot.slot);

/** The publication's sections, and the page's own planned one should it be archived since (saving keeps it). */
const sectionsFor = (plan: EditionPlanDto, tile: PlanPageDto): readonly Section[] =>
  tile.section && !plan.sections.some((section) => section.id === tile.section!.id)
    ? [...plan.sections, tile.section]
    : plan.sections;

/** A refusal in words: not_editable here means the edition was released meanwhile. */
function PlanProblem({ problem }: { readonly problem: ApiProblem }) {
  const { t } = useI18n();
  return problem.kind === "answer" && problem.code === "not_editable" ? (
    <InlineMessage variant="error" heading={t("plan.released")} live iconLabel={t("message.error")} />
  ) : (
    <ProblemMessage problem={problem} />
  );
}

/** "Copied: 2 pages' plans and 1 ad placement." */
const copiedText = (copied: { readonly pages: number; readonly placements: number }, t: Translate) =>
  t("plan.copied", {
    pages: copied.pages === 1 ? t("plan.copied.pages.one") : t("plan.copied.pages", { count: copied.pages }),
    placements:
      copied.placements === 1
        ? t("plan.copied.placements.one")
        : t("plan.copied.placements", { count: copied.placements }),
  });

export function PlanTab({
  where,
  access,
  edition,
}: {
  readonly where: Where;
  readonly access: AdsAccess;
  readonly edition: PubEditionDto | undefined;
}) {
  const ads = useAds();
  const { t, language } = useI18n();
  const { orgId, pubId, editionId } = where;
  const [plan, setPlan] = useState<EditionPlanDto | null>(null);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(false);
  const [planning, setPlanning] = useState<PlanPageDto | null>(null);
  const [choosing, setChoosing] = useState<PlanSlotDto | null>(null);
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    let current = true;
    void ads.plan({ orgId, pubId, editionId }).then((result) => {
      if (!current) return;
      if (result.ok) setPlan(result.value);
      else setProblem(result.error);
    });
    return () => {
      current = false;
    };
  }, [ads, orgId, pubId, editionId]);

  const act = async (run: () => ReturnType<typeof ads.plan>, done = "") => {
    setBusy(true);
    setProblem(null);
    setSaid("");
    const result = await run();
    setBusy(false);
    if (!result.ok) return void setProblem(result.error);
    setPlan(result.value);
    setSaid(done);
    return true;
  };

  if (!plan) return problem ? <ProblemMessage problem={problem} live={false} /> : null;
  const open = !plan.released;
  const late = Date.now() >= Date.parse(plan.cutoff.at);
  const where3 = { orgId, pubId, editionId };
  return (
    <Stack gap="4">
      <p>{t("adsDesk.cutoff.at", { at: formatDateTime(plan.cutoff.at, language) })}</p>
      {plan.released && <p className="pg-ads__note">{t("plan.released")}</p>}
      <Cluster gap="3">
        {access.place && open && plan.unplaced.length > 0 && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void act(() => ads.placeBooked(where3), t("plan.placed"))}
          >
            {t("adsDesk.placeBooked")}
          </Button>
        )}
        {access.planEdit && open && (
          <Button variant="secondary" disabled={busy} onClick={() => setCopying(true)}>
            {t("plan.copy")}
          </Button>
        )}
      </Cluster>
      {problem && <PlanProblem problem={problem} />}
      <div aria-live="polite">{said && <p>{said}</p>}</div>
      {plan.tiles.length === 0 && (
        <InlineMessage variant="info" heading={t("plan.noProfile")} iconLabel={t("message.info")} />
      )}
      <ul className="pg-plan__tiles" aria-label={t("plan.pages")}>
        {plan.tiles.map((tile) => (
          <li key={tile.page}>
            <Tile
              tile={tile}
              late={late}
              t={t}
              onPlan={access.planEdit && open ? () => (setProblem(null), setPlanning(tile)) : null}
              onChoose={access.place && open ? setChoosing : null}
              onTakeOut={
                access.place && open
                  ? (slot) => void act(() => ads.unplace({ ...where3, slot: slot.slot }))
                  : null
              }
              canChoose={(slot) => plan.unplaced.some(({ booking }) => fitsSlot(booking, slot))}
            />
          </li>
        ))}
      </ul>
      {plan.unplaced.length > 0 && <UnplacedList plan={plan} />}

      {planning && (
        <PlanPageDialog
          tile={planning}
          sections={sectionsFor(plan, planning)}
          busy={busy}
          problem={problem}
          onClose={() => setPlanning(null)}
          onSave={async (sectionId, note) => {
            const page = planning.page;
            // closed once saved: on a refusal it stays open with the reason
            if (await act(() => ads.planPage({ ...where3, page, sectionId, note }))) setPlanning(null);
          }}
        />
      )}
      {choosing && (
        <ChooseBookingDialog
          slot={choosing}
          plan={plan}
          onClose={() => setChoosing(null)}
          onChoose={(bookingId) => {
            const slot = choosing.slot;
            setChoosing(null);
            void act(() => ads.place({ ...where3, slot, bookingId }));
          }}
        />
      )}
      {copying && (
        <CopyPlanDialog
          where={where3}
          edition={edition}
          onClose={() => setCopying(false)}
          onCopied={(next, copied) => {
            setPlan(next);
            setProblem(null);
            setSaid(copiedText(copied, t));
          }}
          date={(iso) => formatDate(iso, language)}
        />
      )}
    </Stack>
  );
}

function Tile({
  tile,
  late,
  t,
  onPlan,
  onChoose,
  onTakeOut,
  canChoose,
}: {
  readonly tile: PlanPageDto;
  readonly late: boolean;
  readonly t: Translate;
  readonly onPlan: (() => void) | null;
  readonly onChoose: ((slot: PlanSlotDto) => void) | null;
  readonly onTakeOut: ((slot: PlanSlotDto) => void) | null;
  readonly canChoose: (slot: PlanSlotDto) => boolean;
}) {
  const id = `pg-plan-page-${tile.page}`;
  // shortcut: slot positions on the page are not in the contract; drawn to one scale (the widest slot is the page's
  // width), stacked at the page's foot. Upgrade when the plan carries each slot's x/y.
  const widest = Math.max(...tile.slots.map((slot) => slot.wMm), 1);
  return (
    <article className="pg-plan__tile" aria-labelledby={id}>
      <h3 id={id} className="pg-plan__page">
        {t("plan.page", { page: tile.page })} · {roleText(tile.role, t)}
      </h3>
      <p className="pg-ads__note">{t("plan.template", { role: tile.templateRole })}</p>
      <p>
        {tile.section ? t("plan.section", { section: tile.section.name }) : t("plan.section.none")}
      </p>
      {tile.note && <p className="pg-plan__note">{tile.note}</p>}
      <p className="pg-ads__note">
        {tile.placed
          ? t("plan.laidOut", {
              sections: tile.placed.sections.map((section) => section.name).join(", ") || t("plan.laidOut.noSection"),
              stories: tile.placed.stories,
            })
          : t("plan.laidOut.none")}
      </p>
      {onPlan && (
        <div>
          <Button variant="quiet" size="sm" onClick={onPlan}>
            {t("plan.edit", { page: tile.page })}
          </Button>
        </div>
      )}
      {tile.slots.length > 0 && (
        <ul className="pg-plan__slots" aria-label={t("plan.slots", { page: tile.page })}>
          {tile.slots.map((slot) => {
            // a booking without usable artwork: amber until the cut-off, red after it
            const missing = !!slot.booking && slot.booking.artwork !== "passed";
            const state = missing ? (late ? "late" : "missing") : slot.booking || slot.artwork === "ready" ? "filled" : "";
            return (
              <li
                key={slot.slot}
                className={`pg-plan__slot${state ? ` pg-plan__slot--${state}` : ""}`}
                style={{ inlineSize: `${(slot.wMm / widest) * 100}%`, aspectRatio: `${slot.wMm} / ${slot.hMm}` }}
              >
                <span className="pg-plan__slot-size">{slotText(slot, t)}</span>
                {slot.booking ? (
                  <bdi className="pg-ads__name">{slot.booking.advertiser}</bdi>
                ) : (
                  <span>{t(SLOT_WORDS[slot.artwork])}</span>
                )}
                {missing && (
                  <Badge tone={late ? "danger" : "warning"}>{late ? t("plan.slot.late") : t("plan.slot.missing")}</Badge>
                )}
                {slot.booking && onTakeOut && (
                  <Button
                    variant="quiet"
                    size="sm"
                    onClick={() => onTakeOut(slot)}
                    aria-label={t("plan.takeOut.label", { advertiser: slot.booking.advertiser, slot: slot.slot })}
                  >
                    {t("plan.takeOut")}
                  </Button>
                )}
                {!slot.booking && onChoose && canChoose(slot) && (
                  <Button
                    variant="quiet"
                    size="sm"
                    onClick={() => onChoose(slot)}
                    aria-label={t("plan.choose.label", { slot: slot.slot })}
                  >
                    {t("plan.choose")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}

/** An empty slot's words: its plain picture (L2.3), when it has one. */
const SLOT_WORDS = {
  empty: "plan.slot.empty",
  preparing: "editionLayout.ads.preparing",
  ready: "editionLayout.ads.ready",
  failed: "editionLayout.ads.failed",
} as const satisfies Record<PlanSlotDto["artwork"], PlainKey>;

function PlanPageDialog({
  tile,
  sections,
  busy,
  problem,
  onClose,
  onSave,
}: {
  readonly tile: PlanPageDto;
  readonly sections: readonly Section[];
  readonly busy: boolean;
  readonly problem: ApiProblem | null;
  readonly onClose: () => void;
  readonly onSave: (sectionId: string | null, note: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [sectionId, setSectionId] = useState(tile.section?.id ?? "");
  const [note, setNote] = useState(tile.note);
  return (
    <Dialog open onClose={onClose} title={t("plan.edit", { page: tile.page })} closeLabel={t("shell.closeDialog")}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onSave(sectionId || null, note.trim());
        }}
      >
        <Stack gap="4">
          <Field label={t("plan.form.section")}>
            <Select value={sectionId} onChange={(event) => setSectionId(event.target.value)}>
              <option value="">{t("plan.section.none")}</option>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("plan.form.note")}>
            <TextArea rows={3} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
          {problem && <PlanProblem problem={problem} />}
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

function ChooseBookingDialog({
  slot,
  plan,
  onClose,
  onChoose,
}: {
  readonly slot: PlanSlotDto;
  readonly plan: EditionPlanDto;
  readonly onClose: () => void;
  readonly onChoose: (bookingId: string) => void;
}) {
  const { t } = useI18n();
  const fitting = plan.unplaced.filter(({ booking }) => fitsSlot(booking, slot));
  const [chosen, setChosen] = useState(fitting[0]?.booking.id ?? "");
  return (
    <Dialog open onClose={onClose} title={t("plan.choose.title", { slot: slot.slot })} closeLabel={t("shell.closeDialog")}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (chosen) onChoose(chosen);
        }}
      >
        <Stack gap="4">
          <RadioGroup
            legend={t("plan.choose.legend")}
            name="pg-plan-booking"
            value={chosen}
            onChange={setChosen}
            options={fitting.map(({ booking }) => ({
              value: booking.id,
              label: booking.campaign ? `${booking.advertiser} — ${booking.campaign}` : booking.advertiser,
            }))}
          />
          <Cluster gap="3">
            <Button type="submit" disabled={!chosen}>
              {t("plan.choose.place")}
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

function CopyPlanDialog({
  where,
  edition,
  onClose,
  onCopied,
  date,
}: {
  readonly where: Where;
  readonly edition: PubEditionDto | undefined;
  readonly onClose: () => void;
  readonly onCopied: (plan: EditionPlanDto, copied: { pages: number; placements: number }) => void;
  readonly date: (iso: string) => string;
}) {
  const ads = useAds();
  const { t } = useI18n();
  const editions = usePublicationEditions(where.orgId, where.pubId, true);
  const others = (editions ?? []).filter(
    (candidate) => candidate.id !== where.editionId && (!edition || candidate.pages === edition.pages),
  );
  const [from, setFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const copy = async () => {
    if (!from) return;
    setBusy(true);
    setProblem(null);
    const result = await ads.copyPlan({ ...where, fromEditionId: from });
    setBusy(false);
    if (!result.ok) return setProblem(result.error);
    onCopied(result.value.plan, result.value.copied);
    onClose();
  };
  return (
    <Dialog open onClose={onClose} title={t("plan.copy")} closeLabel={t("shell.closeDialog")}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void copy();
        }}
      >
        <Stack gap="4">
          <p>{t("plan.copy.hint")}</p>
          {others.length === 0 ? (
            <p>{t("plan.copy.none")}</p>
          ) : (
            <Field label={t("plan.copy.from")}>
              <Select value={from} onChange={(event) => setFrom(event.target.value)}>
                <option value="">{t("plan.copy.pick")}</option>
                {others.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {date(candidate.date)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {problem && <PlanProblem problem={problem} />}
          <Cluster gap="3">
            <Button type="submit" disabled={!from || busy} aria-busy={busy}>
              {t("plan.copy.go")}
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
