/**
 * The layout's words shared by its screens: a run's and a page's state, a page's role, a duration, and the
 * independent check's result, worded exactly "Independent PDF/X-1a check: passed (2 warnings)" or "…: failed
 * (3 problems)" (plan §2.3; never "PDF/X-valid", never "press-ready").
 */
import type { PlainKey, Translate } from "../../i18n/index.ts";
import type { LayoutPageDto, LayoutRunDto } from "../../services/index.ts";
import { Badge, type BadgeTone, type IconName } from "../../ui/index.ts";

const RUN_STATE: Readonly<Record<LayoutRunDto["state"], readonly [PlainKey, BadgeTone, IconName]>> = {
  queued: ["editionLayout.state.queued", "info", "clock"],
  planning: ["editionLayout.state.planning", "info", "loader-circle"],
  layout: ["editionLayout.state.layout", "info", "loader-circle"],
  finishing: ["editionLayout.state.finishing", "info", "loader-circle"],
  done: ["editionLayout.state.done", "success", "circle-check"],
  failed: ["editionLayout.state.failed", "danger", "circle-x"],
  cancelled: ["editionLayout.state.cancelled", "neutral", "x"],
};

const PAGE_STATE: Readonly<Record<LayoutPageDto["state"], PlainKey>> = {
  waiting: "editionLayout.pageState.waiting",
  working: "editionLayout.pageState.working",
  done: "editionLayout.pageState.done",
  failed: "editionLayout.pageState.failed",
  cancelled: "editionLayout.pageState.cancelled",
};

const ROLE: Readonly<Record<LayoutPageDto["role"], PlainKey>> = {
  front: "editionLayout.role.front",
  inside: "editionLayout.role.inside",
  back: "editionLayout.role.back",
};

export const ACTIVE_STATES: readonly LayoutRunDto["state"][] = ["queued", "planning", "layout", "finishing"];

export const runStateText = (state: LayoutRunDto["state"], t: Translate) => t(RUN_STATE[state][0]);
export const pageStateText = (state: LayoutPageDto["state"], t: Translate) => t(PAGE_STATE[state]);
export const roleText = (role: LayoutPageDto["role"], t: Translate) => t(ROLE[role]);

/** A run's state as a badge: the words say it, the colour only repeats them. */
export function RunStateBadge({ state, t }: { readonly state: LayoutRunDto["state"]; readonly t: Translate }) {
  const [key, tone, icon] = RUN_STATE[state];
  return (
    <Badge tone={tone} icon={icon}>
      {t(key)}
    </Badge>
  );
}

/** "2 min 14 s", "40 s". */
export function duration(seconds: number, t: Translate): string {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  return minutes > 0
    ? t("editionLayout.time.minutes", { minutes, seconds: whole % 60 })
    : t("editionLayout.time.seconds", { seconds: whole });
}

/** The independent PDF/X-1a check's result, in the plan's exact words. */
export function checkText(check: LayoutPageDto["check"], t: Translate): string {
  if (!check) return t("editionLayout.check.notRun");
  if (check.passed) {
    const warnings = check.warnings ?? 0;
    if (warnings === 0) return t("editionLayout.check.passed");
    return warnings === 1
      ? t("editionLayout.check.passedWarning")
      : t("editionLayout.check.passedWarnings", { count: warnings });
  }
  if (check.fails === null || check.fails === 0) return t("editionLayout.check.failed");
  return check.fails === 1
    ? t("editionLayout.check.failedProblem")
    : t("editionLayout.check.failedProblems", { count: check.fails });
}

export function CheckBadge({ check, t }: { readonly check: LayoutPageDto["check"]; readonly t: Translate }) {
  const [tone, icon]: readonly [BadgeTone, IconName] = !check
    ? ["neutral", "info"]
    : check.passed
      ? ["success", "circle-check"]
      : ["danger", "circle-x"];
  return (
    <Badge tone={tone} icon={icon}>
      {checkText(check, t)}
    </Badge>
  );
}

/** A run's file name for a page: page-07.pdf, page-07.thumb.png … */
export const pageFile = (page: number, kind: "pdf" | "png" | "thumb.png") =>
  `page-${String(page).padStart(2, "0")}.${kind}`;
