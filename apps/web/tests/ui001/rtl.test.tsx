/**
 * Task 9 — RTL and directionality tests.
 * Verifies that components work correctly under dir="rtl",
 * labels and descriptions remain correct, fixture identifiers use <bdi>,
 * and the durable CSS uses logical properties.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { render, screen } from "../../src/test/render.tsx";
import { Field } from "../../src/ui/controls/Field.tsx";
import { TextInput } from "../../src/ui/controls/TextInput.tsx";
import { Select } from "../../src/ui/controls/Select.tsx";
import { Checkbox } from "../../src/ui/controls/Checkbox.tsx";
import { RadioGroup } from "../../src/ui/controls/RadioGroup.tsx";
import { Button } from "../../src/ui/controls/Button.tsx";
import { InlineMessage } from "../../src/ui/controls/InlineMessage.tsx";
import { StatusIndicator } from "../../src/ui/controls/StatusIndicator.tsx";
import { Stack } from "../../src/ui/layout/Stack.tsx";
import { Inline } from "../../src/ui/layout/Inline.tsx";

// ── Field controls under RTL ──────────────────────────────────────

describe("Field — RTL", () => {
  it("label remains associated with control under dir=rtl", () => {
    render(
      <div dir="rtl" lang="ur-IN">
        <Field label="عنوان">
          <TextInput />
        </Field>
      </div>
    );
    const label = screen.getByText("عنوان").closest("label")!;
    const input = screen.getByRole("textbox");
    expect(label.getAttribute("for")).toBe(input.id);
  });

  it("error messages remain associated with control under dir=rtl", () => {
    render(
      <div dir="rtl" lang="ur-IN">
        <Field label="عنوان" errors={["ضروری فیلڈ"]}>
          <TextInput />
        </Field>
      </div>
    );
    const input = screen.getByRole("textbox");
    const errEl = screen.getByText("ضروری فیلڈ");
    expect(input.getAttribute("aria-describedby")).toContain(errEl.id);
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("description remains associated with control under dir=rtl", () => {
    render(
      <div dir="rtl" lang="ur-IN">
        <Field label="عنوان" description="ایک مختصر عنوان درج کریں">
          <TextInput />
        </Field>
      </div>
    );
    const input = screen.getByRole("textbox");
    const descEl = screen.getByText("ایک مختصر عنوان درج کریں");
    expect(input.getAttribute("aria-describedby")).toContain(descEl.id);
  });
});

// ── Select under RTL ─────────────────────────────────────────────

describe("Select — RTL", () => {
  it("select label remains associated under dir=rtl", () => {
    render(
      <div dir="rtl" lang="ur-IN">
        <Field label="اشاعت">
          <Select>
            <option value="a">اشاعت الف</option>
            <option value="b">اشاعت ب</option>
          </Select>
        </Field>
      </div>
    );
    const label = screen.getByText("اشاعت").closest("label")!;
    const select = screen.getByRole("combobox");
    expect(label.getAttribute("for")).toBe(select.id);
  });
});

// ── Checkbox under RTL ───────────────────────────────────────────

describe("Checkbox — RTL", () => {
  it("label text is correct and accessible under dir=rtl", () => {
    render(
      <div dir="rtl" lang="ur-IN">
        <Checkbox label="جائزہ کے لیے نشان لگائیں" />
      </div>
    );
    expect(
      screen.getByRole("checkbox", { name: "جائزہ کے لیے نشان لگائیں" })
    ).toBeInTheDocument();
  });
});

// ── RadioGroup under RTL ─────────────────────────────────────────

describe("RadioGroup — RTL", () => {
  it("legend and radio labels are correct under dir=rtl", () => {
    render(
      <div dir="rtl" lang="ur-IN">
        <RadioGroup
          legend="ترجیح منتخب کریں"
          options={[
            { value: "a", label: "معیاری" },
            { value: "b", label: "فوری" },
          ]}
          value="a"
        />
      </div>
    );
    expect(
      screen.getByRole("group", { name: "ترجیح منتخب کریں" })
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "معیاری" })).toBeInTheDocument();
  });
});

// ── Button under RTL ─────────────────────────────────────────────

describe("Button — RTL", () => {
  it("button text is correct under dir=rtl", () => {
    render(
      <div dir="rtl" lang="ur-IN">
        <Button variant="primary">محفوظ کریں</Button>
      </div>
    );
    expect(screen.getByRole("button", { name: "محفوظ کریں" })).toBeInTheDocument();
  });
});

// ── InlineMessage under RTL ──────────────────────────────────────

describe("InlineMessage — RTL", () => {
  it("heading and content are correct under dir=rtl", () => {
    render(
      <div dir="rtl" lang="ur-IN">
        <InlineMessage variant="info" heading="معلومات">
          براہ کرم تمام لازمی خانے پُر کریں۔
        </InlineMessage>
      </div>
    );
    expect(screen.getByText("معلومات")).toBeInTheDocument();
    expect(screen.getByText("براہ کرم تمام لازمی خانے پُر کریں۔")).toBeInTheDocument();
  });
});

// ── StatusIndicator under RTL ────────────────────────────────────

describe("StatusIndicator — RTL", () => {
  it("canonical label is correct under dir=rtl", () => {
    render(
      <div dir="rtl" lang="ur-IN">
        <StatusIndicator
          state="confirmed-proof"
          subject="لے آؤٹ پروف"
          proofLabel="demo-proof-018-a"
          revisionLabel="demo-rev-018"
          announcement="off"
        />
      </div>
    );
    expect(screen.getByText("Confirmed Proof")).toBeInTheDocument();
    expect(screen.getByText("لے آؤٹ پروف")).toBeInTheDocument();
  });

  it("fixture identifiers use bdi element under RTL", () => {
    const { container } = render(
      <div dir="rtl">
        <StatusIndicator
          state="stale"
          subject="Layout proof"
          proofLabel="demo-proof-018-a"
          revisionLabel="demo-rev-018"
          relatedRevisionLabel="demo-rev-019"
          announcement="off"
        />
      </div>
    );
    const bdiElements = container.querySelectorAll("bdi");
    expect(bdiElements.length).toBeGreaterThanOrEqual(2);
  });

  it("approved-candidate still shows 'Not published' under RTL", () => {
    render(
      <div dir="rtl">
        <StatusIndicator
          state="approved-candidate"
          subject="نسخہ"
          candidateLabel="demo-candidate-042"
          announcement="off"
        />
      </div>
    );
    expect(screen.getByText("Not published")).toBeInTheDocument();
  });
});

// ── DOM order is preserved under RTL ─────────────────────────────

describe("DOM order under RTL", () => {
  it("Stack children appear in same DOM order under RTL as LTR", () => {
    const { container: ltrContainer } = render(
      <div dir="ltr">
        <Stack>
          <span>First</span>
          <span>Second</span>
          <span>Third</span>
        </Stack>
      </div>
    );
    const ltrItems = Array.from(ltrContainer.querySelectorAll("span")).map(
      (el) => el.textContent
    );

    const { container: rtlContainer } = render(
      <div dir="rtl">
        <Stack>
          <span>First</span>
          <span>Second</span>
          <span>Third</span>
        </Stack>
      </div>
    );
    const rtlItems = Array.from(rtlContainer.querySelectorAll("span")).map(
      (el) => el.textContent
    );

    expect(rtlItems).toEqual(ltrItems);
  });

  it("Inline children appear in same DOM order under RTL as LTR", () => {
    const { container: ltrContainer } = render(
      <div dir="ltr">
        <Inline>
          <span>Alpha</span>
          <span>Beta</span>
          <span>Gamma</span>
        </Inline>
      </div>
    );
    const ltrItems = Array.from(ltrContainer.querySelectorAll("span")).map(
      (el) => el.textContent
    );

    const { container: rtlContainer } = render(
      <div dir="rtl">
        <Inline>
          <span>Alpha</span>
          <span>Beta</span>
          <span>Gamma</span>
        </Inline>
      </div>
    );
    const rtlItems = Array.from(rtlContainer.querySelectorAll("span")).map(
      (el) => el.textContent
    );

    expect(rtlItems).toEqual(ltrItems);
  });
});

// ── CSS logical properties scan ───────────────────────────────────

describe("Durable CSS uses logical properties (RTL scan)", () => {
  const BASE_CSS = readFileSync(
    resolve(__dirname, "../../src/ui/base.css"),
    "utf-8"
  );
  const cssWithoutComments = BASE_CSS.replace(/\/\*[\s\S]*?\*\//g, "");

  it("uses margin-inline-start instead of margin-left for directional spacing", () => {
    // Verify that any inline-start/end patterns are present
    // (confirming logical property usage is intentional)
    expect(cssWithoutComments).toMatch(/margin-inline/);
  });

  it("has no margin-left declarations", () => {
    expect(cssWithoutComments).not.toMatch(/\bmargin-left\s*:/);
  });

  it("has no margin-right declarations", () => {
    expect(cssWithoutComments).not.toMatch(/\bmargin-right\s*:/);
  });

  it("has no padding-left declarations", () => {
    expect(cssWithoutComments).not.toMatch(/\bpadding-left\s*:/);
  });

  it("has no padding-right declarations", () => {
    expect(cssWithoutComments).not.toMatch(/\bpadding-right\s*:/);
  });

  it("has no border-left declarations", () => {
    expect(cssWithoutComments).not.toMatch(/\bborder-left\s*:/);
  });

  it("has no border-right declarations", () => {
    expect(cssWithoutComments).not.toMatch(/\bborder-right\s*:/);
  });
});

// ── LTR publication fixture direction ─────────────────────────────

describe("Publication fixtures preserve direction", () => {
  it("LTR publication has direction=ltr", async () => {
    const { PUB_PUNE_DAILY } = await import("../../src/demo/ui001/fixtures.ts");
    expect(PUB_PUNE_DAILY.direction).toBe("ltr");
  });

  it("RTL publication has direction=rtl", async () => {
    const { PUB_URDU_EVENING } = await import("../../src/demo/ui001/fixtures.ts");
    expect(PUB_URDU_EVENING.direction).toBe("rtl");
  });
});
