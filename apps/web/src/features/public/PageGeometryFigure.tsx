/**
 * The homepage hero's diagram (UI005 §14).
 *
 * It is a schematic of a newspaper page's *structure* — margins, a column
 * grid, a reserved advertisement, and a linked text flow — drawn entirely
 * from the geometry constants below. It deliberately contains no headline,
 * byline, dateline, body text, greeking or measurement: it is a diagram, and
 * a drawing that looked like a composed page would pass for Pageinator's
 * output, which it is not. The caption says so on the page, not only here.
 * Its labels follow the page's language.
 */
import { useId } from "react";
import { usePublicText } from "./usePublicText.ts";

/** Static page geometry in viewBox units. No value is a real measurement. */
const VIEW_WIDTH = 320;
const VIEW_HEIGHT = 508;
const PAGE_INSET = 4;
const MARGIN = 20;
const CONTENT_WIDTH = VIEW_WIDTH - MARGIN * 2;
const COLUMN_COUNT = 6;
const GUTTER = 8;
const COLUMN_WIDTH = (CONTENT_WIDTH - GUTTER * (COLUMN_COUNT - 1)) / COLUMN_COUNT;
const COLUMN_TOP = 52;
const COLUMN_BOTTOM = 352;
const AD_TOP = 262;
const LEGEND_ROWS = [452, 474, 496];
const LABEL_SIZE = 13;
const LABEL_SIZE_MR = 16;

const columnX = (index: number) => MARGIN + index * (COLUMN_WIDTH + GUTTER);

export function PageGeometryFigure() {
  const arrowId = useId();
  const { t, language } = usePublicText();
  // Devanagari stays at 13 CSS px or more where the diagram is drawn smallest (a 320 px phone)
  const labelSize = language === "mr" ? LABEL_SIZE_MR : LABEL_SIZE;

  return (
    <figure className="pg-public__figure">
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        role="img"
        aria-label={t("figure-alt")}
      >
        <defs>
          <marker
            id={arrowId}
            markerWidth="8"
            markerHeight="8"
            refX="6"
            refY="3"
            orient="auto"
          >
            <path d="M 0 0 L 6 3 L 0 6 z" className="pg-figure__arrowhead" />
          </marker>
        </defs>

        {/* Page trim and the margin guide inside it. */}
        <rect
          className="pg-figure__page"
          x={PAGE_INSET}
          y={PAGE_INSET}
          width={VIEW_WIDTH - PAGE_INSET * 2}
          height={428 - PAGE_INSET}
        />
        <rect
          className="pg-figure__margin"
          x={MARGIN}
          y={MARGIN}
          width={CONTENT_WIDTH}
          height={408}
        />

        {/* The column grid: empty tint, never filled with simulated text. */}
        {Array.from({ length: COLUMN_COUNT }, (_, index) => (
          <rect
            key={index}
            className="pg-figure__column"
            x={columnX(index)}
            y={COLUMN_TOP}
            width={COLUMN_WIDTH}
            height={COLUMN_BOTTOM - COLUMN_TOP}
          />
        ))}

        {/* Advertising space reserved across the final two columns. */}
        <rect
          className="pg-figure__ad"
          x={columnX(COLUMN_COUNT - 2)}
          y={AD_TOP}
          width={COLUMN_WIDTH * 2 + GUTTER}
          height={COLUMN_BOTTOM - AD_TOP}
        />

        {/* Text continuing from one column region into the next. */}
        <path
          className="pg-figure__flow"
          markerEnd={`url(#${arrowId})`}
          d={`M ${columnX(0) + COLUMN_WIDTH / 2} ${COLUMN_BOTTOM - 16}
              L ${columnX(0) + COLUMN_WIDTH / 2} ${COLUMN_BOTTOM + 14}
              L ${columnX(1) + COLUMN_WIDTH / 2} ${COLUMN_BOTTOM + 14}
              L ${columnX(1) + COLUMN_WIDTH / 2} ${COLUMN_TOP + 16}`}
        />

        {/* Legend. These three phrases are the only glyphs in the diagram. */}
        <rect
          className="pg-figure__column"
          x={MARGIN}
          y={LEGEND_ROWS[0]! - 9}
          width={14}
          height={12}
        />
        <text
          className="pg-figure__label"
          x={MARGIN + 22}
          y={LEGEND_ROWS[0]!}
          fontSize={labelSize}
        >
          {t("figure-label-grid")}
        </text>

        <rect
          className="pg-figure__ad"
          x={MARGIN}
          y={LEGEND_ROWS[1]! - 9}
          width={14}
          height={12}
        />
        <text
          className="pg-figure__label"
          x={MARGIN + 22}
          y={LEGEND_ROWS[1]!}
          fontSize={labelSize}
        >
          {t("figure-label-ad")}
        </text>

        <path
          className="pg-figure__flow"
          markerEnd={`url(#${arrowId})`}
          d={`M ${MARGIN} ${LEGEND_ROWS[2]! - 3} L ${MARGIN + 12} ${LEGEND_ROWS[2]! - 3}`}
        />
        <text
          className="pg-figure__label"
          x={MARGIN + 22}
          y={LEGEND_ROWS[2]!}
          fontSize={labelSize}
        >
          {t("figure-label-flow")}
        </text>
      </svg>
      <figcaption className="pg-public__note">{t("figure-caption")}</figcaption>
    </figure>
  );
}
