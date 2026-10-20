import type { CSSProperties, HTMLAttributes, ElementType } from "react";

interface SurfaceProps extends HTMLAttributes<HTMLElement> {
  /** Whether to apply the raised box-shadow. */
  raised?: boolean;
  /** Whether to use surface-subtle background instead of surface. */
  subtle?: boolean;
  as?: "div" | "section" | "article" | "aside";
}

/**
 * Groups content with semantic background, border, radius, and optional elevation.
 * Not a dialog or implied document canvas.
 */
export function Surface({
  raised = false,
  subtle = false,
  as = "div",
  className,
  style,
  children,
  ...rest
}: SurfaceProps) {
  const Tag = as as ElementType;
  const classes = [
    "pg-surface",
    raised ? "pg-surface--raised" : null,
    subtle ? "pg-surface--subtle" : null,
    className,
  ].filter(Boolean).join(" ");

  return (
    <Tag className={classes} style={style as CSSProperties} {...rest}>
      {children}
    </Tag>
  );
}
