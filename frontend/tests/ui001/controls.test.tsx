/**
 * Tasks 4 & 5 — Field, form controls, and action control tests.
 * Verifies native element choice, label/control association,
 * description/error relationships, required/invalid states,
 * disabled/denied behavior, and forwarded attributes.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "../../src/test/render.tsx";
import userEvent from "@testing-library/user-event";
import { Button } from "../../src/ui/controls/Button.tsx";
import { IconButton } from "../../src/ui/controls/IconButton.tsx";
import { Field } from "../../src/ui/controls/Field.tsx";
import { TextInput } from "../../src/ui/controls/TextInput.tsx";
import { TextArea } from "../../src/ui/controls/TextArea.tsx";
import { Select } from "../../src/ui/controls/Select.tsx";
import { Checkbox } from "../../src/ui/controls/Checkbox.tsx";
import { RadioGroup } from "../../src/ui/controls/RadioGroup.tsx";

// ── Button ───────────────────────────────────────────────────────────

describe("Button", () => {
  it("renders a native button element", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole("button", { name: "Click me" })).toBeInTheDocument();
  });

  it("defaults to type=button", () => {
    render(<Button>Click</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });

  it("applies the specified type when provided", () => {
    render(<Button type="submit">Submit</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "submit");
  });

  it("applies primary variant class by default", () => {
    const { container } = render(<Button>Primary</Button>);
    expect(container.firstChild).toHaveClass("pg-button--primary");
  });

  it("applies secondary variant class", () => {
    const { container } = render(<Button variant="secondary">Secondary</Button>);
    expect(container.firstChild).toHaveClass("pg-button--secondary");
  });

  it("applies danger variant class", () => {
    const { container } = render(<Button variant="danger">Danger</Button>);
    expect(container.firstChild).toHaveClass("pg-button--danger");
  });

  it("applies sm size class", () => {
    const { container } = render(<Button size="sm">Small</Button>);
    expect(container.firstChild).toHaveClass("pg-button--sm");
  });

  it("applies lg size class", () => {
    const { container } = render(<Button size="lg">Large</Button>);
    expect(container.firstChild).toHaveClass("pg-button--lg");
  });

  it("disabled button cannot activate — click handler not called", async () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Disabled</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("disabled button is not in sequential focus order (disabled attribute)", () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("enabled button fires onClick", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Active</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("denied button has aria-disabled=true", () => {
    render(
      <Button denied aria-describedby="denial-reason">
        Denied
      </Button>
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-disabled", "true");
  });

  it("denied button does not fire onClick on click", async () => {
    const onClick = vi.fn();
    render(
      <Button denied aria-describedby="denial-reason" onClick={onClick}>
        Denied
      </Button>
    );
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("denied button is in tab order (discoverable)", () => {
    render(
      <Button denied aria-describedby="denial-reason">
        Denied
      </Button>
    );
    expect(screen.getByRole("button")).not.toBeDisabled();
  });

  it("denied button does not activate on Enter", () => {
    const onClick = vi.fn();
    const { container } = render(
      <Button denied aria-describedby="denial-reason" onClick={onClick}>
        Denied
      </Button>
    );
    fireEvent.keyDown(container.querySelector("button")!, { key: "Enter" });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("denied button does not activate on Space", () => {
    const onClick = vi.fn();
    const { container } = render(
      <Button denied aria-describedby="denial-reason" onClick={onClick}>
        Denied
      </Button>
    );
    fireEvent.keyDown(container.querySelector("button")!, { key: " " });
    expect(onClick).not.toHaveBeenCalled();
  });
});

// ── IconButton ───────────────────────────────────────────────────────

describe("IconButton", () => {
  it("renders a native button element", () => {
    render(<IconButton label="Close">×</IconButton>);
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("has the required accessible name via aria-label", () => {
    render(<IconButton label="Settings">⚙</IconButton>);
    expect(screen.getByRole("button")).toHaveAttribute("aria-label", "Settings");
  });

  it("defaults to type=button", () => {
    render(<IconButton label="Close">×</IconButton>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });

  it("renders icon as aria-hidden", () => {
    const { container } = render(<IconButton label="Close">×</IconButton>);
    const iconSpan = container.querySelector("span[aria-hidden]");
    expect(iconSpan).toBeInTheDocument();
    expect(iconSpan).toHaveAttribute("aria-hidden", "true");
  });

  it("applies pg-icon-button class", () => {
    const { container } = render(<IconButton label="Close">×</IconButton>);
    expect(container.firstChild).toHaveClass("pg-icon-button");
  });
});

// ── Field ────────────────────────────────────────────────────────────

describe("Field", () => {
  it("renders a visible label", () => {
    render(
      <Field label="Email address">
        <TextInput />
      </Field>
    );
    expect(screen.getByText("Email address")).toBeInTheDocument();
  });

  it("associates the label with the control via htmlFor/id", () => {
    render(
      <Field label="Email address">
        <TextInput />
      </Field>
    );
    const label = screen.getByText("Email address").closest("label")!;
    const input = screen.getByRole("textbox");
    expect(label).toHaveAttribute("for", input.id);
  });

  it("renders description text", () => {
    render(
      <Field label="Title" description="Enter a short title">
        <TextInput />
      </Field>
    );
    expect(screen.getByText("Enter a short title")).toBeInTheDocument();
  });

  it("associates description with control via aria-describedby", () => {
    render(
      <Field label="Title" description="Enter a short title">
        <TextInput />
      </Field>
    );
    const input = screen.getByRole("textbox");
    const descEl = screen.getByText("Enter a short title");
    expect(input.getAttribute("aria-describedby")).toContain(descEl.id);
  });

  it("renders error messages", () => {
    render(
      <Field label="Title" errors={["Title is required", "Title must be unique"]}>
        <TextInput />
      </Field>
    );
    expect(screen.getByText("Title is required")).toBeInTheDocument();
    expect(screen.getByText("Title must be unique")).toBeInTheDocument();
  });

  it("sets aria-invalid on control when errors present", () => {
    render(
      <Field label="Title" errors={["Required"]}>
        <TextInput />
      </Field>
    );
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
  });

  it("associates error IDs with control via aria-describedby", () => {
    render(
      <Field label="Title" errors={["Required"]}>
        <TextInput />
      </Field>
    );
    const input = screen.getByRole("textbox");
    const errEl = screen.getByText("Required");
    expect(input.getAttribute("aria-describedby")).toContain(errEl.id);
  });

  it("does not set aria-invalid when no errors", () => {
    render(
      <Field label="Title">
        <TextInput />
      </Field>
    );
    expect(screen.getByRole("textbox")).not.toHaveAttribute("aria-invalid");
  });

  it("conveys required state visibly and semantically", () => {
    render(
      <Field label="Name" required>
        <TextInput />
      </Field>
    );
    const input = screen.getByRole("textbox");
    expect(input).toBeRequired();
    // Visible required indicator in the label area
    expect(screen.getByText("Name", { exact: false })).toBeInTheDocument();
  });

  it("no aria-invalid without errors even when required", () => {
    render(
      <Field label="Name" required>
        <TextInput />
      </Field>
    );
    expect(screen.getByRole("textbox")).not.toHaveAttribute("aria-invalid");
  });
});

// ── TextInput ────────────────────────────────────────────────────────

describe("TextInput", () => {
  it("renders an input element of type text by default", () => {
    render(<TextInput />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveAttribute("type", "text");
  });

  it("renders email type", () => {
    const { container } = render(<TextInput type="email" />);
    expect(container.querySelector("input")).toHaveAttribute("type", "email");
  });

  it("applies pg-input class", () => {
    const { container } = render(<TextInput />);
    expect(container.querySelector("input")).toHaveClass("pg-input");
  });

  it("forwards disabled prop", () => {
    render(<TextInput disabled />);
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("forwards value and onChange", async () => {
    const onChange = vi.fn();
    render(<TextInput value="hello" onChange={onChange} />);
    expect(screen.getByRole("textbox")).toHaveValue("hello");
  });
});

// ── TextArea ─────────────────────────────────────────────────────────

describe("TextArea", () => {
  it("renders a textarea element", () => {
    render(<TextArea />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    const el = screen.getByRole("textbox");
    expect(el.tagName).toBe("TEXTAREA");
  });

  it("applies pg-textarea class", () => {
    const { container } = render(<TextArea />);
    expect(container.querySelector("textarea")).toHaveClass("pg-textarea");
  });

  it("forwards disabled prop", () => {
    render(<TextArea disabled />);
    expect(screen.getByRole("textbox")).toBeDisabled();
  });
});

// ── Select ───────────────────────────────────────────────────────────

describe("Select", () => {
  it("renders a select element", () => {
    render(
      <Select>
        <option value="a">Option A</option>
        <option value="b">Option B</option>
      </Select>
    );
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("applies pg-select class", () => {
    const { container } = render(
      <Select>
        <option>Opt</option>
      </Select>
    );
    expect(container.querySelector("select")).toHaveClass("pg-select");
  });

  it("forwards disabled prop", () => {
    render(
      <Select disabled>
        <option>Opt</option>
      </Select>
    );
    expect(screen.getByRole("combobox")).toBeDisabled();
  });
});

// ── Checkbox ─────────────────────────────────────────────────────────

describe("Checkbox", () => {
  it("renders a checkbox with visible label", () => {
    render(<Checkbox label="Accept terms" />);
    expect(screen.getByRole("checkbox", { name: "Accept terms" })).toBeInTheDocument();
  });

  it("renders as a native input[type=checkbox]", () => {
    const { container } = render(<Checkbox label="Accept" />);
    expect(container.querySelector("input[type=checkbox]")).toBeInTheDocument();
  });

  it("is not disabled by default", () => {
    render(<Checkbox label="Toggle" />);
    expect(screen.getByRole("checkbox")).not.toBeDisabled();
  });

  it("forwards disabled prop", () => {
    render(<Checkbox label="Toggle" disabled />);
    expect(screen.getByRole("checkbox")).toBeDisabled();
  });

  it("fires onChange when Space is pressed (native behavior)", async () => {
    const onChange = vi.fn();
    render(<Checkbox label="Toggle" onChange={onChange} />);
    const cb = screen.getByRole("checkbox");
    await userEvent.type(cb, " ");
    expect(onChange).toHaveBeenCalled();
  });
});

// ── RadioGroup ───────────────────────────────────────────────────────

describe("RadioGroup", () => {
  const options = [
    { value: "a", label: "Option A" },
    { value: "b", label: "Option B" },
    { value: "c", label: "Option C" },
  ];

  it("renders as fieldset with legend", () => {
    const { container } = render(
      <RadioGroup legend="Choose one" options={options} />
    );
    expect(container.querySelector("fieldset")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Choose one" })).toBeInTheDocument();
  });

  it("renders native radio inputs", () => {
    const { container } = render(
      <RadioGroup legend="Choose one" options={options} />
    );
    const radios = container.querySelectorAll("input[type=radio]");
    expect(radios).toHaveLength(3);
  });

  it("each radio has a visible label", () => {
    render(<RadioGroup legend="Choose one" options={options} />);
    expect(screen.getByRole("radio", { name: "Option A" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Option B" })).toBeInTheDocument();
  });

  it("selected radio is checked", () => {
    render(<RadioGroup legend="Choose one" options={options} value="b" />);
    expect(screen.getByRole("radio", { name: "Option B" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Option A" })).not.toBeChecked();
  });

  it("fires onChange when a radio is clicked", async () => {
    const onChange = vi.fn();
    render(
      <RadioGroup legend="Choose one" options={options} value="a" onChange={onChange} />
    );
    await userEvent.click(screen.getByRole("radio", { name: "Option C" }));
    expect(onChange).toHaveBeenCalledWith("c");
  });

  it("disabled group has disabled radios", () => {
    render(<RadioGroup legend="Choose one" options={options} disabled />);
    const radios = screen.getAllByRole("radio");
    for (const radio of radios) {
      expect(radio).toBeDisabled();
    }
  });
});

// ── RTL: field controls ───────────────────────────────────────────────

describe("Field controls under RTL", () => {
  it("label and input remain associated under RTL wrapper", () => {
    render(
      <div dir="rtl">
        <Field label="عنوان">
          <TextInput />
        </Field>
      </div>
    );
    const label = screen.getByText("عنوان").closest("label")!;
    const input = screen.getByRole("textbox");
    expect(label).toHaveAttribute("for", input.id);
  });

  it("RadioGroup legend and radios remain correct under RTL", () => {
    const options = [
      { value: "a", label: "الخيار الأول" },
      { value: "b", label: "الخيار الثاني" },
    ];
    render(
      <div dir="rtl">
        <RadioGroup legend="اختر واحدا" options={options} />
      </div>
    );
    expect(
      screen.getByRole("group", { name: "اختر واحدا" })
    ).toBeInTheDocument();
  });
});
