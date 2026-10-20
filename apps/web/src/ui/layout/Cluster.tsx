import type { CSSProperties, HTMLAttributes, ElementType } from "react";
import type { SpaceToken } from "./Stack.tsx";

type ClusterJustify = "start" | "end" | "space-between" | "center";

interface ClusterProps extends HTMLAttributes<HTMLElement> {
  /** Tokenized gap. Accepts only keys 0–9. */
  gap?: SpaceToken;
  /** Logical justification of the group's children. */
  justify?: ClusterJustify;
  as?: "div" | "nav" | "ul" | "ol";
}

/**
 * Wrapping group for actions and tags.
 * DOM order is never changed for RTL; physical left/right direction props are prohibited.
 */
export function Cluster({
  gap = "3",
  justify = "start",
  as = "div",
  className,
  style,
  children,
  ...rest
}: ClusterProps) {
  const Tag = as as ElementType;

  // Map logical justify values to CSS justify-content values
  const justifyMap: Record<ClusterJustify, string> = {
    start: "flex-start",
    end: "flex-end",
    "space-between": "space-between",
    center: "center",
  };

  const clusterStyle: CSSProperties = {
    ...style,
    "--pg-cluster-gap": `var(--pg-space-${gap})`,
    "--pg-cluster-justify": justifyMap[justify],
  } as CSSProperties;

  return (
    <Tag
      className={["pg-cluster", className].filter(Boolean).join(" ")}
      style={clusterStyle}
      {...rest}
    >
      {children}
    </Tag>
  );
}
