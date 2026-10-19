/**
 * The one reserved workspace status-surface seam (UI002 §9.4,
 * BLV2-07). Renders UI001's `StatusIndicator` with `state="simulated"`
 * and the exact detail text the spec requires — this is the only
 * `StatusIndicator` UI002 renders, and it must never imply a real
 * revision, proof, or approval exists.
 */
import { StatusIndicator } from "../ui/index.ts";

export interface StatusSurfaceProps {
  /** The edition, else publication, else organization name (§9.4). */
  subject: string;
}

export function StatusSurface({ subject }: StatusSurfaceProps) {
  return (
    <StatusIndicator
      state="simulated"
      subject={subject}
      detail="Reserved workspace status surface — bound to real edition state in UI015–020."
      announcement="off"
    />
  );
}
