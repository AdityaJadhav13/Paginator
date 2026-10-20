/**
 * UI001 demonstration showcase.
 *
 * Disposable demonstration component — not an application shell, has no routes.
 * Exercises all UI001 contracts using fictional fixtures only.
 * Must NOT be imported from src/ui/** (durable foundation code).
 *
 * See UI001 §10 for fixture definitions and §10.4 for scenario sequences.
 */

import { useReducer, useState, useId } from "react";

// Durable UI foundation imports
import { Stack } from "../../ui/layout/Stack.tsx";
import { Inline } from "../../ui/layout/Inline.tsx";
import { Cluster } from "../../ui/layout/Cluster.tsx";
import { Grid } from "../../ui/layout/Grid.tsx";
import { Container } from "../../ui/layout/Container.tsx";
import { Surface } from "../../ui/layout/Surface.tsx";
import { VisuallyHidden } from "../../ui/layout/VisuallyHidden.tsx";
import { Button } from "../../ui/controls/Button.tsx";
import { IconButton } from "../../ui/controls/IconButton.tsx";
import { Field } from "../../ui/controls/Field.tsx";
import { TextInput } from "../../ui/controls/TextInput.tsx";
import { TextArea } from "../../ui/controls/TextArea.tsx";
import { Select } from "../../ui/controls/Select.tsx";
import { Checkbox } from "../../ui/controls/Checkbox.tsx";
import { RadioGroup } from "../../ui/controls/RadioGroup.tsx";
import { Dialog } from "../../ui/controls/Dialog.tsx";
import { InlineMessage } from "../../ui/controls/InlineMessage.tsx";
import { StatusIndicator } from "../../ui/controls/StatusIndicator.tsx";
import { ProgressIndicator } from "../../ui/controls/ProgressIndicator.tsx";

// Demo-only imports
import {
  ORG_SAHYADRI,
  PUB_PUNE_DAILY,
  PUB_URDU_EVENING,
  CAP_EDITION_VIEW,
  CAP_EDITION_EDIT,
  CAP_CANDIDATE_APPROVE_DENIED,
  CAP_PUBLICATION_SETTINGS_DENIED,
} from "./fixtures.ts";
import {
  SCENARIO_1_STEPS,
  SCENARIO_2_STEPS,
  SCENARIO_3_STEPS,
  SCENARIO_4_STEPS,
  stepReducer,
  type ScenarioStepState,
  type ScenarioAction,
  type IndicatorSpec,
} from "./scenarios.ts";

import "./ui001-showcase.css";

// ── Helpers ─────────────────────────────────────────────────────────

function ShowcaseSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className="pg-showcase__section">
      <h2 id={`${id}-heading`} className="pg-showcase__section-heading">
        {title}
      </h2>
      {children}
    </section>
  );
}

