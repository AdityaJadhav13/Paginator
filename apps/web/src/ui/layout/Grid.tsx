import type { CSSProperties, HTMLAttributes } from "react";
import type { SpaceToken } from "./Stack.tsx";

/** Token keys for minimum item size (maps to --pg-space-N).
 *  Grid uses space tokens for minItemSize to remain bounded.
 *  For larger values, pass a rem/ch string directly via minItemSizeValue.
 */
interface GridProps extends HTMLAttributes<HTMLDivElement> {
  /** Tokenized gap between grid cells. Accepts only keys 0–9. */
  gap?: SpaceToken;
  /**
   * Minimum item size for auto-fill columns.
   * Accepts a CSS size value; defaults to 16rem.
   * Must be a bounded, deterministic value — not a product breakpoint policy.
   */
  minItemSize?: string;
}

/**
 * CSS grid with auto-fill responsive columns bounded by minItemSize.
 * No product breakpoint policy or page-composition geometry is implemented here.
 */
export function Grid({
  gap = "5",
  minItemSize = "16rem",
  className,
  style,
  children,
  ...rest
}: GridProps) {
  const gridStyle: CSSProperties = {
    ...style,
    "--pg-grid-gap": `var(--pg-space-${gap})`,
    "--pg-grid-min-item-size": minItemSize,
  } as CSSProperties;

  return (
    <div
      className={["pg-grid", className].filter(Boolean).join(" ")}
      style={gridStyle}
      {...rest}
    >
      {children}
    </div>
  );
}
