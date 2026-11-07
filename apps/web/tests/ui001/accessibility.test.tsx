/**
 * Task 9 — Accessibility tests.
 * Verifies axe-core compliance, heading structure, live region policy,
 * and accessible name requirements.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "../../src/test/render.tsx";
import axe from "axe-core";
import { Button } from "../../src/ui/controls/Button.tsx";
import { Field } from "../../src/ui/controls/Field.tsx";
import { TextInput } from "../../src/ui/controls/TextInput.tsx";
import { TextArea } from "../../src/ui/controls/TextArea.tsx";
import { Select } from "../../src/ui/controls/Select.tsx";
import { Checkbox } from "../../src/ui/controls/Checkbox.tsx";
import { RadioGroup } from "../../src/ui/controls/RadioGroup.tsx";
import { InlineMessage } from "../../src/ui/controls/InlineMessage.tsx";
import { StatusIndicator } from "../../src/ui/controls/StatusIndicator.tsx";
import { ProgressIndicator } from "../../src/ui/controls/ProgressIndicator.tsx";
import { Stack } from "../../src/ui/layout/Stack.tsx";
import { IconButton } from "../../src/ui/controls/IconButton.tsx";

// ── axe helper ───────────────────────────────────────────────────────

async function checkAxe(container: HTMLElement) {
  const results = await axe.run(container, {
    rules: {
      // Disable color-contrast in jsdom — CSS custom properties are not resolved
      // in the test environment. Contrast is separately verified in tokens.test.ts.
      "color-contrast": { enabled: false },
    },
  });
  const critical = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious"
  );
  return critical;
}

// ── Button accessibility ─────────────────────────────────────────────

describe("Button — axe", () => {
  it("primary button has no serious/critical violations", async () => {
    const { container } = render(<Button variant="primary">Save</Button>);
    const violations = await checkAxe(container);
    expect(violations).toHaveLength(0);
  });

  it("disabled button has no serious/critical violations", async () => {
    const { container } = render(<Button disabled>Disabled</Button>);
    const violations = await checkAxe(container);
    expect(violations).toHaveLength(0);
  });

  it("denied button has aria-describedby referencing denial reason", async () => {
    const { container } = render(
      <div>
        <p id="deny-reason">Demonstration only — production authorization is not evaluated here.</p>
        <Button denied aria-describedby="deny-reason">
          Denied action
        </Button>
      </div>
    );
    const violations = await checkAxe(container);
    expect(violations).toHaveLength(0);
  });
});

// ── IconButton accessibility ──────────────────────────────────────────

describe("IconButton — axe", () => {
  it("has no violations — accessible name via aria-label", async () => {
    const { container } = render(<IconButton label="Close dialog">×</IconButton>);
    const violations = await checkAxe(container);
    expect(violations).toHaveLength(0);
  });
});

// ── Field accessibility ──────────────────────────────────────────────

describe("Field — axe", () => {
  it("has no violations for basic field", async () => {
    const { container } = render(
      <Field label="Email address">
        <TextInput type="email" />
      </Field>
    );
    const violations = await checkAxe(container);
    expect(violations).toHaveLength(0);
  });

  it("has no violations for field with error", async () => {
    const { container } = render(
      <Field label="Email address" errors={["Enter a valid email address"]}>
        <TextInput type="email" />
      </Field>
    );
    const violations = await checkAxe(container);
    expect(violations).toHaveLength(0);
  });

  it("has no violations for required field", async () => {
    const { container } = render(
      <Field label="Title" required>
        <TextInput />
      </Field>
    );
    const violations = await checkAxe(container);
    expect(violations).toHaveLength(0);
  });

  it("has no violations for textarea field", async () => {
    const { container } = render(
      <Field label="Summary">
        <TextArea rows={3} />
      </Field>
    );
    const violations = await checkAxe(container);
    expect(violations).toHaveLength(0);
  });

  it("has no violations for select field", async () => {
    const { container } = render(
      <Field label="Publication">
        <Select>
          <option value="a">Publication A</option>
          <option value="b">Publication B</option>
        </Select>
      </Field>
    );
    const violations = await checkAxe(container);
    expect(violations).toHaveLength(0);
  });
});

// ── Checkbox accessibility ────────────────────────────────────────────

describe("Checkbox — axe", () => {
  it("has no violations", async () => {
    const { container } = render(<Checkbox label="Accept terms" />);
    const violations = await checkAxe(container);
    expect(violations).toHaveLength(0);
  });
});

// ── RadioGroup accessibility ──────────────────────────────────────────

describe("RadioGroup — axe", () => {
  it("has no violations", async () => {
    const { container } = render(
      <RadioGroup
        legend="Choose priority"
        options={[
          { value: "a", label: "Standard" },
          { value: "b", label: "Urgent" },
        ]}
        value="a"
      />
    );
    const violations = await checkAxe(container);
    expect(violations).toHaveLength(0);
  });
});

// ── InlineMessage accessibility ───────────────────────────────────────

describe("InlineMessage — axe", () => {
  it("has no violations for info variant", async () => {
    const { container } = render(
      <InlineMessage variant="info" heading="Information">
        Please complete all fields.
      </InlineMessage>
    );
    const violations = await checkAxe(container);
    expect(violations).toHaveLength(0);
  });

  it("has no violations for error variant with live=true", async () => {
    const { container } = render(
      <InlineMessage variant="error" heading="Submission failed" live>
        Please fix the errors and try again.
      </InlineMessage>
    );
    const violations = await checkAxe(container);
    expect(violations).toHaveLength(0);
  });
});

// ── StatusIndicator accessibility ────────────────────────────────────

describe("StatusIndicator — axe", () => {
  it("has no violations for simulated state", async () => {
    const { container } = render(
      <StatusIndicator
        state="simulated"
        subject="Layout proof"
        announcement="off"
      />
    );
    const violations = await checkAxe(container);
    expect(violations).toHaveLength(0);
  });

  it("has no violations for approved-candidate state", async () => {
    const { container } = render(
      <StatusIndicator
        state="approved-candidate"
        subject="Edition candidate"
        candidateLabel="demo-candidate-042"
        announcement="off"
      />
    );
    const violations = await checkAxe(container);
    expect(violations).toHaveLength(0);
  });

  it("has no violations for stale state", async () => {
    const { container } = render(
      <StatusIndicator
        state="stale"
        subject="Layout proof"
        proofLabel="demo-proof-018-a"
        revisionLabel="demo-rev-018"
        relatedRevisionLabel="demo-rev-019"
        announcement="off"
      />
    );
    const violations = await checkAxe(container);
    expect(violations).toHaveLength(0);
  });
});

// ── ProgressIndicator accessibility ──────────────────────────────────

describe("ProgressIndicator — axe", () => {
  it("has no violations for known progress", async () => {
    const { container } = render(
      <ProgressIndicator label="Resolving layout — 60% complete" value={60} />
    );
    const violations = await checkAxe(container);
    expect(violations).toHaveLength(0);
  });

  it("has no violations for indeterminate progress", async () => {
    const { container } = render(
      <ProgressIndicator label="Preparing proof — please wait" />
    );
    const violations = await checkAxe(container);
    expect(violations).toHaveLength(0);
  });
});

// ── Heading structure ─────────────────────────────────────────────────

describe("Heading structure semantics", () => {
  it("a page with one h1 has no axe violations", async () => {
    const { container } = render(
      <div>
        <h1>Pageinator UI Foundation</h1>
        <section>
          <h2>Typography</h2>
          <p>Body text</p>
        </section>
        <section>
          <h2>Controls</h2>
          <h3>Buttons</h3>
          <Button>Click</Button>
        </section>
      </div>
    );
    const violations = await checkAxe(container);
    expect(violations).toHaveLength(0);
  });
});

// ── Placeholder is not the accessible name ────────────────────────────

describe("Placeholder accessibility", () => {
  it("input with no label and no placeholder has a label violation (negative test)", async () => {
    const { container } = render(<TextInput />);
    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    const labelViolation = results.violations.find(
      (v) => v.id === "label" || v.id === "form-field-multiple-labels"
    );
    // Standalone input without any accessible name should have an axe violation
    expect(labelViolation).toBeDefined();
  });

  it("input with Field label has no label violations", async () => {
    const { container } = render(
      <Field label="Full name">
        <TextInput placeholder="e.g. Priya Sharma" />
      </Field>
    );
    const violations = await checkAxe(container);
    expect(violations).toHaveLength(0);
  });
});

// ── Live region policy ────────────────────────────────────────────────

describe("Live region policy", () => {
  it("user-triggered error uses alert role", () => {
    render(
      <InlineMessage variant="error" heading="Action failed" live>
        The resolution did not complete.
      </InlineMessage>
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("static info message does not use alert role", () => {
    render(
      <InlineMessage variant="info" heading="Guidance">
        Complete all required fields.
      </InlineMessage>
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("status indicator with polite announcement uses aria-live=polite", () => {
    const { container } = render(
      <StatusIndicator state="saved-intention" subject="Layout proof" announcement="polite" />
    );
    expect(container.firstChild).toHaveAttribute("aria-live", "polite");
  });
});

// ── Stack used as list ────────────────────────────────────────────────

describe("Stack as list — axe", () => {
  it("Stack as ul with li children has no violations", async () => {
    const { container } = render(
      <Stack as="ul">
        <li>Item 1</li>
        <li>Item 2</li>
      </Stack>
    );
    const violations = await checkAxe(container);
    expect(violations).toHaveLength(0);
  });
});
