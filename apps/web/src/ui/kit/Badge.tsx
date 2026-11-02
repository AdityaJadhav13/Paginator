import type { ReactNode } from "react";
import { Icon, type IconName } from "../icons/Icon.tsx";

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";

export interface BadgeProps {
  /** The colour family. The text always says the status too: never colour alone (02 §3.1). */
  tone?: BadgeTone;
  icon?: IconName;
  children: ReactNode;
  className?: string;
}

/** A status chip: text, an optional icon, a tone. */
export function Badge({ tone = "neutral", icon, children, className }: BadgeProps) {
  return (
    <span className={["pg-badge-chip", `pg-badge-chip--${tone}`, className].filter(Boolean).join(" ")}>
      {icon && <Icon name={icon} size={16} />}
      <span>{children}</span>
    </span>
  );
}
