/**
 * Stories, /org/:orgId/pub/:pubId/stories (plan §10 PR 21): the desk's table, the phone's list, status chips and word
 * counts, filters kept in the address, the API's cursor pages, paste with what was added and what was skipped, the
 * role rules (desk, Reporter, Photo Editor), the loading, error and offline states, Marathi and axe. On the test
 * double; fictional data only.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, screen, waitFor, within } from "../../src/test/render.tsx";
import { createMockApplicationEnvironment } from "../../src/mocks/index.ts";
import { currentLocation, renderAuth, resetBrowserState, seriousViolations } from "../auth/helpers.tsx";

const STORIES = "/org/org-demo-sahyadri/pub/pub-demo-pune-daily/stories";
const original = window.matchMedia;

afterEach(() => {
  resetBrowserState();
  window.matchMedia = original;
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
});

function phone() {
  window.matchMedia = (query: string) =>
    ({ matches: query.includes("767px"), media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList;
}

const rows = () => screen.getAllByRole("row").slice(1);

describe("Stories for the desk", () => {
  it("shows the content-desk table with status, words, reporter, given to and edition", async () => {
    renderAuth(STORIES, { preset: "sahyadri-editor" });
    expect(await screen.findByRole("heading", { level: 1, name: "Stories" })).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: "Stories of Pune Daily Ledger" });
    expect(within(table).getAllByRole("row")).toHaveLength(6);
    const ring = within(table).getByRole("rowheader", { name: "Ring road work to resume next week" }).closest("tr")!;
    // the status is a badge: its icon and its word (never colour alone)
    const chip = within(ring).getByText("Editing").closest(".pg-chip");
    expect(chip).toHaveClass("pg-badge-chip");
    expect(chip?.querySelector("svg.pg-icon")).not.toBeNull();
    expect(within(ring).getByText("Sahyadri Demo Sub-editor")).toBeInTheDocument();
    expect(within(ring).getByText("23 October 2026")).toBeInTheDocument();
    expect(within(table).getByRole("link", { name: "घाटात मान्सून लवकर दाखल" })).toHaveAttribute("lang", "mr");
    expect(screen.getByRole("link", { name: "New story" })).toHaveAttribute("href", `${STORIES}/new`);
    expect(screen.getByRole("button", { name: "Paste stories" })).toBeInTheDocument();
  });

  it("filters by status, edition, reporter, given to me and search, and keeps the filters in the address", async () => {
    const { container } = renderAuth(STORIES, { preset: "sahyadri-editor" });
    const user = userEvent.setup();
    await screen.findByRole("table");
    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "ready");
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(screen.getByRole("rowheader", { name: "गुरुवारी पाणीपुरवठा बंद" })).toBeInTheDocument();
    expect(currentLocation(container).search).toBe("?status=ready");

    await user.click(screen.getByRole("button", { name: "Clear the filters" }));
    await waitFor(() => expect(rows()).toHaveLength(5));
    await user.selectOptions(screen.getByRole("combobox", { name: "Edition" }), "edition-demo-2026-10-23");
    await waitFor(() => expect(rows()).toHaveLength(2));
    await user.selectOptions(screen.getByRole("combobox", { name: "Edition" }), "");
    await user.selectOptions(screen.getByRole("combobox", { name: "Reporter" }), "user-demo-sahyadri-reporter");
    await waitFor(() => expect(rows()).toHaveLength(2));
    await user.click(screen.getByRole("button", { name: "Clear the filters" }));

    await user.type(screen.getByRole("searchbox", { name: "Search headlines and text" }), "ring road");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(currentLocation(container).search).toBe("?q=ring+road");

    await user.click(screen.getByRole("button", { name: "Clear the filters" }));
    await user.click(screen.getByRole("checkbox", { name: "Only the stories given to me" }));
    expect(await screen.findByText("No story matches these filters.")).toBeInTheDocument();
    // the empty state offers the one way out: clearing the filters
    expect(screen.getByRole("heading", { name: "Nothing found" })).toBeInTheDocument();
    const clears = screen.getAllByRole("button", { name: "Clear the filters" });
    expect(clears).toHaveLength(2);
    await user.click(clears[1]!);
    await waitFor(() => expect(rows()).toHaveLength(5));
    expect(currentLocation(container).search).toBe("");
  });

  it("pages with the API's cursor", async () => {
    const environment = createMockApplicationEnvironment();
    const text = Array.from({ length: 50 }, (_, index) => `Fictional item ${index + 1}\nSome fictional text.`).join("\n---\n");
    await environment.stories.paste({ orgId: "org-demo-sahyadri", pubId: "pub-demo-pune-daily", text, idempotencyKey: "seed" });
    renderAuth(STORIES, { preset: "sahyadri-editor", environment });
    await screen.findByRole("table");
    expect(rows()).toHaveLength(50);
    await userEvent.setup().click(screen.getByRole("button", { name: "Show more stories" }));
    await waitFor(() => expect(rows()).toHaveLength(55));
    expect(screen.queryByRole("button", { name: "Show more stories" })).not.toBeInTheDocument();
  });

  it("pastes several stories, says what was added and what was skipped, with one key per paste", async () => {
    const environment = createMockApplicationEnvironment();
    const paste = vi.spyOn(environment.stories, "paste");
    renderAuth(STORIES, { preset: "sahyadri-editor", environment });
    const user = userEvent.setup();
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Paste stories" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Paste stories" }));
    await user.click(dialog.getByRole("button", { name: "Add the stories" }));
    expect(dialog.getByLabelText("The stories")).toHaveAccessibleDescription(/Paste at least one story\./);

    await user.type(
      dialog.getByLabelText("The stories"),
      "Fictional fair opens{enter}Byline: Fictional Reporter{enter}The fair opens on Friday.{enter}---{enter}A headline alone{enter}---{enter}Fictional bus route{enter}A new route starts.",
    );
    environment.sessionController.setProblem({ kind: "network" }, ["stories.paste"]);
    await user.click(dialog.getByRole("button", { name: "Add the stories" }));
    expect(await dialog.findByText("Pageinator cannot be reached")).toBeInTheDocument();
    environment.sessionController.setProblem(null, ["stories.paste"]);
    // no answer came: the text is held as it was sent, and the retry sends the same
    expect(dialog.getByLabelText("The stories")).toHaveAttribute("readonly");
    // closing the dialog keeps it, and the pending paste
    await user.click(dialog.getByRole("button", { name: "Close dialog" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Paste stories" }));
    expect(within(await screen.findByRole("dialog")).getByLabelText("The stories")).toHaveValue(
      "Fictional fair opens\nByline: Fictional Reporter\nThe fair opens on Friday.\n---\nA headline alone\n---\nFictional bus route\nA new route starts.",
    );
    await user.click(dialog.getByRole("button", { name: "Try again" }));

    expect(await dialog.findByText("Stories added: 2")).toBeInTheDocument();
    expect(dialog.getByText("Not added: 1")).toBeInTheDocument();
    expect(dialog.getByText("Every article needs some text.")).toHaveAttribute("lang", "en");
    expect(dialog.getByRole("link", { name: "Fictional fair opens" })).toBeInTheDocument();
    // the retry sent the same key: the stories were not added twice
    expect(paste.mock.calls.map(([input]) => input.idempotencyKey)).toEqual([
      paste.mock.calls[0]![0].idempotencyKey,
      paste.mock.calls[0]![0].idempotencyKey,
    ]);
    await waitFor(() => expect(rows()).toHaveLength(7));
  });

  it("shows a failure with Retry, and the offline notice", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setProblem(
      { kind: "answer", status: 500, code: "server_error", message: "", requestId: "req-7" },
      ["stories.list"],
    );
    renderAuth(STORIES, { preset: "sahyadri-editor", environment });
    expect(await screen.findByText("Something went wrong on our side")).toBeInTheDocument();
    environment.sessionController.setProblem(null, ["stories.list"]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(await screen.findByText("You are offline")).toBeInTheDocument();
  });
});

describe("Stories for other roles", () => {
  it("shows a Reporter their own stories as a list on a phone, and lets them start one", async () => {
    phone();
    renderAuth(STORIES, { preset: "sahyadri-reporter" });
    const list = await screen.findByRole("list", { name: "Stories of Pune Daily Ledger" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("You see the stories you report and the ones given to you.")).toBeInTheDocument();
    expect(within(list).getByText("Filed")).toBeInTheDocument();
    expect(within(list).getAllByText(/words/).length).toBe(2);
    expect(screen.queryByRole("combobox", { name: "Reporter" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New story" })).toBeInTheDocument();
  });

  it("lets a Photo Editor read every story, and change none", async () => {
    renderAuth(STORIES, { preset: "sahyadri-photo-editor" });
    await screen.findByRole("table");
    expect(rows()).toHaveLength(5);
    expect(screen.getByText("You can read these stories. Your role does not change them.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "New story" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Paste stories" })).not.toBeInTheDocument();
  });

  it("is reached from the organisation's home and the publication's navigation", async () => {
    renderAuth("/org/org-demo-sahyadri", { preset: "sahyadri-reporter" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("link", { name: "Stories of Pune Daily Ledger" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Stories" })).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Publication" })).getByRole("link", { name: "Stories" })).toBeInTheDocument();
  });
});

describe("Stories: Marathi and axe", () => {
  it("is in Marathi", async () => {
    renderAuth(STORIES, { preset: "sahyadri-editor", language: "mr" });
    expect(await screen.findByRole("heading", { level: 1, name: "बातम्या" })).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: "Pune Daily Ledger च्या बातम्या" });
    expect(within(table).getByText("डेस्ककडे पाठवली")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "नवीन बातमी" })).toBeInTheDocument();
  });

  it("has no serious axe violations: the table, the phone list and the paste dialog", async () => {
    const view = renderAuth(STORIES, { preset: "sahyadri-editor" });
    await screen.findByRole("table");
    expect(await seriousViolations(view.container)).toEqual([]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Paste stories" }));
    await screen.findByRole("dialog");
    expect(await seriousViolations(view.container)).toEqual([]);
    view.unmount();
    phone();
    const small = renderAuth(STORIES, { preset: "sahyadri-reporter" });
    await screen.findByRole("list", { name: "Stories of Pune Daily Ledger" });
    expect(await seriousViolations(small.container)).toEqual([]);
  });
});
