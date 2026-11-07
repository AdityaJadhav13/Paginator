/**
 * The audit log, /org/:orgId/audit (plan §3.4, §5.2 as built; 07 §12): only for audit.view (no entry, no screen and no
 * request without it); plain action names in English and Marathi for every action of AUDIT_ACTIONS, and an unknown
 * one by its code; who, when, what about; the address and browser only when the API sends them; filters in the address
 * (reload and Back keep them; unknown ones left out and said so); older events a page at a time; loading, empty and
 * error states; axe. On the test double, fictional data only.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useNavigate } from "react-router";
import { AUDIT_ACTION_NAMES } from "@pageinator/contracts";
import { fireEvent, render, screen, waitFor, within } from "../../src/test/render.tsx";
import { AppRoutes } from "../../src/root/AppRoot.tsx";
import { createMockApplicationEnvironment } from "../../src/mocks/index.ts";
import { TARGET_KEYS, actionName, isDay, targetText } from "../../src/features/people/AuditScreen.tsx";
import { CATALOGUES, LANGUAGE_STORAGE_KEY, translator } from "../../src/i18n/index.ts";
import { currentLocation, renderAuth, resetBrowserState, seriousViolations } from "../auth/helpers.tsx";

// the whole app and axe, as the other screens' tests: 5 s is not enough on a busy machine
vi.setConfig({ testTimeout: 30_000 });

const ORG = "org-demo-sahyadri";
const AUDIT = `/org/${ORG}/audit`;
const DEVANAGARI = /[ऀ-ॿ]/;

afterEach(() => {
  resetBrowserState();
  vi.restoreAllMocks();
});

/** The body rows of a table (its header row left out). */
const bodyRows = (table: HTMLElement) => within(table).getAllByRole("row").filter((row) => row.closest("tbody"));
const events = async () => bodyRows(await screen.findByRole("table", { name: "Events" }));
const itemOf = (text: string) => screen.getByText(text, { selector: "strong" }).closest("tr")!;

describe("Plain action names", () => {
  it("name every action of AUDIT_ACTIONS in English and in Marathi, each its own", () => {
    for (const language of ["en", "mr"] as const) {
      const t = translator(language);
      const names = AUDIT_ACTION_NAMES.map((action) => actionName(action, t));
      for (const [index, action] of AUDIT_ACTION_NAMES.entries()) {
        expect(names[index], `${language} ${action}`).not.toBe(t("auditLog.action.unknown", { action }));
        expect(names[index], `${language} ${action}`).not.toContain(action);
        if (language === "mr") expect(names[index], action).toMatch(DEVANAGARI);
      }
      expect(new Set(names).size, language).toBe(AUDIT_ACTION_NAMES.length);
    }
    expect(AUDIT_ACTION_NAMES).toHaveLength(107);
    expect(CATALOGUES.mr["auditLog.action.story.status_change"]).not.toBe(CATALOGUES.en["auditLog.action.story.status_change"]);
  });

  it("name an upload by its purpose: a Word file's, or a picture's", () => {
    expect(actionName("upload.presign", translator("en"), { purpose: "docx" })).toBe("Started uploading a Word file");
    expect(actionName("upload.presign", translator("mr"), { purpose: "docx" })).toBe("Word फाइलचे अपलोड सुरू केले");
    expect(actionName("upload.presign", translator("en"), { purpose: "story_photo" })).toBe("Started uploading a picture");
  });

  it("show an action this screen does not know by its code", () => {
    expect(actionName("edition.release", translator("en"))).toBe("An action this screen does not name yet (edition.release)");
    expect(actionName("edition.release", translator("mr"))).toBe("या पानाला अजून नाव माहीत नसलेली कृती (edition.release)");
  });
});

/** Every target type the API writes: `targetType: "…"` (or its default, `targetType = "…"`), and the Desk import's
 * `audit(c, action, "<type>", …)` (apps/api/src/db/desk-import.ts). */
