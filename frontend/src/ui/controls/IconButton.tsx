import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required visible accessible name for the button. */
  label: string;
  /** Icon content — should be a decorative SVG or Unicode symbol with aria-hidden. */
  children: ReactNode;
}

/**
 * Button with an icon and a required accessible name.
 * Visible text is preferred where space permits; use this only when
 * icon-only presentation is genuinely necessary.
 * Tooltip behavior is out of scope for UI001.
 */
export function IconButton({
  label,
  type = "button",
  className,
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={["pg-icon-button", className].filter(Boolean).join(" ")}
      {...rest}
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}
