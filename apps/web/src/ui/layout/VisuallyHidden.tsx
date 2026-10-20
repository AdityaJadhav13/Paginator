import type { HTMLAttributes } from "react";

interface VisuallyHiddenProps extends HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode;
}

/**
 * Hides text visually while keeping it available to assistive technology.
 * Must NOT be used to hide focusable controls or product content.
 * Use for supplementary context that screen reader users need but sighted users see visually.
 */
export function VisuallyHidden({ className, children, ...rest }: VisuallyHiddenProps) {
  return (
    <span
      className={["pg-visually-hidden", className].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
    </span>
  );
}