function apiTargetTypes(): string[] {
  const root = resolve(__dirname, "../../../api/src");
  const found = new Set<string>();
  for (const file of readdirSync(root, { recursive: true, encoding: "utf8" })) {
    if (!file.endsWith(".ts")) continue;
    const source = readFileSync(resolve(root, file), "utf8");
    for (const m of source.matchAll(/targetType\s*[:=]\s*"([a-z_]+)"/g)) found.add(m[1]!);
    for (const m of source.matchAll(/\baudit\(\s*c,\s*"[a-z_.]+",\s*"([a-z_]+)"/g)) found.add(m[1]!);
  }
  return [...found].sort();
}

describe("What an event is about (doc 11 L2-568)", () => {
  it("names each target type the API writes, and only those, in English and in Marathi", () => {
    const types = apiTargetTypes();
    expect(types).toEqual(expect.arrayContaining(["ad_slot_artwork", "paper_onboarding", "publication", "story"]));
    expect(Object.keys(TARGET_KEYS).sort()).toEqual(types);
    for (const type of types) {
      expect(targetText({ type, id: null }, translator("en")), type).not.toBe(type);
      expect(targetText({ type, id: null }, translator("mr")), type).toMatch(DEVANAGARI);
    }
  });

  it("shows a publication and a paper's design learnt from past editions in Marathi on the screen", async () => {
    const environment = createMockApplicationEnvironment();
    const about = (n: number, action: string, target: { type: string; id: string | null }) => ({
      id: `audit-fictional-${n}`,
      at: "2026-10-22T05:47:00.000Z",
      actor: null,
      action,
      target,
      publicationId: "pub-demo-pune-daily",
      requestId: null,
      data: {},
      ip: null,
      userAgent: null,
    });
    vi.spyOn(environment.audit, "list").mockResolvedValue({
      ok: true,
      value: {
        items: [
          about(1, "publication.settings_edit", { type: "publication", id: "pub-demo-pune-daily" }),
          about(2, "onboarding.ready", { type: "paper_onboarding", id: "onboarding-fictional-1" }),
        ],
        nextCursor: null,
      },
    });
    renderAuth(AUDIT, { preset: "sahyadri-editor", language: "mr", environment });
    const items = bodyRows(await screen.findByRole("table", { name: "नोंदी" }));
    expect(items[0]).toHaveTextContent("प्रकाशन (ओळख pub-demo-pune-daily)");
    expect(items[1]).toHaveTextContent("जुन्या अंकांवरून रचना (ओळख onboarding-fictional-1)");
    expect(items[0]).not.toHaveTextContent("publication");
  });
});

describe("The audit log for an admin", () => {
  it("lists the events newest first, with who, when, what about, and the address and browser", async () => {
    const { container } = renderAuth(AUDIT, { preset: "sahyadri-editor" });
    expect(await screen.findByRole("heading", { level: 1, name: "Audit log" })).toBeInTheDocument();
    const items = await events();
    expect(items).toHaveLength(50);
    expect(items[0]).toHaveTextContent("Saved a story's text");
    expect(items[0]).toHaveTextContent("Sahyadri Demo Sub-editor");
    expect(items[0]).toHaveTextContent("Story (story-demo-003)");
    expect(items[0]).toHaveTextContent("Pune Daily Ledger");
    expect(items[0]).toHaveTextContent("Network address192.0.2.10");
    expect(items[0]).toHaveTextContent("BrowserMozilla/5.0 (Fictional Phone) FictionalBrowser/1.0");
    expect(within(items[0]!).getByText(/2026/, { selector: "time" })).toHaveAttribute("datetime", "2026-10-22T05:47:00.000Z");
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("shows older events a page at a time, an unknown action by its code, and who acted when no one did", async () => {
    renderAuth(AUDIT, { preset: "sahyadri-editor" });
    const user = userEvent.setup();
    await events();
    await user.click(screen.getByRole("button", { name: "Show older events" }));
    await waitFor(async () => expect(await events()).toHaveLength(61));
    expect(screen.queryByRole("button", { name: "Show older events" })).not.toBeInTheDocument();

    expect(itemOf("An action this screen does not name yet (edition.release)")).toHaveTextContent("Edition (edition-demo-2026-10-24)");
    const bootstrap = itemOf("Created the organization");
    expect(bootstrap).toHaveTextContent("Pageinator itself");
    // the API sent no address or browser for it: neither is shown
    expect(within(bootstrap).queryByText("Network address")).not.toBeInTheDocument();
    expect(within(bootstrap).queryByText("Browser")).not.toBeInTheDocument();
    expect(itemOf("Gave a story to someone")).toHaveTextContent("Deccan Evening Record");
    expect(screen.getAllByText("An import").length).toBeGreaterThan(0);
  });

  it("says it is loading while the first page is on its way", async () => {
    const environment = createMockApplicationEnvironment();
    const list = environment.audit.list.bind(environment.audit);
    let release = () => {};
    vi.spyOn(environment.audit, "list").mockImplementation(async (input) => {
      await new Promise<void>((resolve) => (release = resolve));
      return list(input);
    });
    renderAuth(AUDIT, { preset: "sahyadri-editor", environment });
    expect(await screen.findByText("Loading the audit log…")).toBeInTheDocument();
    release();
    expect(await events()).toHaveLength(50);
    expect(screen.queryByText("Loading the audit log…")).not.toBeInTheDocument();
  });

  it("shows no address or browser when the API leaves them out (a chief editor's view)", async () => {
    const environment = createMockApplicationEnvironment();
    const list = environment.audit.list.bind(environment.audit);
    vi.spyOn(environment.audit, "list").mockImplementation(async (input) => {
      const result = await list(input);
      return result.ok
        ? { ok: true, value: { ...result.value, items: result.value.items.map((item) => ({ ...item, ip: null, userAgent: null })) } }
        : result;
    });
    renderAuth(AUDIT, { preset: "sahyadri-editor", environment });
    await events();
    expect(screen.queryByText("Network address")).not.toBeInTheDocument();
    expect(screen.queryByText("Browser")).not.toBeInTheDocument();
  });
});

describe("Filters in the address", () => {
  it("are read from the address on load (a reload keeps them), and sent to the API in India's days", async () => {
    const environment = createMockApplicationEnvironment();
    const list = vi.spyOn(environment.audit, "list");
    renderAuth(`${AUDIT}?action=story.create&publication=pub-demo-pune-daily&from=2026-10-21&to=2026-10-21`, {
      preset: "sahyadri-editor",
      environment,
    });
    const items = await events();
    expect(items).toHaveLength(2);
    expect(list).toHaveBeenCalledWith({
      orgId: ORG,
      action: "story.create",
      publication: "pub-demo-pune-daily",
      from: "2026-10-21T00:00:00+05:30",
      to: "2026-10-22T00:00:00+05:30",
      limit: 50,
    });
    expect(screen.getByLabelText("Action")).toHaveValue("story.create");
    expect(screen.getByLabelText("Publication")).toHaveValue("pub-demo-pune-daily");
    expect(screen.getByLabelText("From (day)")).toHaveValue("2026-10-21");
    expect(screen.getByLabelText("To (day, included)")).toHaveValue("2026-10-21");
  });

  it("go into the address when applied, and Back brings the earlier ones back", async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, "en");
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setPreset("sahyadri-editor");
    function Back() {
      const navigate = useNavigate();
      return <button onClick={() => void navigate(-1)}>Go back</button>;
    }
    render(
      <MemoryRouter useTransitions={false} initialEntries={[`${AUDIT}?action=story.revise`]}>
        <AppRoutes environment={environment} />
        <Back />
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    expect(await events()).toHaveLength(48);
    await user.selectOptions(screen.getByLabelText("Action"), "Moved a story to another status");
    await user.click(screen.getByRole("button", { name: "Show" }));
    await waitFor(async () => expect(await events()).toHaveLength(1));
    expect(itemOf("Moved a story to another status")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Go back" }));
    await waitFor(async () => expect(await events()).toHaveLength(48));
    expect(screen.getByLabelText("Action")).toHaveValue("story.revise");

    await user.click(screen.getByRole("button", { name: "Clear the filters" }));
    await waitFor(async () => expect(await events()).toHaveLength(50));
    expect(screen.getByLabelText("Action")).toHaveValue("");
  });

  it("puts the chosen ones in the address", async () => {
    const { container } = renderAuth(AUDIT, { preset: "sahyadri-editor" });
    const user = userEvent.setup();
    await events();
    await user.selectOptions(screen.getByLabelText("Publication"), "Deccan Evening Record");
    fireEvent.change(screen.getByLabelText("From (day)"), { target: { value: "2026-10-21" } });
    await user.click(screen.getByRole("button", { name: "Show" }));
    await waitFor(() => expect(currentLocation(container).search).toBe("?publication=pub-demo-urdu-evening&from=2026-10-21"));
    expect(await events()).toHaveLength(1);
  });

  it("leave out an unknown action or a day that is not one, say so, and never send them", async () => {
    const environment = createMockApplicationEnvironment();
    const list = vi.spyOn(environment.audit, "list");
    renderAuth(`${AUDIT}?action=story.explode&from=yesterday&to=2026-02-30`, { preset: "sahyadri-editor", environment });
    expect(await screen.findByText("Some filters in this address are not ones Pageinator knows, so they are left out.")).toBeInTheDocument();
    expect(await events()).toHaveLength(50);
    expect(list).toHaveBeenCalledWith({ orgId: ORG, limit: 50 });
  });

  it("leave out a last day whose next day is not a four-digit year (9999-12-31), and never send it", async () => {
    expect([isDay("9999-12-30"), isDay("9999-12-31"), isDay("1000-01-01")]).toEqual([true, false, true]);
    const environment = createMockApplicationEnvironment();
    const list = vi.spyOn(environment.audit, "list");
    renderAuth(`${AUDIT}?to=9999-12-31`, { preset: "sahyadri-editor", environment });
    expect(await screen.findByText("Some filters in this address are not ones Pageinator knows, so they are left out.")).toBeInTheDocument();
    expect(await events()).toHaveLength(50);
    expect(list).toHaveBeenCalledWith({ orgId: ORG, limit: 50 });
    expect(screen.queryByText("Some fields are not right.")).not.toBeInTheDocument();
  });

  for (const day of ["9999-12-31", "12026-10-21"]) {
    it(`say a day that cannot be asked for (${day}) at its field, and apply nothing`, async () => {
      const environment = createMockApplicationEnvironment();
      const list = vi.spyOn(environment.audit, "list");
      const { container } = renderAuth(AUDIT, { preset: "sahyadri-editor", environment });
      const user = userEvent.setup();
      await events();
      const to = screen.getByLabelText("To (day, included)");
      // jsdom drops a value its day picker cannot hold; Chrome's holds a five-digit year
      Object.defineProperty(to, "value", { configurable: true, get: () => day, set: () => {} });
      fireEvent.change(to);
      await user.click(screen.getByRole("button", { name: "Show" }));
      const error = await screen.findByText("Pick a day from the year 1000 to 9999 (for example 2026-10-21).");
      expect(to).toHaveAttribute("aria-invalid", "true");
      expect(to.getAttribute("aria-describedby")).toContain(error.id);
      expect(screen.getByLabelText("From (day)")).not.toHaveAttribute("aria-invalid");
      expect(currentLocation(container).search).toBe("");
      expect(list).toHaveBeenCalledTimes(1);
      expect(await seriousViolations(container)).toEqual([]);
    });
  }

  it("say when nothing matches", async () => {
    renderAuth(`${AUDIT}?action=member.remove`, { preset: "sahyadri-editor" });
    expect(await screen.findByText("No event matches these filters.")).toBeInTheDocument();
  });
});

describe("The API's refusals and failures", () => {
  it("refuses an action not of the catalogue (400), as the API does", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setPreset("sahyadri-editor");
    const result = await environment.audit.list({ orgId: ORG, action: "story.explode" });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "answer") expect([result.error.status, result.error.code]).toEqual([400, "invalid_request"]);
    expect((await environment.audit.list({ orgId: ORG, action: "invitation." })).ok).toBe(true); // a prefix ending in "."
  });

  it("refuses a publication that is not an id (400), as the API does", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setPreset("sahyadri-editor");
    const refused = await environment.audit.list({ orgId: ORG, publication: "not-a-publication" });
    expect(refused.ok).toBe(false);
    if (!refused.ok && refused.error.kind === "answer") expect([refused.error.status, refused.error.code]).toEqual([400, "invalid_request"]);
    expect((await environment.audit.list({ orgId: ORG, publication: "a1b2c3d4-0000-4000-8000-000000000009" })).ok).toBe(true);
    expect((await environment.audit.list({ orgId: ORG, publication: "pub-demo-pune-daily" })).ok).toBe(true);
  });

  it("says when the log cannot be fetched, and tries again", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setProblem({ kind: "network" }, ["audit.list"]);
    renderAuth(AUDIT, { preset: "sahyadri-editor", environment });
    const user = userEvent.setup();
    expect(await screen.findByText("Pageinator cannot be reached")).toBeInTheDocument();
    environment.sessionController.setProblem(null, ["audit.list"]);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await events()).toHaveLength(50);
  });
});

