import type { HTMLAttributes } from "react";

export interface ProgressIndicatorProps extends HTMLAttributes<HTMLDivElement> {
  /** Visible label describing what is in progress. */
  label: string;
  /**
   * Current progress value (0–100).
   * When provided, renders a native <progress> element with known completion.
   * When omitted, renders indeterminate progress with a decorative spinner.
   */
  value?: number;
  /** Maximum value; defaults to 100. Only used when value is defined. */
  max?: number;
}

/**
 * Progress indicator.
 * Known progress: uses native <progress> element.
 * Unknown progress: uses text plus a decorative spinner hidden from assistive technology.
 * Progress text is always visible and descriptive — no animation-only communication.
 * Reduced-motion: spinner rotation is stopped via CSS; text and state remain intact.
 */
export function ProgressIndicator({
  label,
  value,
  max = 100,
  className,
  ...rest
}: ProgressIndicatorProps) {
  const isIndeterminate = value === undefined;

  return (
    <div
      className={["pg-progress", className].filter(Boolean).join(" ")}
      {...rest}
    >
      <span className="pg-progress__label">{label}</span>

      {isIndeterminate ? (
        <div className="pg-progress__indeterminate">
          {/* Spinner is decorative — aria-hidden keeps it from flooding announcements */}
          <span
            className="pg-progress__spinner"
            aria-hidden="true"
          />
          {/* State is conveyed via the visible label text above */}
        </div>
      ) : (
        <progress
          className="pg-progress__bar"
          value={value}
          max={max}
          aria-label={label}
        />
      )}
    </div>
  );
}
