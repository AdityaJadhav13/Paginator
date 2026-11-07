import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * When true the button is discoverable (aria-disabled) but not activatable.
   * Must reference a visible denial explanation via aria-describedby.
   * This is NEVER authorization enforcement — demo denied states must include
   * the production disclaimer from the capability fixture.
   */
  denied?: boolean;
  children: React.ReactNode;
}

/**
 * Native button with semantic variants and sizes.
 * Defaults to type="button" to prevent accidental form submission.
 * Enter and Space activation are provided by native browser behavior;
 * no custom key handler duplicates activation.
 */
export function Button({
  variant = "primary",
  size = "md",
  type = "button",
  denied = false,
  disabled,
  className,
  onClick,
  onKeyDown,
  children,
  ...rest
}: ButtonProps) {
  const isDenied = denied && !disabled;

  // Blocked denied-action: prevent both pointer and keyboard activation
  const handleClick = isDenied
    ? (e: React.MouseEvent<HTMLButtonElement>) => e.preventDefault()
    : onClick;

  const handleKeyDown = isDenied
    ? (e: React.KeyboardEvent<HTMLButtonElement>) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
        }
        onKeyDown?.(e);
      }
    : onKeyDown;

  return (
    <button
      type={type}
      disabled={disabled}
      aria-disabled={isDenied ? "true" : undefined}
      className={[
        "pg-button",
        `pg-button--${variant}`,
        `pg-button--${size}`,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      {...rest}
    >
      {children}
    </button>
  );
}
