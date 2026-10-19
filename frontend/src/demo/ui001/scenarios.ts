/**
 * UI001 deterministic transition scenarios.
 *
 * Fixtures only — no timers, no randomness, no network.
 * Each scenario is a finite step sequence with explicit advance/reset
 * actions. Scenario state is in-memory only; reload persistence is out
 * of scope.
 *
 * Each step renders one or more StatusIndicator instances (`indicators`)
 * rather than a single one, because §4 rule 3 and §10.4 require some
 * steps to show more than one status at once — e.g. a stale proof next
 * to the saved intention that made it stale, or the last confirmed
 * proof staying visible while a later revision is recomposing or has
 * failed.
 *
 * See UI001 §10.4 for the four required scenario definitions.
 */

import type { StatusIndicatorProps } from "../../ui/contracts/presentation-state.ts";
import {
  REV_018,
  REV_019,
  PROOF_018_A,
  CANDIDATE_042,
} from "./fixtures.ts";

// ── Shared step type ────────────────────────────────────────────────

/**
 * Distributive `Omit`: plain `Omit<Union, K>` is not distributive (it
 * uses `keyof`/indexed access on the union as a whole), which merges
 * each field's type across every branch and silently discards the
 * per-state required-field constraints that make `StatusIndicatorProps`
 * a discriminated union in the first place. `T extends any ? ... :
 * never` forces the conditional type to distribute over each member of
 * T individually.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** One StatusIndicator's props, minus `announcement` (decided by the caller). */
export type IndicatorSpec = DistributiveOmit<StatusIndicatorProps, "announcement">;

export interface ScenarioStep {
  /** One or more statuses visible at this step. */
  indicators: IndicatorSpec[];
  /** Display label for the advance button (undefined if terminal). */
  advanceLabel?: string;
}

// ── Scenario 1: Save then resolve ──────────────────────────────────
//
// simulated → pending (demo-rev-018) → saved intention (demo-rev-018)
// → recomposing (demo-rev-018) → confirmed proof (demo-proof-018-a, demo-rev-018)

export const SCENARIO_1_STEPS: ScenarioStep[] = [
  {
    indicators: [
      {
        state: "simulated",
        subject: "Layout proof",
        detail: "Simulated starting state for demonstration",
      },
    ],
    advanceLabel: "Request save",
  },
  {
    indicators: [
      {
        state: "pending",
        subject: "Layout proof",
        detail: `Save requested for revision ${REV_018}`,
        revisionLabel: REV_018,
      },
    ],
    advanceLabel: "Acknowledge save",
  },
  {
    indicators: [
      {
        state: "saved-intention",
        subject: "Layout proof",
        detail: `Intention recorded for revision ${REV_018}. Layout not yet resolved.`,
        revisionLabel: REV_018,
      },
    ],
    advanceLabel: "Begin resolution",
  },
  {
    indicators: [
      {
        state: "recomposing",
        subject: "Layout proof",
        detail: `Resolution in progress for revision ${REV_018}. Prior proof, if any, is not yet current.`,
        revisionLabel: REV_018,
      },
    ],
    advanceLabel: "Complete resolution",
  },
  {
    indicators: [
      {
        state: "confirmed-proof",
        subject: "Layout proof",
        detail: `Proof confirmed and bound to revision ${REV_018}.`,
        proofLabel: PROOF_018_A,
        revisionLabel: REV_018,
      },
    ],
  },
];

// ── Scenario 2: Proof becomes stale ────────────────────────────────
//
// Confirmed proof for demo-rev-018
// → saved intention at demo-rev-019 WHILE demo-proof-018-a remains
//   visible as stale (bound to the now-superseded demo-rev-018).
// Both statuses are shown together at the terminal step so the
// distinction between "current editable intention" and "stale proof"
// stays visible rather than one silently replacing the other.

