/**
 * The seven-stage workflow (docs/product/03-website-and-accounts.md §4.2): Plan · Content · Generate · Edit · Check ·
 * Print · Archive, each with its state today.
 *
 * This module owns structure only: the order, the keys and the states. Every sentence (name, what it does, what is
 * live today, the state labels) is a record in `content.ts`. `/` (condensed) and `/features` (in full) read the same
 * array, so they cannot drift.
 *
 * The states, and why (each stage's "today" record names its evidence):
 *   - desk: it works today in Pageinator Desk (tools/desk; L1 in docs/product/09-launch-plan.md);
 *   - pilot: it is built in the newsroom app (apps/), which is being prepared for a pilot and is not deployed;
 *   - planned: nothing of it is built.
 * A stage may carry two states when its parts differ (Content: the Desk's typing, pasting and Word import work today;
 * filing from a phone is built for the pilot). Raising a state without the evidence fails the claims test.
 */

export type StageState = "desk" | "pilot" | "planned";

/** Content-record id of each state's visible label. */
const STATE_CONTENT_ID: Record<StageState, string> = {
  desk: "availability-desk",
  pilot: "availability-pilot",
  planned: "availability-planned",
};

export function stateLabelId(state: StageState): string {
  return STATE_CONTENT_ID[state];
}

/** Every state label's record id, for tests and scans. */
export function stateLabelIds(): readonly string[] {
  return Object.values(STATE_CONTENT_ID);
}

export interface WorkflowStage {
  /** 1–7, rendered as the stage's ordinal. */
  readonly number: number;
  /** Stable key; also the `workflow-<key>-*` content-record prefix. */
  readonly key: string;
  /** Its states today, the main one first. */
  readonly states: readonly StageState[];
}

export const WORKFLOW_STAGES: readonly WorkflowStage[] = [
  { number: 1, key: "plan", states: ["desk"] },
  { number: 2, key: "content", states: ["desk", "pilot"] },
  { number: 3, key: "generate", states: ["desk"] },
  { number: 4, key: "edit", states: ["desk"] },
  { number: 5, key: "check", states: ["desk"] },
  { number: 6, key: "print", states: ["desk"] },
  { number: 7, key: "archive", states: ["planned"] },
];

/** A stage's content-record ids. */
export function stageIds(stage: WorkflowStage) {
  return {
    name: `workflow-${stage.key}-name`,
    description: `workflow-${stage.key}-description`,
    today: `workflow-${stage.key}-today`,
    states: stage.states.map(stateLabelId),
  };
}
