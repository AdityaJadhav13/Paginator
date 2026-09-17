import type { HTMLAttributes } from "react";

interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  /** Children to center within the content measure. */
  children?: React.ReactNode;
}

/**
 * Centers ordinary UI content within --pg-content-measure with logical padding.
 * Not an application shell or sidebar — those are UI002 concerns.
 */
export function Container({ className, children, ...rest }: ContainerProps) {
  return (
    <div
      className={["pg-container", className].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
    </div>
  );
}
