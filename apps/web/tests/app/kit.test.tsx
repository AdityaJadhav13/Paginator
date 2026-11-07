/**
 * The app kit (src/ui/kit, 02 §3.5): the keyboard of Menu, Tabs, Toolbar and Drawer, the Table's aria-sort, the
 * Badge's words, the Avatar's name, the Icon's silence, and axe on each.
 */
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, within } from "../../src/test/render.tsx";
import {
  Avatar,
  Badge,
  Button,
  Drawer,
  EmptyState,
  Icon,
  ICON_NAMES,
  initials,
  MenuButton,
  MenuItem,
  MenuSeparator,
  PageHeader,
  Panel,
  Table,
  TableCell,
  TableHeader,
  Tabs,
  Toolbar,
  type SortDirection,
} from "../../src/ui/index.ts";
import { seriousViolations } from "../auth/helpers.tsx";

describe("Icon", () => {
  it("is decorative, never focusable, on Lucide's 24 px grid with a 2 px stroke", () => {
    const { container } = render(<Icon name="bell" size={16} />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
    expect(svg).toHaveAttribute("stroke-width", "2");
    expect(svg).toHaveAttribute("width", "16");
  });

  it("draws every icon of the set", () => {
    const { container } = render(
      <>
        {ICON_NAMES.map((name) => (
          <Icon key={name} name={name} />
        ))}
      </>,
    );
    const icons = container.querySelectorAll("svg");
    expect(icons).toHaveLength(ICON_NAMES.length);
    for (const svg of icons) expect(svg.childElementCount).toBeGreaterThan(0);
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(50);
  });
});

describe("Badge and Avatar", () => {
  it("says a status in words, with an optional icon", () => {
    render(
      <Badge tone="warning" icon="triangle-alert">
        Overset
      </Badge>,
    );
    const badge = screen.getByText("Overset").parentElement!;
    expect(badge).toHaveClass("pg-badge-chip", "pg-badge-chip--warning");
    expect(badge.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("draws initials and is named by the person's name", () => {
    render(<Avatar name="Asha Patil" />);
    expect(screen.getByRole("img", { name: "Asha Patil" })).toHaveTextContent("AP");
    expect(screen.getByRole("img", { name: "Asha Patil" })).toHaveAttribute("title", "Asha Patil");
    expect(initials("स्मिता जोशी")).toBe("सज");
    expect(initials("  ")).toBe("?");
  });

  it("is hidden when decorative", () => {
    const { container } = render(<Avatar name="Asha Patil" decorative />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });
});

function RowMenu({ onEdit = () => {}, onDelete = () => {} }: { onEdit?: () => void; onDelete?: () => void }) {
  return (
    <>
      <MenuButton label="Story actions" icon="ellipsis" iconOnly>
        <MenuItem icon="pencil" onSelect={onEdit}>
          Edit
        </MenuItem>
        <MenuItem icon="copy" onSelect={() => {}} disabled>
          Copy
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon="trash-2" danger onSelect={onDelete}>
          Delete
        </MenuItem>
      </MenuButton>
      <button type="button">Elsewhere</button>
    </>
  );
}

describe("Menu", () => {
  it("opens on Enter at the first item, moves with arrows past disabled items, and Esc returns focus", async () => {
    const user = userEvent.setup();
    render(<RowMenu />);
    const button = screen.getByRole("button", { name: "Story actions" });
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).toHaveAttribute("aria-expanded", "false");
    button.focus();
    await user.keyboard("{Enter}");
    const menu = screen.getByRole("menu", { name: "Story actions" });
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("aria-controls", menu.id);
    expect(within(menu).getByRole("menuitem", { name: "Edit" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(within(menu).getByRole("menuitem", { name: "Delete" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(within(menu).getByRole("menuitem", { name: "Edit" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(within(menu).getByRole("menuitem", { name: "Delete" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(within(menu).getByRole("menuitem", { name: "Edit" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("opens on Space, on ↓ at the first item and on ↑ at the last", async () => {
    const user = userEvent.setup();
    render(<RowMenu />);
    const button = screen.getByRole("button", { name: "Story actions" });
    button.focus();
    await user.keyboard(" ");
    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();
    await user.keyboard("{Escape}");
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
    await user.keyboard("{Escape}");
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();
  });

  it("runs an item, closes, and returns focus; a disabled item does nothing", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(<RowMenu onDelete={onDelete} />);
    const button = screen.getByRole("button", { name: "Story actions" });
    await user.click(button);
    await user.click(screen.getByRole("menuitem", { name: "Copy" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Copy" })).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("closes on a click outside and on Tab", async () => {
    const user = userEvent.setup();
    render(<RowMenu />);
    await user.click(screen.getByRole("button", { name: "Story actions" }));
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Story actions" }));
    await user.tab();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("has no serious axe violation, open", async () => {
    const user = userEvent.setup();
    const { container } = render(<RowMenu />);
    await user.click(screen.getByRole("button", { name: "Story actions" }));
    expect(await seriousViolations(container)).toEqual([]);
  });
});

const TABS = [
  { id: "content", label: "Content", panel: <p>Content panel</p> },
  { id: "generate", label: "Generate", panel: <p>Generate panel</p> },
  { id: "export", label: "Export", panel: <p>Export panel</p> },
];

describe("Tabs", () => {
  it("has one tab in the Tab order, and arrows, Home and End select", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Tabs label="Edition" tabs={TABS} onSelect={onSelect} />);
    const list = screen.getByRole("tablist", { name: "Edition" });
    const [content, generate, exportTab] = within(list).getAllByRole("tab");
    expect(content).toHaveAttribute("aria-selected", "true");
    expect(content).toHaveAttribute("tabindex", "0");
    expect(generate).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("tabpanel", { name: "Content" })).toHaveTextContent("Content panel");

    await user.tab();
    expect(content).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(generate).toHaveFocus();
    expect(generate).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Generate" })).toHaveTextContent("Generate panel");
    expect(onSelect).toHaveBeenLastCalledWith("generate");
    await user.keyboard("{End}");
    expect(exportTab).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(content).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(exportTab).toHaveFocus();
    await user.keyboard("{Home}");
    expect(content).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("tabpanel", { name: "Content" })).toHaveFocus();
  });

  it("mirrors the arrows right-to-left", async () => {
    const user = userEvent.setup();
    render(
      <div dir="rtl">
        <Tabs label="Edition" tabs={TABS} />
      </div>,
    );
    await user.tab();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Generate" })).toHaveFocus();
  });

  it("follows a controlled selection, and has no serious axe violation", async () => {
    const { container } = render(<Tabs label="Edition" tabs={TABS} selectedId="export" />);
    expect(screen.getByRole("tab", { name: "Export" })).toHaveAttribute("aria-selected", "true");
    expect(await seriousViolations(container)).toEqual([]);
  });
});

describe("Toolbar", () => {
  it("is one Tab stop, and arrows, Home and End move between its controls", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Toolbar label="Story list">
          <Button variant="secondary">Filter</Button>
          <Button variant="secondary">Sort</Button>
          <Button variant="secondary">Export</Button>
        </Toolbar>
        <button type="button">After</button>
      </>,
    );
    const bar = screen.getByRole("toolbar", { name: "Story list" });
    await user.tab();
    expect(within(bar).getByRole("button", { name: "Filter" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(within(bar).getByRole("button", { name: "Sort" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(within(bar).getByRole("button", { name: "Export" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(within(bar).getByRole("button", { name: "Filter" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(within(bar).getByRole("button", { name: "Export" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "After" })).toHaveFocus();
    // back in: the control used last
    await user.tab({ shift: true });
    expect(within(bar).getByRole("button", { name: "Export" })).toHaveFocus();
  });
});

function SortableTable() {
  const [sort, setSort] = useState<{ key: string; direction: SortDirection }>({ key: "headline", direction: "ascending" });
  const by = (key: string) => (sort.key === key ? sort.direction : null);
  const toggle = (key: string) =>
    setSort((now) => ({ key, direction: now.key === key && now.direction === "ascending" ? "descending" : "ascending" }));
  return (
    <Table caption="Stories">
      <thead>
        <tr>
          <TableHeader sort={by("headline")} onSort={() => toggle("headline")}>
            Headline
          </TableHeader>
          <TableHeader numeric sort={by("words")} onSort={() => toggle("words")}>
            Words
          </TableHeader>
          <TableHeader>Status</TableHeader>
        </tr>
      </thead>
      <tbody>
        <tr className="pg-table__row--selected">
          <TableCell>Rain in Pune</TableCell>
          <TableCell numeric>420</TableCell>
          <TableCell>
            <Badge tone="success">Ready</Badge>
          </TableCell>
        </tr>
      </tbody>
    </Table>
  );
}

describe("Table", () => {
  it("is a semantic table named by its caption, with aria-sort on sortable columns only", async () => {
    const user = userEvent.setup();
    const { container } = render(<SortableTable />);
    const table = screen.getByRole("table", { name: "Stories" });
    const [headline, words, status] = within(table).getAllByRole("columnheader");
    expect(headline).toHaveAttribute("aria-sort", "ascending");
    expect(words).toHaveAttribute("aria-sort", "none");
    expect(status).not.toHaveAttribute("aria-sort");
    await user.click(within(headline!).getByRole("button", { name: "Headline" }));
    expect(headline).toHaveAttribute("aria-sort", "descending");
    await user.click(within(words!).getByRole("button", { name: "Words" }));
    expect(words).toHaveAttribute("aria-sort", "ascending");
    expect(headline).toHaveAttribute("aria-sort", "none");
    expect(within(table).getByRole("cell", { name: "420" })).toHaveClass("pg-table__cell--numeric");
    expect(await seriousViolations(container)).toEqual([]);
  });
});

function DrawerHarness({ modal = true }: { modal?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Preview</Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Story preview"
        closeLabel="Close preview"
        modal={modal}
        footer={<Button>Open story</Button>}
      >
        <a href="#x">Rain in Pune</a>
      </Drawer>
    </>
  );
}

describe("Drawer", () => {
  it("is a dialog named by its heading, takes focus, keeps Tab inside, and Esc returns focus", async () => {
    const user = userEvent.setup();
    render(<DrawerHarness />);
    const opener = screen.getByRole("button", { name: "Preview" });
    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Story preview" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("heading", { name: "Story preview" })).toHaveFocus();
    await user.tab();
    expect(within(dialog).getByRole("button", { name: "Close preview" })).toHaveFocus();
    await user.tab();
    expect(within(dialog).getByRole("link", { name: "Rain in Pune" })).toHaveFocus();
    await user.tab();
    expect(within(dialog).getByRole("button", { name: "Open story" })).toHaveFocus();
    await user.tab();
    expect(within(dialog).getByRole("button", { name: "Close preview" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(within(dialog).getByRole("button", { name: "Open story" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("closes from its close button; non-modal, it is not aria-modal", async () => {
    const user = userEvent.setup();
    const { container } = render(<DrawerHarness modal={false} />);
    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByRole("dialog", { name: "Story preview" })).not.toHaveAttribute("aria-modal");
    expect(await seriousViolations(container)).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Close preview" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("PageHeader, Panel and EmptyState", () => {
  it("give the page its h1 and actions, a named region, and an empty state with one action", async () => {
    const { container } = render(
      <>
        <PageHeader
          title="Stories"
          headingId="route-heading"
          subtitle="Kalpanik Varta"
          actions={<Button>New story</Button>}
        />
        <Panel title="Today's stories" actions={<Button variant="quiet">Refresh</Button>}>
          <EmptyState icon="file-text" heading="No stories yet" action={<Button>New story</Button>}>
            Stories filed for this publication appear here.
          </EmptyState>
        </Panel>
      </>,
    );
    const heading = screen.getByRole("heading", { level: 1, name: "Stories" });
    expect(heading).toHaveAttribute("id", "route-heading");
    expect(heading).toHaveAttribute("tabindex", "-1");
    const region = screen.getByRole("region", { name: "Today's stories" });
    expect(within(region).getByRole("heading", { level: 2, name: "No stories yet" })).toBeInTheDocument();
    expect(within(region).getByText("Stories filed for this publication appear here.")).toBeInTheDocument();
    expect(await seriousViolations(container)).toEqual([]);
  });
});