function ScenarioCard({
  title,
  children,
  onAdvance,
  onReset,
  advanceLabel,
}: {
  title: string;
  children: React.ReactNode;
  onAdvance?: () => void;
  onReset: () => void;
  advanceLabel?: string;
}) {
  return (
    <Surface className="pg-showcase__scenario-card">
      <Stack gap="4">
        <h3 className="pg-showcase__scenario-title">{title}</h3>
        {children}
        <Cluster gap="3">
          {onAdvance && advanceLabel && (
            <Button variant="primary" size="sm" onClick={onAdvance}>
              {advanceLabel}
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={onReset}>
            Reset scenario
          </Button>
        </Cluster>
      </Stack>
    </Surface>
  );
}

/**
 * Renders one scenario indicator with explicit, per-state named props.
 *
 * `StatusIndicatorProps` is a discriminated union so each state's
 * required identity is enforced at compile time (see H-01/H-02).
 * Spreading a value already typed as that union (`{...indicator}`)
 * does not typecheck, because TypeScript cannot re-verify a spread
 * object against a discriminated union it was already assigned to —
 * only a fresh object/JSX-attribute literal is checked per-branch.
 * Switching on `indicator.state` narrows `indicator` to the matching
 * union member, so each branch below is a genuine, unnarrowed literal
 * assignment and needs no type assertion.
 */
function renderScenarioIndicator(
  indicator: IndicatorSpec,
  announcement: "off" | "polite" | "assertive",
  key: number
) {
  switch (indicator.state) {
    case "stale":
      return (
        <StatusIndicator
          key={key}
          state="stale"
          subject={indicator.subject}
          detail={indicator.detail}
          proofLabel={indicator.proofLabel}
          revisionLabel={indicator.revisionLabel}
          relatedRevisionLabel={indicator.relatedRevisionLabel}
          announcement={announcement}
        />
      );
    case "failed":
      return (
        <StatusIndicator
          key={key}
          state="failed"
          subject={indicator.subject}
          detail={indicator.detail}
          revisionLabel={indicator.revisionLabel}
          announcement={announcement}
        />
      );
    case "approved-candidate":
      return (
        <StatusIndicator
          key={key}
          state="approved-candidate"
          subject={indicator.subject}
          detail={indicator.detail}
          candidateLabel={indicator.candidateLabel}
          proofLabel={indicator.proofLabel}
          announcement={announcement}
        />
      );
    default:
      return (
        <StatusIndicator
          key={key}
          state={indicator.state}
          subject={indicator.subject}
          detail={indicator.detail}
          revisionLabel={indicator.revisionLabel}
          proofLabel={indicator.proofLabel}
          announcement={announcement}
        />
      );
  }
}

// ── Main showcase ───────────────────────────────────────────────────

export function Ui001Showcase() {
  const [dir, setDir] = useState<"ltr" | "rtl">("ltr");

  // Scenario states — one generic reducer for all four scenarios,
  // parameterized only by each scenario's own step array.
  const [s1State, dispatchS1] = useReducer(
    (s: ScenarioStepState, a: ScenarioAction) => stepReducer(SCENARIO_1_STEPS, s, a),
    { stepIndex: 0 }
  );
  const [s2State, dispatchS2] = useReducer(
    (s: ScenarioStepState, a: ScenarioAction) => stepReducer(SCENARIO_2_STEPS, s, a),
    { stepIndex: 0 }
  );
  const [s3State, dispatchS3] = useReducer(
    (s: ScenarioStepState, a: ScenarioAction) => stepReducer(SCENARIO_3_STEPS, s, a),
    { stepIndex: 0 }
  );
  const [s4State, dispatchS4] = useReducer(
    (s: ScenarioStepState, a: ScenarioAction) => stepReducer(SCENARIO_4_STEPS, s, a),
    { stepIndex: 0 }
  );

  // Dialog demo state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [nonDismissDialogOpen, setNonDismissDialogOpen] = useState(false);

  // Form demo state
  const [checkboxChecked, setCheckboxChecked] = useState(false);
  const [radioValue, setRadioValue] = useState("option-a");
  const [textValue, setTextValue] = useState("");
  const [showFieldErrors, setShowFieldErrors] = useState(false);

  // Select demo state
  const [selectValue, setSelectValue] = useState("option-1");

  const s1Step = SCENARIO_1_STEPS[s1State.stepIndex];
  const s2Step = SCENARIO_2_STEPS[s2State.stepIndex];
  const s3Step = SCENARIO_3_STEPS[s3State.stepIndex];
  const s4Step = SCENARIO_4_STEPS[s4State.stepIndex];

  const fieldErrorId = useId();

  return (
    <div
      id="pg-showcase-root"
      dir={dir}
      lang={dir === "rtl" ? "ur-IN" : "en-IN"}
      className="pg-showcase"
    >
      {/* Simulated banner — must be visible throughout the demonstration */}
      <div
        className="pg-showcase__demo-banner"
        role="note"
        aria-label="Demonstration environment notice"
      >
        <strong>Simulated</strong> — UI001 demonstration only. No real data, authorization,
        authentication, persistence, or production behavior is present.
      </div>

      <Container>
        <Stack gap="8">
          {/* Page heading */}
          <header className="pg-showcase__header">
            <h1 className="pg-type-display">Pageinator UI Foundation</h1>
            <p className="pg-type-body-small">
              UI001 showcase · Design tokens, accessible controls, and status vocabulary.
            </p>
          </header>

          {/* ── Direction toggle ──────────────────────────────── */}
          <ShowcaseSection id="direction" title="Direction">
            <Stack gap="3">
              <p className="pg-type-body-small">
                Toggle text direction. Components inherit direction; none hard-code dir=&quot;ltr&quot;.
                Does not persist.
              </p>
              <Cluster gap="3">
                <Button
                  variant={dir === "ltr" ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => setDir("ltr")}
                  aria-pressed={dir === "ltr"}
                >
                  LTR (en-IN)
                </Button>
                <Button
                  variant={dir === "rtl" ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => setDir("rtl")}
                  aria-pressed={dir === "rtl"}
                >
                  RTL (ur-IN)
                </Button>
              </Cluster>
              <p className="pg-type-caption pg-type--muted">
                Current direction: <strong>{dir.toUpperCase()}</strong>
              </p>
            </Stack>
          </ShowcaseSection>

          {/* ── Context fixtures ──────────────────────────────── */}
          <ShowcaseSection id="context" title="Context Fixtures">
            <Stack gap="4">
              <p className="pg-type-body-small">
                Fictional organization and publication context.
                These identifiers are display examples only — they define no tenant keys,
                API paths, database identifiers, or authorization boundaries.
              </p>
              <Grid minItemSize="18rem" gap="5">
                {/* Organization */}
                <Surface className="pg-showcase__context-card">
                  <Stack gap="3">
                    <span className="pg-type-label pg-showcase__context-type">Organization</span>
                    <h3 className="pg-type-section-title">{ORG_SAHYADRI.name}</h3>
                    <p className="pg-type-code pg-showcase__context-id">
                      <bdi>{ORG_SAHYADRI.id}</bdi>
                    </p>
                    <p className="pg-type-caption pg-showcase__context-qualification">
                      {ORG_SAHYADRI.qualification}
                    </p>
                  </Stack>
                </Surface>

                {/* Publication A — LTR */}
                <Surface className="pg-showcase__context-card">
                  <Stack gap="3">
                    <span className="pg-type-label pg-showcase__context-type">Publication · LTR</span>
                    <h3 className="pg-type-section-title">{PUB_PUNE_DAILY.name}</h3>
                    <p className="pg-type-code pg-showcase__context-id">
                      <bdi>{PUB_PUNE_DAILY.id}</bdi>
                    </p>
                    <p className="pg-type-caption">
                      Locale: {PUB_PUNE_DAILY.locale} · Direction: {PUB_PUNE_DAILY.direction.toUpperCase()}
                    </p>
                    <p className="pg-type-caption pg-showcase__context-qualification">
                      {PUB_PUNE_DAILY.qualification}
                    </p>
                  </Stack>
                </Surface>

                {/* Publication B — RTL */}
                <Surface className="pg-showcase__context-card">
                  <Stack gap="3">
                    <span className="pg-type-label pg-showcase__context-type">Publication · RTL</span>
                    <h3 className="pg-type-section-title">{PUB_URDU_EVENING.name}</h3>
                    <p className="pg-type-code pg-showcase__context-id">
                      <bdi>{PUB_URDU_EVENING.id}</bdi>
                    </p>
                    <p className="pg-type-caption">
                      Locale: {PUB_URDU_EVENING.locale} · Direction: {PUB_URDU_EVENING.direction.toUpperCase()}
                    </p>
                    <p className="pg-type-caption pg-showcase__context-qualification">
                      {PUB_URDU_EVENING.qualification}
                    </p>
                  </Stack>
                </Surface>
              </Grid>
            </Stack>
          </ShowcaseSection>

          {/* ── Capability fixtures ───────────────────────────── */}
          <ShowcaseSection id="capabilities" title="Capability Fixtures">
            <Stack gap="4">
              <p className="pg-type-body-small">
                Presentation-only capability and denial examples.
                No fixture hides data as proof of isolation, and no component claims
                the denial came from a real policy engine.
              </p>
              <Grid minItemSize="18rem" gap="5">
                {/* Allowed: view */}
                <Surface className="pg-showcase__capability-card pg-showcase__capability-card--allowed">
                  <Stack gap="3">
                    <Inline gap="2">
                      <span className="pg-showcase__capability-icon" aria-hidden="true">✓</span>
                      <span className="pg-type-label">Allowed</span>
                    </Inline>
                    <p className="pg-type-code pg-showcase__context-id">
                      <bdi>{CAP_EDITION_VIEW.capability}</bdi>
                    </p>
                    <p className="pg-type-body-small">{CAP_EDITION_VIEW.description}</p>
                    <p className="pg-type-caption pg-showcase__capability-disclaimer">
                      {CAP_EDITION_VIEW.disclaimer}
                    </p>
                  </Stack>
                </Surface>

                {/* Allowed: edit */}
                <Surface className="pg-showcase__capability-card pg-showcase__capability-card--allowed">
                  <Stack gap="3">
                    <Inline gap="2">
                      <span className="pg-showcase__capability-icon" aria-hidden="true">✓</span>
                      <span className="pg-type-label">Allowed</span>
                    </Inline>
                    <p className="pg-type-code pg-showcase__context-id">
                      <bdi>{CAP_EDITION_EDIT.capability}</bdi>
                    </p>
                    <p className="pg-type-body-small">{CAP_EDITION_EDIT.description}</p>
                    <p className="pg-type-caption pg-showcase__capability-disclaimer">
                      {CAP_EDITION_EDIT.disclaimer}
                    </p>
                  </Stack>
                </Surface>

                {/* Denied: approve */}
                <Surface className="pg-showcase__capability-card pg-showcase__capability-card--denied">
                  <Stack gap="3">
                    <Inline gap="2">
                      <span className="pg-showcase__capability-icon" aria-hidden="true">✕</span>
                      <span className="pg-type-label">Denied</span>
                    </Inline>
                    <p className="pg-type-code pg-showcase__context-id">
                      <bdi>{CAP_CANDIDATE_APPROVE_DENIED.capability}</bdi>
                    </p>
                    <p className="pg-type-body-small">{CAP_CANDIDATE_APPROVE_DENIED.denialReason}</p>
                    <div id={`${fieldErrorId}-deny-approve`} className="pg-type-caption pg-showcase__capability-disclaimer">
                      {CAP_CANDIDATE_APPROVE_DENIED.disclaimer}
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      denied
                      aria-describedby={`${fieldErrorId}-deny-approve`}
                    >
                      Approve candidate (denied)
                    </Button>
                  </Stack>
                </Surface>

                {/* Denied: settings */}
                <Surface className="pg-showcase__capability-card pg-showcase__capability-card--denied">
                  <Stack gap="3">
                    <Inline gap="2">
                      <span className="pg-showcase__capability-icon" aria-hidden="true">✕</span>
                      <span className="pg-type-label">Denied</span>
                    </Inline>
                    <p className="pg-type-code pg-showcase__context-id">
                      <bdi>{CAP_PUBLICATION_SETTINGS_DENIED.capability}</bdi>
                    </p>
                    <p className="pg-type-body-small">{CAP_PUBLICATION_SETTINGS_DENIED.denialReason}</p>
                    <div id={`${fieldErrorId}-deny-settings`} className="pg-type-caption pg-showcase__capability-disclaimer">
                      {CAP_PUBLICATION_SETTINGS_DENIED.disclaimer}
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      denied
                      aria-describedby={`${fieldErrorId}-deny-settings`}
                    >
                      Publication settings (denied)
                    </Button>
                  </Stack>
                </Surface>
              </Grid>
            </Stack>
          </ShowcaseSection>

          {/* ── Status scenarios ──────────────────────────────── */}
          <ShowcaseSection id="scenarios" title="Status Transition Scenarios">
            <Stack gap="5">
              <p className="pg-type-body-small">
                Deterministic status transitions — no timers or randomness.
                Each scenario advances and resets in-memory only.
              </p>

              {/* Scenario 1: Save then resolve */}
              <ScenarioCard
                title="Scenario 1 — Save then resolve"
                onAdvance={
                  s1State.stepIndex < SCENARIO_1_STEPS.length - 1
                    ? () => dispatchS1({ type: "advance" })
                    : undefined
                }
                advanceLabel={s1Step.advanceLabel}
                onReset={() => dispatchS1({ type: "reset" })}
              >
                <Stack gap="4">
                  {s1Step.indicators.map((indicator, i) =>
                    renderScenarioIndicator(
                      indicator,
                      s1State.stepIndex === 0 ? "off" : "polite",
                      i
                    )
                  )}
                </Stack>
              </ScenarioCard>

              {/* Scenario 2: Proof becomes stale — the terminal step shows
                  the current saved intention and the now-stale proof together,
                  since neither replaces the other. */}
              <ScenarioCard
                title="Scenario 2 — Proof becomes stale"
                onAdvance={
                  s2State.stepIndex < SCENARIO_2_STEPS.length - 1
                    ? () => dispatchS2({ type: "advance" })
                    : undefined
                }
                advanceLabel={s2Step.advanceLabel}
                onReset={() => dispatchS2({ type: "reset" })}
              >
                <Stack gap="4">
                  {s2Step.indicators.map((indicator, i) =>
                    renderScenarioIndicator(
                      indicator,
                      s2State.stepIndex === 0 ? "off" : "polite",
                      i
                    )
                  )}
                </Stack>
              </ScenarioCard>

              {/* Scenario 3: Resolution fails safely — the last confirmed
                  proof stays visible, bound to revision 18, at every step
                  including while revision 19 is still recomposing. */}
              <ScenarioCard
                title="Scenario 3 — Resolution fails safely"
                onAdvance={
                  s3State.stepIndex < SCENARIO_3_STEPS.length - 1
                    ? () => dispatchS3({ type: "advance" })
                    : undefined
                }
                advanceLabel={s3Step.advanceLabel}
                onReset={() => dispatchS3({ type: "reset" })}
              >
                <Stack gap="4">
                  {s3Step.indicators.map((indicator, i) =>
                    renderScenarioIndicator(
                      indicator,
                      s3State.stepIndex === 0
                        ? "off"
                        : indicator.state === "failed"
                          ? "assertive"
                          : "polite",
                      i
                    )
                  )}
                </Stack>
              </ScenarioCard>

              {/* Scenario 4: Candidate approval is not publication */}
              <ScenarioCard
                title="Scenario 4 — Candidate approval is not publication"
                onAdvance={
                  s4State.stepIndex < SCENARIO_4_STEPS.length - 1
                    ? () => dispatchS4({ type: "advance" })
                    : undefined
                }
                advanceLabel={s4Step.advanceLabel}
                onReset={() => dispatchS4({ type: "reset" })}
              >
                <Stack gap="4">
                  {s4Step.indicators.map((indicator, i) =>
                    renderScenarioIndicator(
                      indicator,
                      s4State.stepIndex === 0 ? "off" : "polite",
                      i
                    )
                  )}
                </Stack>
              </ScenarioCard>

              {/* All eight states */}
              <Surface subtle>
                <Stack gap="4">
                  <h3 className="pg-showcase__section-heading">All eight presentation states</h3>
                  <Grid minItemSize="16rem" gap="4">
                    <StatusIndicator
                      state="simulated"
                      subject="Layout proof"
                      detail="Simulated demonstration state"
                      announcement="off"
                    />
                    <StatusIndicator
                      state="pending"
                      subject="Layout proof"
                      detail="Save requested, awaiting acknowledgment"
                      revisionLabel="demo-rev-018"
                      announcement="off"
                    />
                    <StatusIndicator
                      state="saved-intention"
                      subject="Layout proof"
                      detail="Intention recorded. Layout not yet resolved."
                      revisionLabel="demo-rev-018"
                      announcement="off"
                    />
                    <StatusIndicator
                      state="recomposing"
                      subject="Layout proof"
                      detail="Resolution in progress"
                      revisionLabel="demo-rev-018"
                      announcement="off"
                    />
                    <StatusIndicator
                      state="confirmed-proof"
                      subject="Layout proof"
                      detail="Proof bound to revision"
                      proofLabel="demo-proof-018-a"
                      revisionLabel="demo-rev-018"
                      announcement="off"
                    />
                    <StatusIndicator
                      state="stale"
                      subject="Layout proof"
                      detail="This proof is from an older revision"
                      proofLabel="demo-proof-018-a"
                      revisionLabel="demo-rev-018"
                      relatedRevisionLabel="demo-rev-019"
                      announcement="off"
                    />
                    <StatusIndicator
                      state="failed"
                      subject="Layout proof"
                      detail="Resolution failed for demo-rev-019. Confirmed proof for demo-rev-018 is separately retained."
                      revisionLabel="demo-rev-019"
                      announcement="off"
                    />
                    <StatusIndicator
                      state="approved-candidate"
                      subject="Edition candidate"
                      detail="Fictional approval evidence for this demonstration candidate"
                      candidateLabel="demo-candidate-042"
                      proofLabel="demo-proof-018-a"
                      announcement="off"
                    />
                  </Grid>
                </Stack>
              </Surface>
            </Stack>
          </ShowcaseSection>

          {/* ── Typography ────────────────────────────────────── */}
          <ShowcaseSection id="typography" title="Typography Roles">
            <Stack gap="3">
              <div className="pg-type-display">Display — 2rem bold</div>
              <div className="pg-type-page-title">Page Title — 1.5rem bold</div>
              <div className="pg-type-section-title">Section Title — 1.25rem semibold</div>
              <div className="pg-type-body">Body — 1rem regular. Default prose and control values.</div>
              <div className="pg-type-body-small">Body Small — 0.875rem regular. Secondary text.</div>
              <div className="pg-type-label">Label — 0.875rem medium. Form labels.</div>
              <div className="pg-type-caption">Caption — 0.75rem regular. Supplementary metadata.</div>
              <code className="pg-type-code">Code — 0.875rem mono. Opaque identifiers: demo-rev-018</code>
              <p className="pg-type-caption">
                All text uses operating-system fonts. No external font downloads.
              </p>
            </Stack>
          </ShowcaseSection>

          {/* ── Layout primitives ─────────────────────────────── */}
          <ShowcaseSection id="layout" title="Layout Primitives">
            <Stack gap="5">
              {/* Stack */}
              <Surface subtle>
                <Stack gap="3">
                  <h3 className="pg-type-section-title">Stack (vertical flow)</h3>
                  <Stack gap="4" className="pg-showcase__layout-demo">
                    <div className="pg-showcase__layout-item">Item A</div>
                    <div className="pg-showcase__layout-item">Item B</div>
                    <div className="pg-showcase__layout-item">Item C</div>
                  </Stack>
                </Stack>
              </Surface>

              {/* Inline */}
              <Surface subtle>
                <Stack gap="3">
                  <h3 className="pg-type-section-title">Inline (row flow)</h3>
                  <Inline gap="4" className="pg-showcase__layout-demo">
                    <div className="pg-showcase__layout-item">Alpha</div>
                    <div className="pg-showcase__layout-item">Beta</div>
                    <div className="pg-showcase__layout-item">Gamma</div>
                  </Inline>
                </Stack>
              </Surface>

              {/* Cluster */}
              <Surface subtle>
                <Stack gap="3">
                  <h3 className="pg-type-section-title">Cluster (wrapping group)</h3>
                  <Cluster gap="3" className="pg-showcase__layout-demo">
                    <Button variant="primary" size="sm">Primary</Button>
                    <Button variant="secondary" size="sm">Secondary</Button>
                    <Button variant="quiet" size="sm">Quiet</Button>
                    <Button variant="danger" size="sm">Danger</Button>
                  </Cluster>
                </Stack>
              </Surface>

              {/* Grid */}
              <Surface subtle>
                <Stack gap="3">
                  <h3 className="pg-type-section-title">Grid (responsive auto-fill)</h3>
                  <Grid minItemSize="8rem" gap="4" className="pg-showcase__layout-demo">
                    {["One", "Two", "Three", "Four", "Five"].map((n) => (
                      <div key={n} className="pg-showcase__layout-item">{n}</div>
                    ))}
                  </Grid>
                </Stack>
              </Surface>

              {/* VisuallyHidden */}
              <Surface subtle>
                <Stack gap="3">
                  <h3 className="pg-type-section-title">VisuallyHidden</h3>
                  <p className="pg-type-body-small">
                    The following paragraph has hidden supplementary text for screen readers:
                  </p>
                  <p className="pg-type-body">
                    Edition count: 42
                    <VisuallyHidden> (total across all publications)</VisuallyHidden>
                  </p>
                </Stack>
              </Surface>
            </Stack>
          </ShowcaseSection>

          {/* ── Buttons ───────────────────────────────────────── */}
          <ShowcaseSection id="buttons" title="Buttons and Icon Buttons">
            <Stack gap="5">
              {/* Variants */}
              <Surface subtle>
                <Stack gap="4">
                  <h3 className="pg-type-section-title">Variants</h3>
                  <Cluster gap="3">
                    <Button variant="primary">Primary</Button>
                    <Button variant="secondary">Secondary</Button>
                    <Button variant="quiet">Quiet</Button>
                    <Button variant="danger">Danger</Button>
                  </Cluster>
                </Stack>
              </Surface>

              {/* Sizes */}
              <Surface subtle>
                <Stack gap="4">
                  <h3 className="pg-type-section-title">Sizes</h3>
                  <Cluster gap="3">
                    <Button variant="primary" size="sm">Small</Button>
                    <Button variant="primary" size="md">Medium</Button>
                    <Button variant="primary" size="lg">Large</Button>
                  </Cluster>
                </Stack>
              </Surface>

              {/* Disabled */}
              <Surface subtle>
                <Stack gap="4">
                  <h3 className="pg-type-section-title">Disabled (native)</h3>
                  <Cluster gap="3">
                    <Button variant="primary" disabled>Disabled primary</Button>
                    <Button variant="secondary" disabled>Disabled secondary</Button>
                  </Cluster>
                  <p className="pg-type-caption">
                    Disabled buttons are omitted from sequential focus order.
                    Adjacent text explains why when the reason matters to users.
                  </p>
                </Stack>
              </Surface>

              {/* Denied (aria-disabled) */}
              <Surface subtle>
                <Stack gap="4">
                  <h3 className="pg-type-section-title">Denied (aria-disabled, discoverable)</h3>
                  <Stack gap="3">
                    <div id="deny-reason-demo" className="pg-type-body-small pg-showcase__capability-disclaimer">
                      Demonstration only — production authorization is not evaluated here.
                      This action requires a role not present in this demonstration.
                    </div>
                    <Cluster gap="3">
                      <Button
                        variant="secondary"
                        denied
                        aria-describedby="deny-reason-demo"
                      >
                        Denied action (focusable, not activatable)
                      </Button>
                    </Cluster>
                  </Stack>
                  <p className="pg-type-caption">
                    aria-disabled keeps the button in tab order for discoverability.
                    It is not authorization enforcement.
                  </p>
                </Stack>
              </Surface>

              {/* IconButton */}
              <Surface subtle>
                <Stack gap="4">
                  <h3 className="pg-type-section-title">Icon Buttons</h3>
                  <Cluster gap="3">
                    <IconButton label="Close">×</IconButton>
                    <IconButton label="Settings">⚙</IconButton>
                    <IconButton label="Expand">▼</IconButton>
                  </Cluster>
                </Stack>
              </Surface>
            </Stack>
          </ShowcaseSection>

          {/* ── Form controls ─────────────────────────────────── */}
          <ShowcaseSection id="forms" title="Form Controls">
            <Stack gap="5">
              {/* TextInput */}
              <Surface subtle>
                <Stack gap="4">
                  <h3 className="pg-type-section-title">Text Input</h3>
                  <Grid minItemSize="16rem" gap="5">
                    <Field label="Edition title" description="Enter a short title for this edition">
                      <TextInput
                        value={textValue}
                        onChange={(e) => setTextValue(e.target.value)}
                        placeholder="e.g. Morning Edition"
                      />
                    </Field>
                    <Field
                      label="Byline"
                      required
                      errors={showFieldErrors ? ["Byline is required to proceed"] : []}
                    >
                      <TextInput placeholder="e.g. Staff reporter" />
                    </Field>
                    <Field label="Disabled input">
                      <TextInput value="Read-only value" disabled />
                    </Field>
                  </Grid>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowFieldErrors((v) => !v)}
                  >
                    {showFieldErrors ? "Clear errors" : "Show field errors"}
                  </Button>
                </Stack>
              </Surface>

              {/* TextArea */}
              <Surface subtle>
                <Stack gap="4">
                  <h3 className="pg-type-section-title">Text Area</h3>
                  <Field label="Summary" description="A brief summary of this edition's main stories">
                    <TextArea rows={4} placeholder="Enter a summary..." />
                  </Field>
                </Stack>
              </Surface>

              {/* Select */}
              <Surface subtle>
                <Stack gap="4">
                  <h3 className="pg-type-section-title">Select</h3>
                  <Grid minItemSize="16rem" gap="5">
                    <Field label="Publication" required>
                      <Select
                        value={selectValue}
                        onChange={(e) => setSelectValue(e.target.value)}
                      >
                        <option value="option-1">Pune Daily Ledger</option>
                        <option value="option-2">Deccan Evening Record</option>
                      </Select>
                    </Field>
                    <Field label="Disabled select">
                      <Select disabled>
                        <option>Disabled option</option>
                      </Select>
                    </Field>
                  </Grid>
                </Stack>
              </Surface>

              {/* Checkbox */}
              <Surface subtle>
                <Stack gap="4">
                  <h3 className="pg-type-section-title">Checkbox</h3>
                  <Stack gap="3">
                    <Checkbox
                      label="Mark for review"
                      checked={checkboxChecked}
                      onChange={(e) => setCheckboxChecked(e.target.checked)}
                    />
                    <Checkbox label="Disabled checkbox" disabled />
                    <Checkbox label="Disabled checked" disabled checked readOnly />
                  </Stack>
                </Stack>
              </Surface>

              {/* RadioGroup */}
              <Surface subtle>
                <Stack gap="4">
                  <h3 className="pg-type-section-title">Radio Group</h3>
                  <Stack gap="4">
                    <RadioGroup
                      legend="Edition priority"
                      options={[
                        { value: "option-a", label: "Standard" },
                        { value: "option-b", label: "Urgent" },
                        { value: "option-c", label: "Deferred" },
                      ]}
                      value={radioValue}
                      onChange={setRadioValue}
                    />
                    <RadioGroup
                      legend="Disabled group"
                      options={[
                        { value: "d-1", label: "Option 1" },
                        { value: "d-2", label: "Option 2" },
                      ]}
                      value="d-1"
                      disabled
                    />
                  </Stack>
                </Stack>
              </Surface>
            </Stack>
          </ShowcaseSection>

          {/* ── Messages and progress ─────────────────────────── */}
          <ShowcaseSection id="messages" title="Messages and Progress">
            <Stack gap="5">
              {/* InlineMessage variants */}
              <Surface subtle>
                <Stack gap="4">
                  <h3 className="pg-type-section-title">Inline Messages</h3>
                  <Stack gap="4">
                    <InlineMessage variant="info" heading="Information">
                      This edition has not yet been reviewed. Complete all required fields before submitting.
                    </InlineMessage>
                    <InlineMessage variant="success" heading="Saved">
                      Your intention has been recorded. Resolution is pending.
                    </InlineMessage>
                    <InlineMessage variant="warning" heading="Stale proof">
                      The current proof belongs to an earlier revision. A new resolution is needed.
                    </InlineMessage>
                    <InlineMessage variant="error" heading="Resolution failed" live>
                      The resolution attempt did not complete. Your saved intention is retained.
                    </InlineMessage>
                  </Stack>
                </Stack>
              </Surface>

              {/* ProgressIndicator */}
              <Surface subtle>
                <Stack gap="4">
                  <h3 className="pg-type-section-title">Progress Indicators</h3>
                  <Stack gap="5">
                    <ProgressIndicator label="Resolving layout — 60% complete" value={60} />
                    <ProgressIndicator label="Preparing proof — in progress" />
                  </Stack>
                </Stack>
              </Surface>
            </Stack>
          </ShowcaseSection>

          {/* ── Dialog ───────────────────────────────────────── */}
          <ShowcaseSection id="dialogs" title="Dialog">
            <Stack gap="5">
              <Surface subtle>
                <Stack gap="4">
                  <h3 className="pg-type-section-title">Dismissible dialog</h3>
                  <p className="pg-type-body-small">
                    Opens with focus on the heading. Tab and Shift+Tab are contained.
                    Escape and the close button dismiss. Focus returns to the invoker.
                  </p>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setDialogOpen(true)}
                  >
                    Open dialog
                  </Button>
                </Stack>
              </Surface>

              <Surface subtle>
                <Stack gap="4">
                  <h3 className="pg-type-section-title">Non-dismissible dialog</h3>
                  <p className="pg-type-body-small">
                    Requires an explicit action. Escape does not close.
                    For destructive or in-progress confirmations.
                  </p>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setNonDismissDialogOpen(true)}
                  >
                    Open non-dismissible dialog
                  </Button>
                </Stack>
              </Surface>
            </Stack>

            {/* Dismissible dialog */}
            <Dialog
              open={dialogOpen}
              onClose={() => setDialogOpen(false)}
              title="Review edition"
              description="Review the details below before proceeding. This is a demonstration dialog."
              dismissible
            >
              <Stack gap="4">
                <p className="pg-type-body">
                  Simulated — no real action is taken by this demonstration.
                </p>
                <Cluster gap="3" justify="end">
                  <Button variant="secondary" onClick={() => setDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button variant="primary" onClick={() => setDialogOpen(false)}>
                    Confirm
                  </Button>
                </Cluster>
              </Stack>
            </Dialog>

            {/* Non-dismissible dialog */}
            <Dialog
              open={nonDismissDialogOpen}
              onClose={() => setNonDismissDialogOpen(false)}
              title="Confirm deletion"
              description="This action is shown as non-dismissible. Escape does not close it."
              dismissible={false}
            >
              <Stack gap="4">
                <InlineMessage variant="warning" heading="Demonstration only">
                  No real deletion occurs here. This dialog requires an explicit button click.
                </InlineMessage>
                <Cluster gap="3" justify="end">
                  <Button variant="secondary" onClick={() => setNonDismissDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button variant="danger" onClick={() => setNonDismissDialogOpen(false)}>
                    Delete (simulated)
                  </Button>
                </Cluster>
              </Stack>
            </Dialog>
          </ShowcaseSection>

          {/* Footer */}
          <footer className="pg-showcase__footer">
            <p className="pg-type-caption">
              Pageinator UI001 Foundation · Simulated demonstration · No production data,
              authorization, or persistence. All fixture identifiers are fictional.
            </p>
          </footer>
        </Stack>
      </Container>
    </div>
  );
}