export const SCENARIO_2_STEPS: ScenarioStep[] = [
  {
    indicators: [
      {
        state: "confirmed-proof",
        subject: "Layout proof",
        detail: `Proof confirmed and bound to revision ${REV_018}.`,
        proofLabel: PROOF_018_A,
        revisionLabel: REV_018,
      },
    ],
    advanceLabel: "Edit to new revision",
  },
  {
    indicators: [
      {
        state: "saved-intention",
        subject: "Layout proof",
        detail: `Intention recorded for revision ${REV_019}. Layout not yet resolved.`,
        revisionLabel: REV_019,
      },
      {
        state: "stale",
        subject: "Layout proof",
        detail: `Proof ${PROOF_018_A} belongs to revision ${REV_018}, which is no longer current.`,
        proofLabel: PROOF_018_A,
        revisionLabel: REV_018,
        relatedRevisionLabel: REV_019,
      },
    ],
  },
];

// ── Scenario 3: Resolution fails safely ────────────────────────────
//
// Recomposing demo-rev-019 → failed for revision 19, at every step
// alongside the last confirmed proof, which stays explicitly bound to
// revision 18 and is never itself marked old/stale by a failed
// recomposition of a different revision.

export const SCENARIO_3_STEPS: ScenarioStep[] = [
  {
    indicators: [
      {
        state: "recomposing",
        subject: "Layout proof",
        detail: `Resolution in progress for revision ${REV_019}.`,
        revisionLabel: REV_019,
      },
      {
        state: "confirmed-proof",
        subject: "Last confirmed layout proof",
        detail: `Last confirmed proof, bound to revision ${REV_018}. Unaffected by the resolution in progress above.`,
        proofLabel: PROOF_018_A,
        revisionLabel: REV_018,
      },
    ],
    advanceLabel: "Trigger failure",
  },
  {
    indicators: [
      {
        state: "failed",
        subject: "Layout proof",
        detail: `Resolution failed for revision ${REV_019}. The prior confirmed proof for ${REV_018} is retained separately and has not been reverted or advanced.`,
        revisionLabel: REV_019,
      },
      {
        state: "confirmed-proof",
        subject: "Last confirmed layout proof",
        detail: `This is the last confirmed proof, bound to revision ${REV_018}. It is unaffected by the failed resolution above.`,
        proofLabel: PROOF_018_A,
        revisionLabel: REV_018,
      },
    ],
  },
];

// ── Scenario 4: Candidate approval is not publication ──────────────
//
// Confirmed proof demo-proof-018-a → approved candidate demo-candidate-042
// Always accompanied by "Not published"

export const SCENARIO_4_STEPS: ScenarioStep[] = [
  {
    indicators: [
      {
        state: "confirmed-proof",
        subject: "Layout proof",
        detail: `Proof confirmed and bound to revision ${REV_018}.`,
        proofLabel: PROOF_018_A,
        revisionLabel: REV_018,
      },
    ],
    advanceLabel: "Approve as candidate",
  },
  {
    indicators: [
      {
        state: "approved-candidate",
        subject: "Edition candidate",
        detail: `Candidate ${CANDIDATE_042} derived from proof ${PROOF_018_A}. This candidate has fictional approval evidence in this demonstration.`,
        candidateLabel: CANDIDATE_042,
        proofLabel: PROOF_018_A,
        // "Not published" is rendered unconditionally by StatusIndicator for approved-candidate
      },
    ],
  },
];

// ── Scenario state and actions ──────────────────────────────────────

export type ScenarioId = "s1" | "s2" | "s3" | "s4";

export interface ScenarioStepState {
  stepIndex: number;
}

export type ScenarioAction =
  | { type: "advance" }
  | { type: "reset" };

// ── Reducer ─────────────────────────────────────────────────────────
//
// One generic reducer serves all four scenarios; each is parameterized
// only by its own step array, so no scenario needs bespoke state shape
// or a special-cased reducer.

export function stepReducer(
  steps: ScenarioStep[],
  state: ScenarioStepState,
  action: ScenarioAction
): ScenarioStepState {
  switch (action.type) {
    case "advance":
      return {
        stepIndex: Math.min(state.stepIndex + 1, steps.length - 1),
      };
    case "reset":
      return { stepIndex: 0 };
  }
}
