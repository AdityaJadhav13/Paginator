import type { ReactNode } from "react";

export type InlineMessageVariant = "info" | "success" | "warning" | "error";

export interface InlineMessageProps {
  variant: InlineMessageVariant;
  heading: string;
  children?: ReactNode;
  /**
   * When true, renders with role="alert" for assertive announcement.
   * Use only when the message was caused by a user-submitted action.
   * Messages present on initial render must not set this to true.
   */
  live?: boolean;
  className?: string;
}

/** Non-colour icons (Unicode symbols) for each variant — one signal per variant. */
const VARIANT_ICONS: Record<InlineMessageVariant, string> = {
  info: "ℹ",
  success: "✓",
  warning: "⚠",
  error: "✕",
};

/** Screen-reader labels for each icon. */
const VARIANT_LABELS: Record<InlineMessageVariant, string> = {
  info: "Information",
  success: "Success",
  warning: "Warning",
  error: "Error",
};

/**
 * Inline contextual message with text and semantic role.
 * Meaning is conveyed through text, icon, and structural role — not colour alone.
 * For user-triggered error results, pass live={true} to use role="alert".
 * For static guidance present on page load, leave live={false} (default).
 */
export function InlineMessage({
  variant,
  heading,
  children,
  live = false,
  className,
}: InlineMessageProps) {
  return (
    <div
      role={live ? "alert" : undefined}
      aria-live={!live ? undefined : undefined}
      className={[
        "pg-inline-message",
        `pg-inline-message--${variant}`,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="pg-inline-message__icon" aria-label={VARIANT_LABELS[variant]}>
        {VARIANT_ICONS[variant]}
      </span>
      <div className="pg-inline-message__body">
        <p className="pg-inline-message__heading">{heading}</p>
        {children && <p className="pg-inline-message__text">{children}</p>}
      </div>
    </div>
  );
}
