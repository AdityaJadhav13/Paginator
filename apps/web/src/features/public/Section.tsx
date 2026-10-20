/**
 * A band with a sidehead: the standing head in a narrow start column and
 * the section's prose beside it (§9.2).
 *
 * Shared because every public surface uses the same section shape, and
 * because measure-constrained prose under a full-width heading leaves half
 * the grid empty at laptop width — the sidehead is what makes the page read
 * as a composed layout rather than a stack of left-aligned blocks.
 */
import type { ReactNode } from "react";
import { StandingHead } from "./StandingHead.tsx";

export type SectionTone = "plain" | "subtle" | "ink";

export interface SectionProps {
  readonly label: string;
  readonly title: string;
  readonly tone?: SectionTone;
  readonly children: ReactNode;
}

const TONE_CLASS: Record<SectionTone, string> = {
  plain: "",
  subtle: "pg-public__band--subtle",
  ink: "pg-public__band--ink",
};

export function Section({ label, title, tone = "plain", children }: SectionProps) {
  return (
    <section className={["pg-public__band", TONE_CLASS[tone]].filter(Boolean).join(" ")}>
      <div className="pg-public__measure">
        <div className="pg-public__split">
          <StandingHead label={label} title={title} level={2} />
          <div className="pg-public__split-body">{children}</div>
        </div>
      </div>
    </section>
  );
}
