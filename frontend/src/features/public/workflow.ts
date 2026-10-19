/**
 * UI005 workflow model (§13).
 *
 * This module owns **structure only**: the ordering, the stable keys, the
 * canonical route each stage will eventually own, and the availability
 * state. Every rendered sentence — stage name, description, constraint,
 * availability label and owner caption — lives in `content.ts` under the
 * `id`/`text`/`source`/`sourceRef` record structure, so all public prose is
 * governed in one reviewable place (§19.1, AC-13/AC-14).
 *
 * Both `/` (condensed) and `/features` (in full) read the same array, so
 * the two surfaces cannot drift (AC-37).
 *
 * A stage may only be marked `demonstrated` when its route actually renders
 * something other than a placeholder, which `tests/ui005/routes.test.tsx`
 * enforces at runtime.
 */
import { OWNING_UNIT } from "../../app/routes.ts";
import { format, t } from "./content.ts";

/** Which of the three availability states a stage is in (§13.2). */
export type StageAvailability = "demonstrated" | "routed" | "planned";

/** Content-record id holding each state's visible label. */
const AVAILABILITY_CONTENT_ID: Record<StageAvailability, string> = {
  demonstrated: "availability-demonstrated",
  routed: "availability-routed",
  planned: "availability-planned",
};

/** The visible label for a state. Components never invent their own. */
export function availabilityLabel(availability: StageAvailability): string {
  return t(AVAILABILITY_CONTENT_ID[availability]);
}

/** Every permitted availability label, for tests and scans. */
export function availabilityLabels(): readonly string[] {
  return Object.values(AVAILABILITY_CONTENT_ID).map((id) => t(id));
}

type RouteKey = keyof typeof OWNING_UNIT;

/** Structural definition of one workflow stage. Carries no prose. */
export interface WorkflowStage {
  /** 1–7, rendered as the stage's ordinal. */
  readonly number: number;
  /** Stable key; also the `workflow-<key>-*` content-record prefix. */
  readonly key: string;
  readonly availability: StageAvailability;
  /** The canonical route this stage will eventually own. */
  readonly routeKey: RouteKey;
}

/**
 * All seven stages are `routed` today: every workspace surface in this build
 * is a labeled placeholder. Upgrading a label without shipping the surface
 * fails the availability-honesty test — do not do it for visual impact.
 */
export const WORKFLOW_STAGES: readonly WorkflowStage[] = [
  { number: 1, key: "ingest", availability: "routed", routeKey: "pubNewsroom" },
  { number: 2, key: "organize", availability: "routed", routeKey: "pubStories" },
  { number: 3, key: "generate", availability: "routed", routeKey: "editionGenerate" },
  { number: 4, key: "edit", availability: "routed", routeKey: "editionEditor" },
  { number: 5, key: "validate", availability: "routed", routeKey: "editionPreflight" },
  { number: 6, key: "export", availability: "routed", routeKey: "editionExport" },
  { number: 7, key: "archive", availability: "routed", routeKey: "pubArchive" },
];

/**
 * A stage resolved for rendering: structure from `WORKFLOW_STAGES`, every
 * string from `content.ts`. Components consume this and never assemble a
 * sentence themselves.
 */
export interface WorkflowStageView {
  readonly number: number;
  readonly key: string;
  readonly availability: StageAvailability;
  readonly routeKey: RouteKey;
  readonly name: string;
  readonly description: string;
  readonly constraint: string;
  readonly availabilityLabel: string;
  /** "Reserved for UI014." — one complete governed sentence. */
  readonly ownerCaption: string;
}

export function stageView(stage: WorkflowStage): WorkflowStageView {
  return {
    ...stage,
    name: t(`workflow-${stage.key}-name`),
    description: t(`workflow-${stage.key}-description`),
    constraint: t(`workflow-${stage.key}-constraint`),
    availabilityLabel: availabilityLabel(stage.availability),
    ownerCaption: format("features-owner-caption", {
      unit: OWNING_UNIT[stage.routeKey],
    }),
  };
}

/** The seven stages resolved for rendering, in order. */
export function workflowStageViews(): readonly WorkflowStageView[] {
  return WORKFLOW_STAGES.map(stageView);
}

/** Every unit that owns a workflow stage's route, read from the route table. */
export function workflowOwningUnits(): readonly string[] {
  return WORKFLOW_STAGES.map((stage) => OWNING_UNIT[stage.routeKey]);
}
