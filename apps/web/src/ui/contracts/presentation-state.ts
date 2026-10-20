/**
 * Pageinator presentation-state contract.
 *
 * This is a UI vocabulary, not a backend enum or production DTO.
 * Later units may map their domain state into PresentationState;
 * they must NOT treat this union as the canonical job, document,
 * export, approval, or release lifecycle.
 *
 * See UI001 §5 and §4 for semantic distinctions and prohibited equivalences.
 */
export type PresentationState =
  | "simulated"
  | "pending"
  | "saved-intention"
  | "recomposing"
  | "confirmed-proof"
  | "stale"
  | "failed"
  | "approved-candidate";

/**
 * Fields accepted by StatusIndicator, before per-state requirements.
 * `revisionLabel`, `relatedRevisionLabel`, `candidateLabel`, and
 * `proofLabel` are opaque display strings — UI001 does not parse them
 * or define production identifier formats.
 */
interface StatusIndicatorFields {
  /** Describes the thing in the state — e.g. "Layout proof". Does not encode authorization. */
  subject: string;
  /** Human-readable detail. Required for "failed"; informative for others. */
  detail?: string;
  /** Opaque display label for the editable revision this status is about. */
  revisionLabel?: string;
  /**
   * Opaque display label for the newer current editable revision.
   * Used only by "stale", where it is required alongside `revisionLabel`
   * (the older revision the stale proof belongs to).
   */
  relatedRevisionLabel?: string;
  /** Opaque display label for the approved candidate identity. Required for "approved-candidate". */
  candidateLabel?: string;
  /**
   * Opaque display label for a confirmed-proof identity, distinct from
   * a revision. Optional context for "confirmed-proof", "stale" (the
   * proof that is stale), and "approved-candidate" (the proof it was
   * derived from).
   */
  proofLabel?: string;
  /**
   * Controls the ARIA live region announcement behavior.
   * "off" — no live region (use for initial render or manual control).
   * "polite" — polite announcement (default for most transitions).
   * "assertive" — assertive announcement (for failed state after user action).
   */
  announcement?: "off" | "polite" | "assertive";
}

/**
 * Props accepted by StatusIndicator.
 * The component owns the canonical visible label and semantic tone for each state.
 * Callers supply presentation data only; they cannot replace canonical labels.
 *
 * This is a discriminated union keyed on `state` so that each state's
 * required identity cannot be omitted and still typecheck:
 * - "stale" requires both `revisionLabel` (the revision the stale proof
 *   belongs to) and `relatedRevisionLabel` (the newer current revision).
 * - "failed" requires `detail` (a human-readable failure description).
 * - "approved-candidate" requires `candidateLabel`.
 */
export type StatusIndicatorProps =
  | (StatusIndicatorFields & { state: "simulated" })
  | (StatusIndicatorFields & { state: "pending" })
  | (StatusIndicatorFields & { state: "saved-intention" })
  | (StatusIndicatorFields & { state: "recomposing" })
  | (StatusIndicatorFields & { state: "confirmed-proof" })
  | (StatusIndicatorFields & {
      state: "stale";
      revisionLabel: string;
      relatedRevisionLabel: string;
    })
  | (StatusIndicatorFields & { state: "failed"; detail: string })
  | (StatusIndicatorFields & { state: "approved-candidate"; candidateLabel: string });
