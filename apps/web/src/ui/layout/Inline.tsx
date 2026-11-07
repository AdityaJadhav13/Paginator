import type { CSSProperties, HTMLAttributes, ElementType } from "react";
import type { SpaceToken } from "./Stack.tsx";

type InlineAlign = "start" | "center" | "end" | "baseline" | "stretch";
type InlineWrap = "nowrap" | "wrap";

interface InlineProps extends HTMLAttributes<HTMLElement> {
  /** Tokenized gap. Accepts only keys 0–9. */
  gap?: SpaceToken;
  /** Logical alignment of children along the block axis. */
  align?: InlineAlign;
  /** Whether children wrap to new lines. */
  wrap?: InlineWrap;
  as?: "div" | "span" | "header" | "footer" | "nav";
}

/**
 * Inline/flex row with tokenized gap, wrapping, and logical alignment.
 * Left/right-specific spacing props are prohibited; use logical equivalents.
 */
export function Inline({
  gap = "3",
  align = "center",
  wrap = "nowrap",
  as = "div",
  className,
  style,
  children,
  ...rest
}: InlineProps) {
  const Tag = as as ElementType;
  const inlineStyle: CSSProperties = {
    ...style,
    "--pg-inline-gap": `var(--pg-space-${gap})`,
    "--pg-inline-align": align,
    "--pg-inline-wrap": wrap,
  } as CSSProperties;

  return (
    <Tag
      className={["pg-inline", className].filter(Boolean).join(" ")}
      style={inlineStyle}
      {...rest}
    >
      {children}
    </Tag>
  );
}
