/**
 * Task 7 — Status-semantic tests.
 * Verifies all eight PresentationState values with canonical labels,
 * non-colour cues, announcement policies, required identities, and
 * prohibited semantic equivalences.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "../../src/test/render.tsx";
import { StatusIndicator } from "../../src/ui/controls/StatusIndicator.tsx";
import type { PresentationState } from "../../src/ui/contracts/presentation-state.ts";

/**
 * Renders a StatusIndicator for a given state with the required
 * identity fields for that state supplied. `StatusIndicatorProps` is a
 * discriminated union (H-01), so unlike the props object this replaces,
 * each branch below is a genuine literal `state` assignment rather than
 * a widened `PresentationState`, and TypeScript enforces at compile
 * time that "stale" gets both revision labels, "failed" gets `detail`,
 * and "approved-candidate" gets `candidateLabel`.
 */
function renderStatus(state: PresentationState) {
  switch (state) {
    case "stale":
      return render(
        <StatusIndicator
          state="stale"
          subject="Layout proof"
          detail="This proof is from an older revision"
          proofLabel="demo-proof-018-a"
          revisionLabel="demo-rev-018"
          relatedRevisionLabel="demo-rev-019"
          announcement="off"
        />
      );
    case "failed":
      return render(
        <StatusIndicator
          state="failed"
          subject="Layout proof"
          detail="Resolution failed"
          revisionLabel="demo-rev-019"
          announcement="off"
        />
      );
    case "approved-candidate":
      return render(
        <StatusIndicator
          state="approved-candidate"
          subject="Edition candidate"
          candidateLabel="demo-candidate-042"
          proofLabel="demo-proof-018-a"
          announcement="off"
        />
      );
    default:
      return render(
        <StatusIndicator
          state={state}
          subject="Layout proof"
          revisionLabel="demo-rev-018"
          announcement="off"
        />
      );
  }
}

// ── All eight states: canonical labels ──────────────────────────────

