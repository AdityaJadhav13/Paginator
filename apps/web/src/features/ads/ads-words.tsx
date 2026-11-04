/**
 * The ads desk's words, shared by the desk and the edition's Plan and Ads tabs: a size, a position rule, why a booking
 * is not placed, an artwork's state, and the artwork check card worded from the API's numbers (the web never checks a
 * picture itself: `checkArtwork` runs on the API, and its answer is shown).
 */
import { ARTWORK_MIN_PPI } from "@pageinator/contracts";
import { Badge, InlineMessage, Stack } from "../../ui/index.ts";
import { formatDate } from "../../i18n/dates.ts";
import type { Language, PlainKey, Translate } from "../../i18n/index.ts";
import type { ArtworkCheckDto, BookingDto, EditionPlanDto } from "../../services/index.ts";

type UnplacedReason = EditionPlanDto["unplaced"][number]["reason"];

/** "330 × 170 mm" */
export const sizeText = (size: { readonly wMm: number; readonly hMm: number }, t: Translate) =>
  t("adsDesk.size", { width: size.wMm, height: size.hMm });

/** "back-1 · 330 × 170 mm" */
export const slotText = (slot: { readonly slot: string; readonly wMm: number; readonly hMm: number }, t: Translate) =>
  t("adsDesk.slotSize", { slot: slot.slot, width: slot.wMm, height: slot.hMm });

export const positionText = (slot: string | null, t: Translate) =>
  slot ? t("adsDesk.position.slot", { slot }) : t("adsDesk.position.any");

export const colourText = (colour: BookingDto["colour"], t: Translate) =>
  colour === "colour" ? t("adsDesk.colour.colour") : t("adsDesk.colour.mono");

const REASONS: Readonly<Record<UnplacedReason, PlainKey>> = {
  no_ad_pages: "adsDesk.reason.no_ad_pages",
  no_slot: "adsDesk.reason.no_slot",
  slots_taken: "adsDesk.reason.slots_taken",
  no_profile: "adsDesk.reason.no_profile",
  taken_out: "adsDesk.reason.taken_out",
};
export const reasonText = (reason: UnplacedReason, t: Translate) => t(REASONS[reason]);

/** A booking's run dates: one date, or the first and last with how many. */
export function datesText(dates: readonly string[], t: Translate, language: Language): string {
  const first = formatDate(dates[0]!, language);
  if (dates.length === 1) return first;
  return t("adsDesk.dates.many", { first, last: formatDate(dates[dates.length - 1]!, language), count: dates.length });
}

/** The artwork's state as a badge: the words say it, the colour only repeats them. */
export function ArtworkBadge({ artwork, t }: { readonly artwork: "none" | "failed" | "passed"; readonly t: Translate }) {
  if (artwork === "passed")
    return (
      <Badge tone="success" icon="circle-check">
        {t("adsDesk.artwork.passed")}
      </Badge>
    );
  if (artwork === "failed")
    return (
      <Badge tone="danger" icon="circle-x">
        {t("adsDesk.artwork.failed")}
      </Badge>
    );
  return (
    <Badge tone="warning" icon="triangle-alert">
      {t("adsDesk.artwork.none")}
    </Badge>
  );
}

export const artworkState = (booking: BookingDto): "none" | "failed" | "passed" =>
  !booking.artwork ? "none" : booking.artwork.passed ? "passed" : "failed";

/** One check's sentence, from its numbers and the space's size. */
export function checkSentence(
  check: ArtworkCheckDto,
  space: { readonly wMm: number; readonly hMm: number },
  t: Translate,
): string {
  const fit = { print: t("adsDesk.size", { width: check.printWMm, height: check.printHMm }), space: sizeText(space, t) };
  if (check.check === "shape") {
    if (check.state === "passed") return t("adsDesk.check.shape.passed", fit);
    return check.shortWMm >= check.shortHMm
      ? t("adsDesk.check.shape.narrow", { short: check.shortWMm, ...fit })
      : t("adsDesk.check.shape.short", { short: check.shortHMm, ...fit });
  }
  if (check.check === "resolution") {
    return check.state === "passed"
      ? t("adsDesk.check.resolution.passed", { ppi: check.ppi, need: ARTWORK_MIN_PPI })
      : t("adsDesk.check.resolution.failed", {
          ppi: check.ppi,
          need: ARTWORK_MIN_PPI,
          width: check.needWPx,
          height: check.needHPx,
        });
  }
  return t("adsDesk.check.colour");
}

/** The artwork check card: "Ready" with why (it fits, its ppi) and the colour note when every check passed, else
 * "Problem" with each failed check in words. */
export function ArtworkCard({ booking, t }: { readonly booking: BookingDto; readonly t: Translate }) {
  const artwork = booking.artwork;
  if (!artwork) return null;
  const said = artwork.checks.filter((check) => check.state === (artwork.passed ? "passed" : "failed"));
  const notes = artwork.checks.filter((check) => check.state === "note");
  const unusable = artwork.status === "rejected" || artwork.status === "failed";
  return (
    <Stack gap="2">
      <InlineMessage
        variant={artwork.passed ? "success" : "error"}
        heading={artwork.passed ? t("adsDesk.card.ready") : t("adsDesk.card.problem")}
        iconLabel={artwork.passed ? t("message.success") : t("message.error")}
      />
      <ul className="pg-ads__checks">
        {said.map((check) => (
          <li key={check.check}>{checkSentence(check, booking, t)}</li>
        ))}
        {artwork.passed && <li>{t("adsDesk.card.placed")}</li>}
      </ul>
      {unusable && <p>{t("adsDesk.card.unusable")}</p>}
      {artwork.status === "received" && <p className="pg-ads__note">{t("adsDesk.card.preparing")}</p>}
      {notes.map((check) => (
        <p key={check.check} className="pg-ads__note">
          {checkSentence(check, booking, t)}
        </p>
      ))}
    </Stack>
  );
}
