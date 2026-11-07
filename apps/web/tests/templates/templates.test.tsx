/**
 * The Templates screen (doc 04 §7.8; packages/contracts templates.ts) on the test double with fictional data: the
 * template in use per role drawn as the page's outline (never called the printed page), the dataset's pages to choose
 * from, a choice making a new profile version that the engine sets up (heard live), a refusal while one is setting up,
 * the history, who may choose, the dataset checked again, Marathi, and axe.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, act, screen, within } from "../../src/test/render.tsx";
import { createMockApplicationEnvironment } from "../../src/mocks/index.ts";
import { TemplateOutline } from "../../src/features/templates/TemplateOutline.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { renderAuth, resetBrowserState, seriousViolations } from "../auth/helpers.tsx";

vi.setConfig({ testTimeout: 30_000 });

const ORG = "org-demo-sahyadri";
const PUB = "pub-demo-pune-daily";
const TEMPLATES = `/org/${ORG}/pub/${PUB}/templates`;

afterEach(() => {
  resetBrowserState();
  vi.restoreAllMocks();
});

describe("Templates", () => {
  it("shows each role's template as the engine reads it, the pages to choose from, the grid and the versions", async () => {
    const { container } = renderAuth(TEMPLATES, { preset: "sahyadri-editor" });
    expect(await screen.findByRole("heading", { level: 1, name: "Templates" })).toBeInTheDocument();
    const front = within(await screen.findByRole("region", { name: "Front page" }));
    // the template in use, large, and among the pages to choose from
    expect(front.getAllByRole("img", { name: "Outline of front-2026-10-20 as the engine reads it" })).toHaveLength(2);
    expect(front.getByText("The page's outline as the engine reads it, not the printed page.")).toBeInTheDocument();
    expect(front.getByText("Pages of your dataset that can serve here: 3")).toBeInTheDocument();
    expect(front.getByText("In use")).toBeInTheDocument();
    for (const name of ["Page 2 (with the imprint)", "Inside pages", "Back page (with ads)"])
      expect(screen.getByRole("region", { name })).toBeInTheDocument();
    // the template in use offers no button; the other two each do (an organisation admin may edit templates)
    expect(front.getAllByRole("button", { name: "Use this as the front page template" })).toHaveLength(2);
    expect(screen.getByText("8 columns of 38.5 mm, gutter 4.2 mm")).toBeInTheDocument();
    expect(screen.getByText(/Editions already laid out keep the profile version their layout run used\./)).toBeInTheDocument();
    const history = within(screen.getByRole("table", { name: "Profile versions" }));
    expect(history.getAllByRole("row")).toHaveLength(3);
    expect(container.textContent).not.toMatch(/press-ready|PDF\/X-valid/i);
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("makes a new version with the chosen page, waits for the engine, then shows it in use", async () => {
    const { environment, container } = renderAuth(TEMPLATES, { preset: "sahyadri-chief-editor" });
    const user = userEvent.setup();
    const back = within(await screen.findByRole("region", { name: "Back page (with ads)" }));
    const choose = vi.spyOn(environment.layout, "chooseTemplate");
    await user.click(back.getAllByRole("button", { name: "Use this as the back page template" })[0]!);
    expect(choose).toHaveBeenCalledWith(
      expect.objectContaining({ choice: { role: "back", page: "back-2026-10-13" } }),
    );
    expect(await back.findByText("Version 3 is made. The engine is setting it up.")).toBeInTheDocument();
    expect(await screen.findByText("Version 3 is being set up by the engine")).toBeInTheDocument();
    // one at a time: every choice waits for the engine
    for (const button of screen.getAllByRole("button", { name: /Use this as the/ })) expect(button).toBeDisabled();
    const history = within(screen.getByRole("table", { name: "Profile versions" }));
    expect(history.getByText("Version 2")).toBeInTheDocument();
    expect(history.getByText("Back page (with ads): back-2026-10-13")).toBeInTheDocument();
    expect(await seriousViolations(container)).toEqual([]);
    act(() => environment.sessionController.layout.setUp("profile-new-001"));
    expect(await screen.findByText(/Profile version 3 is in use\./)).toBeInTheDocument();
    const after = within(screen.getByRole("region", { name: "Back page (with ads)" }));
    expect(after.getAllByRole("img", { name: "Outline of back-2026-10-13 as the engine reads it" })).toHaveLength(2);
    expect(after.getAllByText("In use")).toHaveLength(1);
    expect(screen.queryByText("Version 3 is being set up by the engine")).not.toBeInTheDocument();
  });

  it("keeps the old version in use when the engine refuses the choice, in its words", async () => {
    const { environment } = renderAuth(TEMPLATES, { preset: "sahyadri-chief-editor" });
    const user = userEvent.setup();
    const front = within(await screen.findByRole("region", { name: "Front page" }));
    await user.click(front.getAllByRole("button", { name: "Use this as the front page template" })[0]!);
    await screen.findByText("Version 3 is being set up by the engine");
    act(() =>
      environment.sessionController.layout.setUp("profile-new-001", {
        code: "profile.setup",
        message: { text: "the page front-2026-10-13 cannot serve as the front template", code: null, params: null },
      }),
    );
    expect(await screen.findByText("Version 3 could not be set up")).toBeInTheDocument();
    expect(screen.getByText("the page front-2026-10-13 cannot serve as the front template")).toBeInTheDocument();
    expect(screen.getByText(/Version 2 stays in use\./)).toBeInTheDocument();
  });

  it("says plainly why a choice was refused", async () => {
    const { environment } = renderAuth(TEMPLATES, { preset: "sahyadri-chief-editor" });
    const user = userEvent.setup();
    const inside = within(await screen.findByRole("region", { name: "Inside pages" }));
    vi.spyOn(environment.layout, "chooseTemplate").mockResolvedValue({
      ok: false,
      error: { kind: "answer", status: 409, code: "profile_setting_up", message: "", requestId: "r" },
    });
    await user.click(inside.getAllByRole("button", { name: "Use this as the inside page template" })[0]!);
    expect(
      await inside.findByText(
        "An engine profile is being set up now. Wait until it is ready or has failed, then choose again.",
      ),
    ).toBeInTheDocument();
  });

  it("offers to check the dataset again when the profile recorded no pages to choose from", async () => {
    const environment = createMockApplicationEnvironment();
    const real = environment.layout.getTemplates.bind(environment.layout);
    vi.spyOn(environment.layout, "getTemplates").mockImplementation(async (input) => {
      const got = await real(input);
      if (!got.ok || got.value.settingUp) return got;
      return {
        ok: true,
        value: { ...got.value, candidatesKnown: false, roles: got.value.roles.map((r) => ({ ...r, candidates: [] })) },
      };
    });
    const choose = vi.spyOn(environment.layout, "chooseTemplate");
    renderAuth(TEMPLATES, { preset: "sahyadri-chief-editor", environment });
    const user = userEvent.setup();
    expect(
      await screen.findByText("The pages that can serve each template are not recorded for this profile"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("No page of the dataset can serve here.")).toHaveLength(4);
    await user.click(screen.getByRole("button", { name: "Check the dataset again" }));
    expect(choose).toHaveBeenCalledWith(expect.objectContaining({ choice: {} }));
    expect(await screen.findByText("Version 3 is being set up by the engine")).toBeInTheDocument();
  });

  it("is not shown to a role without templates.view", async () => {
    renderAuth(TEMPLATES, { preset: "sahyadri-reporter" });
    expect(await screen.findByRole("heading", { level: 1, name: "Templates" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Front page" })).not.toBeInTheDocument();
  });

  it("reads in Marathi", async () => {
    renderAuth(TEMPLATES, { preset: "sahyadri-chief-editor", language: "mr" });
    expect(await screen.findByRole("region", { name: "पहिले पान" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "हे पहिले पान साचा म्हणून वापरा" }).length).toBe(2);
  });
});

describe("TemplateOutline", () => {
  it("draws the page, its news area, kept parts and ad slots, and describes them", () => {
    render(
      <I18nProvider>
        <TemplateOutline
          name="fictional-p4"
          outline={{
            pageWMm: 330,
            pageHMm: 520,
            news: [[12, 28, 318, 330]],
            kept: [{ kind: "furniture", box: [12, 10, 318, 20] }],
            adSlots: [
              [12, 340, 318, 510],
              [12, 335, 170, 338],
            ],
          }}
        />
      </I18nProvider>,
    );
    const svg = screen.getByRole("img", { name: "Outline of fictional-p4 as the engine reads it" });
    expect(svg).toHaveAttribute("viewBox", "0 0 330 520");
    expect(svg).toHaveAccessibleDescription(
      "The page's outline as the engine reads it, not the printed page: the news area, 1 parts the paper prints every day, and 2 ad slots.",
    );
    expect(svg.querySelectorAll(".pg-template-outline__ad")).toHaveLength(2);
    expect(svg.querySelector(".pg-template-outline__news")).toHaveAttribute("height", "302");
  });
});