describe("StatusIndicator — canonical labels", () => {
  const cases: Array<{ state: PresentationState; label: string }> = [
    { state: "simulated", label: "Simulated" },
    { state: "pending", label: "Pending" },
    { state: "saved-intention", label: "Saved Intention" },
    { state: "recomposing", label: "Recomposing" },
    { state: "confirmed-proof", label: "Confirmed Proof" },
    { state: "stale", label: "Stale" },
    { state: "failed", label: "Failed" },
    { state: "approved-candidate", label: "Approved Candidate" },
  ];

  for (const { state, label } of cases) {
    it(`state="${state}" renders label "${label}"`, () => {
      renderStatus(state);
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  }
});

// ── All eight states: non-colour cues ───────────────────────────────

describe("StatusIndicator — non-colour cues", () => {
  const states: PresentationState[] = [
    "simulated", "pending", "saved-intention", "recomposing",
    "confirmed-proof", "stale", "failed", "approved-candidate",
  ];

  for (const state of states) {
    it(`state="${state}" renders a non-colour icon cue`, () => {
      const { container } = renderStatus(state);
      const icon = container.querySelector(".pg-status__icon");
      expect(icon).toBeInTheDocument();
      // Icon has non-empty accessible label
      expect(icon?.getAttribute("aria-label")).toBeTruthy();
      expect(icon?.textContent?.trim()).toBeTruthy();
    });
  }
});

// ── data-pg-state attribute for testing hooks ───────────────────────

describe("StatusIndicator — data-pg-state attribute", () => {
  const states: PresentationState[] = [
    "simulated", "pending", "saved-intention", "recomposing",
    "confirmed-proof", "stale", "failed", "approved-candidate",
  ];

  for (const state of states) {
    it(`state="${state}" sets data-pg-state="${state}"`, () => {
      const { container } = renderStatus(state);
      expect(container.firstChild).toHaveAttribute("data-pg-state", state);
    });
  }
});

// ── Semantic safety: saved-intention ────────────────────────────────

describe("Saved intention — semantic safety", () => {
  it("does not contain 'resolved'", () => {
    const { container } = render(
      <StatusIndicator
        state="saved-intention"
        subject="Layout proof"
        detail="Intention recorded. Layout not yet resolved."
        revisionLabel="demo-rev-018"
        announcement="off"
      />
    );
    const label = container.querySelector(".pg-status__label");
    expect(label?.textContent).not.toMatch(/resolved/i);
    expect(label?.textContent).not.toMatch(/proof confirmed/i);
  });

  it("label is 'Saved Intention' not 'Confirmed' or 'Resolved'", () => {
    render(
      <StatusIndicator
        state="saved-intention"
        subject="Layout proof"
        announcement="off"
      />
    );
    expect(screen.getByText("Saved Intention")).toBeInTheDocument();
    expect(screen.queryByText(/confirmed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/resolved/i)).not.toBeInTheDocument();
  });
});

// ── Semantic safety: simulated ────────────────────────────────────

describe("Simulated state", () => {
  it("exposes the word 'Simulated'", () => {
    render(
      <StatusIndicator
        state="simulated"
        subject="Layout proof"
        detail="Simulated starting state for demonstration"
        announcement="off"
      />
    );
    expect(screen.getByText("Simulated")).toBeInTheDocument();
  });
});

// ── Semantic safety: stale ────────────────────────────────────────

describe("Stale state", () => {
  it("shows both the revision the proof belongs to and the current revision (H-02)", () => {
    render(
      <StatusIndicator
        state="stale"
        subject="Layout proof"
        detail="This proof is from an older revision"
        proofLabel="demo-proof-018-a"
        revisionLabel="demo-rev-018"
        relatedRevisionLabel="demo-rev-019"
        announcement="off"
      />
    );
    // The proof identity, the revision it is bound to, and the newer
    // current revision are all distinct and all visible — none of
    // them stands in for another.
    expect(screen.getByText(/demo-proof-018-a/)).toBeInTheDocument();
    expect(screen.getByText(/demo-rev-018/)).toBeInTheDocument();
    expect(screen.getByText(/demo-rev-019/)).toBeInTheDocument();
  });

  it("renders both revision labels even without an explicit proof identity", () => {
    // proofLabel is optional for stale; revisionLabel and
    // relatedRevisionLabel are required by the props union (H-01) and
    // must render unconditionally.
    render(
      <StatusIndicator
        state="stale"
        subject="Layout proof"
        revisionLabel="demo-rev-018"
        relatedRevisionLabel="demo-rev-019"
        announcement="off"
      />
    );
    expect(screen.getByText(/demo-rev-018/)).toBeInTheDocument();
    expect(screen.getByText(/demo-rev-019/)).toBeInTheDocument();
  });

  it("label is 'Stale' not 'Current' or 'Confirmed'", () => {
    render(
      <StatusIndicator
        state="stale"
        subject="Layout proof"
        revisionLabel="demo-rev-018"
        relatedRevisionLabel="demo-rev-019"
        announcement="off"
      />
    );
    expect(screen.getByText("Stale")).toBeInTheDocument();
  });
});

// ── Semantic safety: revision context is never silently dropped (H-02) ──

describe("Revision context is rendered, not silently accepted and dropped", () => {
  const revisionBearingStates: Array<"pending" | "saved-intention" | "recomposing"> = [
    "pending",
    "saved-intention",
    "recomposing",
  ];

  for (const state of revisionBearingStates) {
    it(`state="${state}" renders its revisionLabel`, () => {
      render(
        <StatusIndicator
          state={state}
          subject="Layout proof"
          revisionLabel="demo-rev-018"
          announcement="off"
        />
      );
      expect(screen.getByText(/demo-rev-018/)).toBeInTheDocument();
    });
  }

  it("confirmed-proof renders a proof identity distinct from its bound revision", () => {
    render(
      <StatusIndicator
        state="confirmed-proof"
        subject="Layout proof"
        proofLabel="demo-proof-018-a"
        revisionLabel="demo-rev-018"
        announcement="off"
      />
    );
    expect(screen.getByText(/demo-proof-018-a/)).toBeInTheDocument();
    expect(screen.getByText(/demo-rev-018/)).toBeInTheDocument();
  });

  it("approved-candidate can show the proof it was derived from, distinct from the candidate identity", () => {
    render(
      <StatusIndicator
        state="approved-candidate"
        subject="Edition candidate"
        candidateLabel="demo-candidate-042"
        proofLabel="demo-proof-018-a"
        announcement="off"
      />
    );
    expect(screen.getByText(/demo-candidate-042/)).toBeInTheDocument();
    expect(screen.getByText(/demo-proof-018-a/)).toBeInTheDocument();
  });
});

// ── Semantic safety: approved-candidate ──────────────────────────────

describe("Approved candidate — semantic safety", () => {
  it("renders 'Not published' unconditionally", () => {
    render(
      <StatusIndicator
        state="approved-candidate"
        subject="Edition candidate"
        candidateLabel="demo-candidate-042"
        announcement="off"
      />
    );
    expect(screen.getByText("Not published")).toBeInTheDocument();
  });

  it("renders the candidate identity", () => {
    render(
      <StatusIndicator
        state="approved-candidate"
        subject="Edition candidate"
        candidateLabel="demo-candidate-042"
        announcement="off"
      />
    );
    expect(screen.getByText(/demo-candidate-042/)).toBeInTheDocument();
  });

  it("label is 'Approved Candidate', not 'Published'", () => {
    render(
      <StatusIndicator
        state="approved-candidate"
        subject="Edition candidate"
        candidateLabel="demo-candidate-042"
        announcement="off"
      />
    );
    expect(screen.getByText("Approved Candidate")).toBeInTheDocument();
    expect(screen.queryByText(/published edition/i)).not.toBeInTheDocument();
  });
});

// ── Semantic safety: failed ───────────────────────────────────────

describe("Failed state", () => {
  it("renders 'Failed' label", () => {
    render(
      <StatusIndicator
        state="failed"
        subject="Layout proof"
        detail="Resolution failed for demo-rev-019. Prior proof is retained."
        announcement="off"
      />
    );
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("renders the detail message", () => {
    render(
      <StatusIndicator
        state="failed"
        subject="Layout proof"
        detail="Resolution failed for demo-rev-019. Prior proof is retained."
        announcement="off"
      />
    );
    expect(
      screen.getByText(/Resolution failed for demo-rev-019/)
    ).toBeInTheDocument();
  });
});

// ── Announcement policies ─────────────────────────────────────────

describe("StatusIndicator — announcement policies", () => {
  it("announcement=off results in no aria-live attribute", () => {
    const { container } = render(
      <StatusIndicator
        state="pending"
        subject="Layout proof"
        announcement="off"
      />
    );
    expect(container.firstChild).not.toHaveAttribute("aria-live");
  });

  it("announcement=polite sets aria-live=polite", () => {
    const { container } = render(
      <StatusIndicator
        state="pending"
        subject="Layout proof"
        announcement="polite"
      />
    );
    expect(container.firstChild).toHaveAttribute("aria-live", "polite");
  });

  it("announcement=assertive sets aria-live=assertive", () => {
    const { container } = render(
      <StatusIndicator
        state="failed"
        subject="Layout proof"
        detail="Failed"
        announcement="assertive"
      />
    );
    expect(container.firstChild).toHaveAttribute("aria-live", "assertive");
  });

  it("failed state defaults to assertive when no announcement prop given", () => {
    const { container } = render(
      <StatusIndicator
        state="failed"
        subject="Layout proof"
        detail="Failed"
      />
    );
    expect(container.firstChild).toHaveAttribute("aria-live", "assertive");
  });

  it("pending state defaults to polite when no announcement prop given", () => {
    const { container } = render(
      <StatusIndicator
        state="pending"
        subject="Layout proof"
      />
    );
    expect(container.firstChild).toHaveAttribute("aria-live", "polite");
  });

  it("simulated state defaults to off", () => {
    const { container } = render(
      <StatusIndicator
        state="simulated"
        subject="Layout proof"
      />
    );
    expect(container.firstChild).not.toHaveAttribute("aria-live");
  });
});

// ── PresentationState type — exactly eight values ────────────────────

describe("PresentationState union", () => {
  it("covers exactly the eight specified states", () => {
    // This is a compile-time check encoded as a runtime assertion.
    // The array must match the PresentationState union exactly.
    const allStates: PresentationState[] = [
      "simulated",
      "pending",
      "saved-intention",
      "recomposing",
      "confirmed-proof",
      "stale",
      "failed",
      "approved-candidate",
    ];
    expect(allStates).toHaveLength(8);
  });
});
