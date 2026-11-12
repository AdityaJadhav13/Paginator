/**
 * A template page's outline as the engine reads it (packages/contracts templates.ts Outline, in mm): the page, its news
 * area, what the paper prints there every day (masthead, folio, rules, panels) and its ad slots. An accessible SVG
 * (role img, a name and a description); never the printed page, and it says so. Reusable by other screens.
 */
import { useId } from "react";
import { useI18n } from "../../i18n/index.ts";
import type { TemplateOutlineDto } from "../../services/layout-service.ts";

const rect = ([x0, y0, x1, y1]: readonly [number, number, number, number]) => ({
  x: x0,
  y: y0,
  width: Math.max(0.5, x1 - x0),
  height: Math.max(0.5, y1 - y0),
});

export function TemplateOutline({
  outline,
  name,
  size = "large",
}: {
  readonly outline: TemplateOutlineDto;
  /** the page model's name (the SVG's accessible name says whose outline it is) */
  readonly name: string;
  readonly size?: "large" | "small";
}) {
  const { t } = useI18n();
  const id = useId();
  return (
    <svg
      className={`pg-template-outline pg-template-outline--${size}`}
      viewBox={`0 0 ${outline.pageWMm} ${outline.pageHMm}`}
      role="img"
      aria-labelledby={`${id}-t`}
      aria-describedby={`${id}-d`}
      preserveAspectRatio="xMidYMid meet"
    >
      <title id={`${id}-t`}>{t("templates.outline.label", { name })}</title>
      <desc id={`${id}-d`}>
        {t("templates.outline.desc", { kept: outline.kept.length, ads: outline.adSlots.length })}
      </desc>
      <rect className="pg-template-outline__page" x={0} y={0} width={outline.pageWMm} height={outline.pageHMm} />
      {outline.news.map((box, i) => (
        <rect key={`n${i}`} className="pg-template-outline__news" {...rect(box)} />
      ))}
      {outline.kept.map((part, i) => (
        <rect
          key={`k${i}`}
          className={`pg-template-outline__kept pg-template-outline__kept--${part.kind === "masthead" ? "masthead" : "other"}`}
          {...rect(part.box)}
        />
      ))}
      {outline.adSlots.map((box, i) => (
        <rect key={`a${i}`} className="pg-template-outline__ad" {...rect(box)} />
      ))}
    </svg>
  );
}

/** What the outline's shapes are (shown once beside the large outlines). */
export function TemplateOutlineLegend() {
  const { t } = useI18n();
  return (
    <ul className="pg-template-legend">
      <li>
        <span aria-hidden="true" className="pg-template-legend__swatch pg-template-outline__news" />
        {t("templates.legend.news")}
      </li>
      <li>
        <span aria-hidden="true" className="pg-template-legend__swatch pg-template-outline__kept" />
        {t("templates.legend.kept")}
      </li>
      <li>
        <span aria-hidden="true" className="pg-template-legend__swatch pg-template-outline__ad" />
        {t("templates.legend.ads")}
      </li>
    </ul>
  );
}
