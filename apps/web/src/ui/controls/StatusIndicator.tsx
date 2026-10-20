import type { CSSProperties } from "react";
import type { StatusIndicatorProps, PresentationState } from "../contracts/presentation-state.ts";

/**
 * Canonical visible labels for each presentation state.
 * The component owns these; callers cannot override them with misleading text.
 *
 * Semantic distinctions enforced (UI001 §4):
 * - "Saved Intention" never says "resolved" or "proof confirmed"
 * - "Simulated" always includes the word "Simulated"
 * - "Approved Candidate" always appends "— Not published"
 * - "Stale" describes what is old and what is current
 * - "Failed" describes what failed; it does not imply success or rollback
 */
const STATE_LABELS: Record<PresentationState, string> = {
  simulated: "Simulated",
  pending: "Pending",
  "saved-intention": "Saved Intention",
  recomposing: "Recomposing",
  "confirmed-proof": "Confirmed Proof",
  stale: "Stale",
  failed: "Failed",
  "approved-candidate": "Approved Candidate",
};

/**
 * Non-colour visual cues (Unicode symbols) for each state.
 * Colour may reinforce the state but is never its only signal.
 */
const STATE_ICONS: Record<PresentationState, string> = {
  simulated: "◈",
  pending: "○",
  "saved-intention": "◇",
  recomposing: "↻",
  "confirmed-proof": "◉",
  stale: "△",
  failed: "✕",
  "approved-candidate": "★",
};

/** Screen-reader labels for each icon. */
const STATE_ICON_LABELS: Record<PresentationState, string> = {
  simulated: "diamond",
  pending: "circle",
  "saved-intention": "open diamond",
  recomposing: "rotating arrow",
  "confirmed-proof": "filled circle",
  stale: "triangle",
  failed: "cross",
  "approved-candidate": "star",
};

/** CSS variable values for status accent colours (matching §6.3 token values). */
const STATE_ACCENT: Record<PresentationState, string> = {
  simulated: "var(--pg-status-simulated)",
  pending: "var(--pg-status-pending)",
  "saved-intention": "var(--pg-status-saved-intention)",
  recomposing: "var(--pg-status-recomposing)",
  "confirmed-proof": "var(--pg-status-confirmed-proof)",
  stale: "var(--pg-status-stale)",
  failed: "var(--pg-status-failed)",
  "approved-candidate": "var(--pg-status-approved-candidate)",
};

/**
 * Default announcement policy per state (when resulting from a user action).
 * Initial page render should pass announcement="off".
 */
const STATE_DEFAULT_ANNOUNCEMENT: Record<
  PresentationState,
  "off" | "polite" | "assertive"
> = {
  simulated: "off",
  pending: "polite",
  "saved-intention": "polite",
  recomposing: "polite",
  "confirmed-proof": "polite",
  stale: "polite",
  failed: "assertive",
  "approved-candidate": "polite",
};

/**
 * Presentation-state status indicator.
 * Renders the canonical label, non-colour cue, and contextual details.
 * Handles ARIA live-region announcement according to UI001 §5.1 policy.
 *
 * Rules enforced:
 * - approved-candidate requires candidateLabel (enforced by the
 *   StatusIndicatorProps union) and always renders "Not published"
 * - stale requires revisionLabel (the revision the stale proof belongs
 *   to) and relatedRevisionLabel (the newer current revision), and
 *   renders both unconditionally
 * - failed requires detail (enforced by the union)
 * - saved-intention never implies resolved output
 * - simulated always exposes "Simulated"
 * - revisionLabel is rendered for every state that carries one, not
 *   only stale/confirmed-proof, so a revision context is never silently
 *   accepted and dropped
 */
export function StatusIndicator({
  state,
  subject,
  detail,
  revisionLabel,
  relatedRevisionLabel,
  candidateLabel,
  proofLabel,
  announcement,
}: StatusIndicatorProps) {
  const effectiveAnnouncement = announcement ?? STATE_DEFAULT_ANNOUNCEMENT[state];
  const label = STATE_LABELS[state];
  const icon = STATE_ICONS[state];
  const iconLabel = STATE_ICON_LABELS[state];
  const accent = STATE_ACCENT[state];

  const liveProps =
    effectiveAnnouncement === "off"
      ? {}
      : {
          "aria-live": (effectiveAnnouncement === "assertive" ? "assertive" : "polite") as "assertive" | "polite",
          "aria-atomic": true,
        };

  const style: CSSProperties = {
    "--pg-status-accent": accent,
  } as CSSProperties;

  return (
    <div
      className={`pg-status pg-status--${state}`}
      style={style}
      data-pg-state={state}
      {...liveProps}
    >
      <span className="pg-status__icon" aria-label={iconLabel}>
        {icon}
      </span>

      <div className="pg-status__body">
        <span className="pg-status__label">{label}</span>
        <span className="pg-status__subject">{subject}</span>

        {/* State-specific supplemental information */}

        {/* stale: proof identity (optional) plus both required revisions */}
        {state === "stale" && (
          <span className="pg-status__revision">
            {proofLabel && (
              <>
                Proof:{" "}
                <bdi>
                  <code>{proofLabel}</code>
                </bdi>
                {" · "}
              </>
            )}
            Proof revision:{" "}
            <bdi>
              <code>{revisionLabel}</code>
            </bdi>
            {" · "}Current revision:{" "}
            <bdi>
              <code>{relatedRevisionLabel}</code>
            </bdi>
          </span>
        )}

        {/* confirmed-proof: proof identity distinct from the bound revision */}
        {state === "confirmed-proof" && (proofLabel || revisionLabel) && (
          <span className="pg-status__revision">
            {proofLabel && (
              <>
                Proof:{" "}
                <bdi>
                  <code>{proofLabel}</code>
                </bdi>
              </>
            )}
            {revisionLabel && (
              <>
                {proofLabel ? " · " : ""}Revision:{" "}
                <bdi>
                  <code>{revisionLabel}</code>
                </bdi>
              </>
            )}
          </span>
        )}

        {/* approved-candidate: always show identity and "Not published" */}
        {state === "approved-candidate" && (
          <>
            <span className="pg-status__revision">
              Candidate:{" "}
              <bdi>
                <code>{candidateLabel}</code>
              </bdi>
              {proofLabel && (
                <>
                  {" · "}Derived from proof:{" "}
                  <bdi>
                    <code>{proofLabel}</code>
                  </bdi>
                </>
              )}
            </span>
            <span className="pg-status__not-published">Not published</span>
          </>
        )}

        {/* Every other revision-bearing state: render the revision it is
            about rather than silently accepting and dropping it. */}
        {state !== "stale" &&
          state !== "confirmed-proof" &&
          state !== "approved-candidate" &&
          revisionLabel && (
          <span className="pg-status__revision">
            Revision:{" "}
            <bdi>
              <code>{revisionLabel}</code>
            </bdi>
          </span>
        )}

        {/* failed: show detail (required by the props union) */}
        {detail && (
          <span className="pg-status__detail">{detail}</span>
        )}
      </div>
    </div>
  );
}
