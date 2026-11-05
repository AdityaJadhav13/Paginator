/**
 * Organization settings (/org/:orgId/settings) and publication settings (/org/:orgId/pub/:pubId/publication-settings):
 * Owner and Admin rename the organisation and add a publication (the chrome then shows both); billing is a plain line;
 * a Chief Editor changes their publication's languages and timezone but cannot open the organisation's settings; a
 * Sub-editor cannot open them, and a Reporter's change is refused; the story editor's Section picker saves the story's section. Marathi
 * and axe. On the test double; fictional data.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "../../src/test/render.tsx";
import { createMockApplicationEnvironment } from "../../src/mocks/index.ts";
import { renderAuth, resetBrowserState, seriousViolations } from "../auth/helpers.tsx";
import { timezones } from "../../src/features/settings/PublicationForm.tsx";

vi.setConfig({ testTimeout: 30_000 });

const ORG = "org-demo-sahyadri";
const PUB = "pub-demo-pune-daily";
const ORG_SETTINGS = `/org/${ORG}/settings`;
const PUB_SETTINGS = `/org/${ORG}/pub/${PUB}/publication-settings`;

afterEach(resetBrowserState);

describe("Organization settings", () => {
  it("lets the Owner rename the organisation, and says billing is invoiced", async () => {
    const { environment } = renderAuth(ORG_SETTINGS, { preset: "sahyadri-owner" });
    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { level: 1, name: "Organization settings" })).toBeInTheDocument();
    const general = within(await screen.findByRole("region", { name: "General" }));
    const name = general.getByLabelText(/Organization name/);
    expect(name).toHaveValue("Sahyadri Media Cooperative");
    await user.clear(name);
    await user.click(general.getByRole("button", { name: "Save" }));
    expect(await general.findByText("Type a name.")).toBeInTheDocument();
    await user.type(name, "Sahyadri Fictional Media");
    await user.click(general.getByRole("button", { name: "Save" }));
    expect(await general.findByText("Saved.")).toBeInTheDocument();
    const saved = await environment.settings.getOrg({ orgId: ORG });
    expect(saved.ok && saved.value.name).toBe("Sahyadri Fictional Media");
    const billing = within(screen.getByRole("region", { name: "Billing" }));
    expect(billing.getByText(/Billing: invoiced by us/)).toBeInTheDocument();
    expect(billing.getByRole("link", { name: "contact us" })).toHaveAttribute("href", "/contact");
  });

  it("lets an Admin add a publication, which the Admin then reaches", async () => {
    const { environment } = renderAuth(ORG_SETTINGS, { preset: "sahyadri-editor" });
    const user = userEvent.setup();
    const publications = within(await screen.findByRole("region", { name: "Publications" }));
    expect(publications.getByRole("link", { name: "Pune Daily Ledger" })).toHaveAttribute("href", PUB_SETTINGS);
    await user.type(publications.getByLabelText(/Publication name/), "Kalpanik Evening Post");
    await user.click(publications.getByRole("checkbox", { name: "Marathi" }));
    await user.click(publications.getByRole("button", { name: "Add publication" }));
    expect(await publications.findByText("Choose at least one language.")).toBeInTheDocument();
    await user.click(publications.getByRole("checkbox", { name: "English" }));
    expect(publications.getByRole("combobox", { name: "Main language" })).toHaveValue("en");
    await user.click(publications.getByRole("button", { name: "Add publication" }));
    expect(await publications.findByText(/Kalpanik Evening Post is added/)).toBeInTheDocument();
    expect(publications.getByRole("link", { name: "Kalpanik Evening Post" })).toBeInTheDocument();
    // the same name again is refused, as the API refuses it
    await user.type(publications.getByLabelText(/Publication name/), "kalpanik evening post");
    await user.click(publications.getByRole("button", { name: "Add publication" }));
    expect(await publications.findByText(/Some fields are not right|not right/)).toBeInTheDocument();
    // the Admin reaches the new publication: its settings open
    const listed = await environment.settings.getOrg({ orgId: ORG });
    const added = listed.ok ? listed.value.publications.find((pub) => pub.name === "Kalpanik Evening Post") : undefined;
    expect(added).toMatchObject({ languages: ["en"], primaryLanguage: "en", timezone: "Asia/Kolkata" });
    const opened = await environment.settings.getPublication({ orgId: ORG, pubId: added!.id });
    expect(opened.ok).toBe(true);
  });

  it("is not open to a Chief Editor, and is in Marathi with no serious axe violations", async () => {
    renderAuth(ORG_SETTINGS, { preset: "sahyadri-chief-editor" });
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
    resetBrowserState();
    document.body.innerHTML = "";
    const { container } = renderAuth(ORG_SETTINGS, { preset: "sahyadri-owner", language: "mr" });
    expect(await screen.findByRole("region", { name: "सर्वसाधारण" })).toBeInTheDocument();
    expect(screen.getByText(/बिलिंग: आम्ही बीजक पाठवतो/)).toBeInTheDocument();
    expect(await seriousViolations(container)).toEqual([]);
  });
});

describe("Publication settings", () => {
  it("lets the Chief Editor change the languages and timezone, beside the sections", async () => {
    const { environment } = renderAuth(PUB_SETTINGS, { preset: "sahyadri-chief-editor" });
    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { level: 1, name: "Publication settings" })).toBeInTheDocument();
    const form = within(await screen.findByRole("region", { name: "Name, languages and timezone" }));
    expect(form.getByLabelText(/Publication name/)).toHaveValue("Pune Daily Ledger");
    await user.click(form.getByRole("checkbox", { name: "English" }));
    await user.selectOptions(form.getByRole("combobox", { name: "Timezone" }), "Asia/Dubai");
    await user.click(form.getByRole("button", { name: "Save" }));
    expect(await form.findByText("Saved.")).toBeInTheDocument();
    const saved = await environment.settings.getPublication({ orgId: ORG, pubId: PUB });
    expect(saved.ok && saved.value).toMatchObject({ languages: ["mr"], primaryLanguage: "mr", timezone: "Asia/Dubai" });
    expect(screen.getByRole("region", { name: "Sections" })).toBeInTheDocument();
  });

  it("is closed to a Sub-editor, and a Reporter's change is refused (403 not_allowed)", async () => {
    const environment = createMockApplicationEnvironment();
    renderAuth(PUB_SETTINGS, { preset: "sahyadri-subeditor", environment });
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
    const refused = await environment.sessionController.actAs("sahyadri-reporter", () =>
      environment.settings.setPublication({ orgId: ORG, pubId: PUB, change: { timezone: "UTC" } }),
    );
    expect(!refused.ok && refused.error.kind === "answer" && refused.error.status).toBe(403);
  });
});

describe("The timezone list", () => {
  it("offers the current names the database knows, never the browser's old ones (Asia/Calcutta)", () => {
    vi.spyOn(Intl, "supportedValuesOf").mockReturnValue(["Asia/Calcutta", "Asia/Dubai", "Europe/Kiev"]);
    expect(timezones("Asia/Dubai")).toEqual(["Asia/Kolkata", "Asia/Dubai", "Europe/Kyiv"]);
    expect(timezones("Asia/Kolkata")).toEqual(["Asia/Kolkata", "Asia/Dubai", "Europe/Kyiv"]);
  });
});

describe("The story's section", () => {
  it("is chosen in the story editor and saved with the story; No section takes it off", async () => {
    const environment = createMockApplicationEnvironment();
    await environment.sessionController.actAs("sahyadri-chief-editor", () =>
      environment.layout.addSection({ orgId: ORG, pubId: PUB, name: "शहर" }),
    );
    const sections = await environment.sessionController.actAs("sahyadri-chief-editor", () =>
      environment.layout.listSections({ orgId: ORG, pubId: PUB }),
    );
    const city = sections.ok ? sections.value.items[0]!.id : "";
    renderAuth(`/org/${ORG}/pub/${PUB}/stories/story-demo-001`, { preset: "sahyadri-editor", environment });
    const user = userEvent.setup();
    const picker = await screen.findByRole("combobox", { name: "Section" });
    await waitFor(() => expect(within(picker).getByRole("option", { name: "शहर" })).toBeInTheDocument());
    await user.selectOptions(picker, city);
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument(), { timeout: 10_000 });
    const story = async () => {
      const result = await environment.stories.get({ orgId: ORG, pubId: PUB, storyId: "story-demo-001" });
      return result.ok ? result.value.sectionId : "failed";
    };
    expect(await story()).toBe(city);
    await user.selectOptions(screen.getByRole("combobox", { name: "Section" }), "");
    await waitFor(async () => expect(await story()).toBe(null), { timeout: 10_000 });
  });
});
