import type { CSSProperties, HTMLAttributes, ElementType } from "react";

/** Token key for gap spacing (maps to --pg-space-N). */
export type SpaceToken = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";

interface StackProps extends HTMLAttributes<HTMLElement> {
  /** Tokenized gap between children. Accepts only keys 0–9. */
  gap?: SpaceToken;
  /** Semantic element to render. Defaults to "div". */
  as?: "div" | "section" | "ul" | "ol";
}

/**
 * Vertical flow layout with tokenized gap.
 * Uses logical CSS properties; safe for RTL contexts.
 * CSS reordering is prohibited — DOM and reading order are preserved.
 */
export function Stack({
  gap = "3",
  as = "div",
  className,
  style,
  children,
  ...rest
}: StackProps) {
  const Tag = as as ElementType;
  const gapStyle: CSSProperties = {
    ...style,
    "--pg-stack-gap": `var(--pg-space-${gap})`,
  } as CSSProperties;

  return (
    <Tag
      className={["pg-stack", className].filter(Boolean).join(" ")}
      style={gapStyle}
      {...rest}
    >
      {children}
    </Tag>
  );
}