describe("The audit log for a chief editor", () => {
  it("names one search landmark for the filters", async () => {
    renderAuth(AUDIT, { preset: "sahyadri-editor" });
    await events();
    expect(screen.getAllByRole("search")).toHaveLength(1);
    expect(screen.queryByRole("region", { name: "Filters" })).not.toBeInTheDocument();
  });

  it("shows only their publications' events, says so, and offers only those actions and publications", async () => {
    const environment = createMockApplicationEnvironment();
    const list = vi.spyOn(environment.audit, "list");
    const { container } = renderAuth(AUDIT, { preset: "sahyadri-chief-editor", environment });
    expect(await screen.findByText("You see the events of the publications you are chief editor of.")).toBeInTheDocument();
    const items = await events();
    expect(items).toHaveLength(50);
    expect(list).toHaveBeenCalledWith({ orgId: ORG, limit: 50 });
    await userEvent.setup().click(screen.getByRole("button", { name: "Show older events" }));
    await waitFor(async () => expect(await events()).toHaveLength(55));
    // org-level events and the other publication's are not theirs
    expect(screen.queryByText("Created the organization", { selector: "strong" })).not.toBeInTheDocument();
    expect(screen.queryByText("Gave a story to someone", { selector: "strong" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("table", { name: "Events" })).queryByText("Deccan Evening Record")).not.toBeInTheDocument();
    expect(screen.queryByText("Network address")).not.toBeInTheDocument();
    expect(screen.queryByText("Browser")).not.toBeInTheDocument();
    // the actions offered are the publication ones only; one publication of theirs, so none to choose
    const offered = within(screen.getByLabelText("Action")).getAllByRole("option").map((option) => option.getAttribute("value"));
    expect(offered).toContain("story.create");
    expect(offered).not.toContain("org.bootstrap");
    expect(offered).not.toContain("member.update");
    expect(screen.queryByLabelText("Publication")).not.toBeInTheDocument();
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("leaves out an organisation action or another publication in the address, and says so", async () => {
    const environment = createMockApplicationEnvironment();
    const list = vi.spyOn(environment.audit, "list");
    renderAuth(`${AUDIT}?action=member.update&publication=pub-demo-urdu-evening`, { preset: "sahyadri-chief-editor", environment });
    expect(await screen.findByText("Some filters in this address are not ones Pageinator knows, so they are left out.")).toBeInTheDocument();
    await events();
    expect(list).toHaveBeenCalledWith({ orgId: ORG, limit: 50 });
  });
});

describe("Who may see the audit log", () => {
  it("is offered to the owner and admins in the navigation and on the organisation's home", async () => {
    renderAuth(`/org/${ORG}`, { preset: "sahyadri-editor" });
    await screen.findByRole("heading", { level: 1, name: "Sahyadri Media Cooperative" });
    const nav = screen.getByRole("navigation", { name: "Organization" });
    expect(within(nav).getByRole("link", { name: "Audit log" })).toHaveAttribute("href", AUDIT);
  });

  for (const preset of ["sahyadri-reporter", "sahyadri-subeditor", "sahyadri-photo-editor"] as const) {
    it(`is neither offered nor shown to a person without audit.view (${preset}), and nothing is asked of the API`, async () => {
      const environment = createMockApplicationEnvironment();
      const list = vi.spyOn(environment.audit, "list");
      renderAuth(AUDIT, { preset, environment });
      expect(await screen.findByText("You cannot see the audit log")).toBeInTheDocument();
      expect(screen.getByText("Only the owner, admins and chief editors see the audit log.")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Audit log" })).not.toBeInTheDocument();
      expect(list).not.toHaveBeenCalled();
      // the API refuses them too
      environment.sessionController.setPreset(preset);
      const refused = await environment.audit.list({ orgId: ORG });
      expect(refused.ok).toBe(false);
      if (!refused.ok && refused.error.kind === "answer") expect(refused.error.status).toBe(403);
    });
  }
});

describe("The audit log in Marathi", () => {
  it("names the actions and the facts in Marathi, and has no serious axe violations", async () => {
    const { container } = renderAuth(AUDIT, { preset: "sahyadri-editor", language: "mr" });
    expect(await screen.findByRole("heading", { level: 1, name: "कामकाजाची नोंद" })).toBeInTheDocument();
    const items = bodyRows(await screen.findByRole("table", { name: "नोंदी" }));
    expect(items[0]).toHaveTextContent("बातमीचा मजकूर जतन केला");
    expect(screen.getByRole("columnheader", { name: "कोणी" })).toBeInTheDocument();
    expect(items[0]).toHaveTextContent("बातमी (ओळख story-demo-003)");
    expect(screen.getByRole("button", { name: "जुन्या नोंदी दाखवा" })).toBeInTheDocument();
    expect(await seriousViolations(container)).toEqual([]);
  });
});
