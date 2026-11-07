/**
 * Brand & masthead, /org/:orgId/pub/:pubId/brand: the masthead as the newest front page printed it (read-only, with the
 * Templates link), the name and edition defaults saved by brand.edit (the chrome shows the new name), read-only for
 * others, "Create edition" filled in from the defaults and the next issue number moving on, Marathi and axe. On the
 * test double; fictional data.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "../../src/test/render.tsx";
import { createMockApplicationEnvironment } from "../../src/mocks/index.ts";
import { renderAuth, resetBrowserState, seriousViolations } from "../auth/helpers.tsx";

vi.setConfig({ testTimeout: 30_000 });

const ORG = "org-demo-sahyadri";
const PUB = "pub-demo-pune-daily";
const BRAND = `/org/${ORG}/pub/${PUB}/brand`;
const EDITIONS = `/org/${ORG}/pub/${PUB}/editions`;

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:fictional");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  resetBrowserState();
  vi.restoreAllMocks();
});

const settings = () => screen.findByRole("region", { name: "Name and edition defaults" });

describe("Brand & masthead", () => {
  it("shows the masthead of the newest laid-out front page, read-only, with the Templates link", async () => {
    const { container } = renderAuth(BRAND, { preset: "sahyadri-chief-editor" });
    expect(await screen.findByRole("heading", { level: 1, name: "Brand" })).toBeInTheDocument();
    const masthead = within(await screen.findByRole("region", { name: "Masthead and folio" }));
    expect(masthead.getByText(/part of the front template page/)).toBeInTheDocument();
    expect(masthead.getByText(/As page 1 of the edition of 24 October 2026 printed it/)).toBeInTheDocument();
    expect(
      await masthead.findByRole("img", { name: "The top of page 1 of the edition of 24 October 2026, with its masthead" }),
    ).toHaveAttribute("src", "blob:fictional");
    expect(masthead.getByRole("link", { name: "Change the front template on the Templates screen" })).toHaveAttribute(
      "href",
      `/org/${ORG}/pub/${PUB}/templates`,
    );
    expect(masthead.queryByRole("textbox")).not.toBeInTheDocument();
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("saves the name and the defaults; the chrome shows the new name; a wrong issue number is refused", async () => {
    const environment = createMockApplicationEnvironment();
    const setBrand = vi.spyOn(environment.editions, "setBrand");
    renderAuth(BRAND, { preset: "sahyadri-chief-editor", environment });
    const user = userEvent.setup();
    const form = within(await settings());
    const name = form.getByRole("textbox", { name: /Display name/ });
    expect(name).toHaveValue("Pune Daily Ledger");
    await user.type(form.getByRole("textbox", { name: /Next issue number/ }), "0");
    await user.click(form.getByRole("button", { name: "Save" }));
    expect(form.getByText("Type a whole number from 1 to 999999, or leave it empty.")).toBeInTheDocument();
    expect(setBrand).not.toHaveBeenCalled();

    await user.clear(name);
    await user.type(name, "Pune Daily Ledger (fictional)");
    await user.type(form.getByRole("textbox", { name: "Volume" }), "12");
    await user.type(form.getByRole("textbox", { name: "Price" }), "5");
    const issue = form.getByRole("textbox", { name: /Next issue number/ });
    await user.clear(issue);
    await user.type(issue, "302");
    await user.click(form.getByRole("button", { name: "Save" }));
    expect(await form.findByText("Saved.")).toBeInTheDocument();
    expect(setBrand.mock.calls[0]![0].input).toEqual({
      name: "Pune Daily Ledger (fictional)",
      defaults: { volume: "12", price: "5", nextIssue: 302 },
    });
    // the page header's subtitle comes from the session's access, reloaded after a rename
    await waitFor(() => expect(screen.getAllByText("Pune Daily Ledger (fictional)").length).toBeGreaterThan(0));
  });

  it("is read-only for someone without brand.edit", async () => {
    renderAuth(BRAND, { preset: "sahyadri-reporter" });
    const panel = within(await settings());
    expect(panel.getByText("Pune Daily Ledger")).toBeInTheDocument();
    expect(panel.getAllByText("Not set")).toHaveLength(3);
    expect(panel.queryByRole("textbox")).not.toBeInTheDocument();
    expect(panel.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("fills in Create edition from the defaults; making it with the next issue moves the number on", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setPreset("sahyadri-chief-editor");
    await environment.editions.setBrand({
      orgId: ORG,
      pubId: PUB,
      input: { defaults: { volume: "12", price: "5", nextIssue: 302 } },
    });
    renderAuth(EDITIONS, { preset: "sahyadri-chief-editor", environment });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Create edition" }));
    const sheet = within(await screen.findByRole("dialog", { name: "Create edition" }));
    await waitFor(() => expect(sheet.getByRole("textbox", { name: "Issue number" })).toHaveValue("302"));
    expect(sheet.getByRole("textbox", { name: "Volume" })).toHaveValue("12");
    expect(sheet.getByRole("textbox", { name: "Price" })).toHaveValue("5");
    expect(sheet.getByText("Volume, issue number and price are filled in from the Brand screen.")).toBeInTheDocument();
    const date = sheet.getByLabelText(/^Date/);
    await user.clear(date);
    await user.type(date, "2026-11-05");
    await user.click(sheet.getByRole("button", { name: "Create edition" }));
    expect(await screen.findByText("The edition of 5 November 2026 is created.")).toBeInTheDocument();
    const brand = await environment.editions.brand({ orgId: ORG, pubId: PUB });
    expect(brand.ok && brand.value.defaults.nextIssue).toBe(303);
  });

  it("speaks Marathi", async () => {
    renderAuth(BRAND, { preset: "sahyadri-chief-editor", language: "mr" });
    expect(await screen.findByRole("region", { name: "मास्टहेड आणि फोलिओ" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "जतन करा" })).toBeInTheDocument();
  });
});
