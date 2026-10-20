import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "../../src/test/render.tsx";
import userEvent from "@testing-library/user-event";
import { createMockApplicationEnvironment } from "../../src/mocks/index.ts";
import { renderUi004 } from "./renderUi004.tsx";

const PUNE = "/org/org-demo-sahyadri/pub/pub-demo-pune-daily/overview";

describe("UI004 auth and public routes", () => {
  it("shows two fictional login profiles without credential fields", async () => {
    renderUi004("/login", "signed-out");
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Demonstration identity and role" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Demo (Editor|Reviewer)/ })).toHaveLength(2);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/password|email|token/i)).not.toBeInTheDocument();
  });

  it("signs in as reviewer and replaces the route with the canonical workspace", async () => {
    const view = renderUi004("/login", "signed-out");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Konkan Demo Reviewer" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/org/org-demo-konkan/pub/pub-demo-ratnagiri-tide/overview");
    expect(view.container).toHaveTextContent("Konkan Demo Reviewer");
    expect(view.container).toHaveTextContent("reviewer");
    expect(screen.getByRole("combobox", { name: "Organization" })).toHaveTextContent("Konkan Coastal Press");
    expect(screen.queryByText("Sahyadri Media Cooperative")).not.toBeInTheDocument();
  });

  it("implements fictional signup, verify, and non-sending recovery actions", async () => {
    const user = userEvent.setup();
    const signup = renderUi004("/signup", "signed-out");
    await user.click(await screen.findByRole("button", { name: "Start fictional signup" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Onboarding" })).toBeInTheDocument();
    signup.unmount();

    const verify = renderUi004("/verify", "signed-out");
    await user.click(await screen.findByRole("button", { name: "Continue with verified fictional profile" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeInTheDocument();
    verify.unmount();

    renderUi004("/forgot-password", "signed-out");
    await user.click(await screen.findByRole("button", { name: "Preview fictional recovery" }));
    expect(screen.getByText(/No message was sent/)).toBeInTheDocument();
    expect(window.location.pathname).toBe("/forgot-password");
  });

  it("recovery action performs no network, persistence, form, cookie, or mail navigation", async () => {
    renderUi004("/forgot-password", "signed-out");
    const action = await screen.findByRole("button", { name: "Preview fictional recovery" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const xhrSpy = vi.spyOn(XMLHttpRequest.prototype, "open");
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    const submitSpy = vi.spyOn(HTMLFormElement.prototype, "submit");
    const cookieSpy = vi.spyOn(Document.prototype, "cookie", "set");
    const websocket = vi.fn();
    vi.stubGlobal("WebSocket", websocket);
    try {
      fireEvent.click(action);
      expect(await screen.findByText(/No message was sent/)).toBeInTheDocument();
      for (const spy of [fetchSpy, xhrSpy, storageSpy, submitSpy, cookieSpy, websocket]) expect(spy).not.toHaveBeenCalled();
      expect(document.querySelector("a[href^='mailto:']")).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it("keeps public leaf content while changing only the session affordance", async () => {
    const signedIn = renderUi004("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Newspaper production, end to end" })).toBeInTheDocument();
    expect(signedIn.container).toHaveTextContent("Sahyadri Demo Editor");
    expect(signedIn.container).toHaveTextContent("editor");
    signedIn.unmount();
    renderUi004("/", "signed-out");
    expect(await screen.findByRole("heading", { level: 1, name: "Newspaper production, end to end" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
  });
});

describe("UI004 protected access", () => {
  it("redirects signed-out workspace and editor deep links before protected content", async () => {
    renderUi004(PUNE, "signed-out");
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/login");
    expect(new URLSearchParams(window.location.search).get("returnTo")).toBe(PUNE);
    expect(screen.queryByText("Pune Daily Ledger")).not.toBeInTheDocument();
  });

  it("accepts canonical internal returnTo and rejects unsafe or unknown targets", async () => {
    const user = userEvent.setup();
    const accepted = renderUi004(`/login?returnTo=${encodeURIComponent(PUNE)}`, "signed-out");
    await user.click(await screen.findByRole("button", { name: "Sahyadri Demo Editor" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeInTheDocument();
    expect(window.location.pathname).toBe(PUNE);
    accepted.unmount();

    renderUi004("/login?returnTo=https%3A%2F%2Fevil.example", "signed-out");
    await user.click(await screen.findByRole("button", { name: "Sahyadri Demo Editor" }));
    await screen.findByRole("heading", { level: 1, name: "Overview" });
    expect(window.location.pathname).toBe(PUNE);
  });

  it("renders byte-equivalent access surfaces for unknown and known inaccessible organizations", async () => {
    const unknown = renderUi004("/org/org-unknown/settings", "konkan-reviewer");
    await screen.findByRole("heading", { level: 1, name: "Access unavailable" });
    const unknownMarkup = unknown.container.querySelector("main")?.innerHTML;
    unknown.unmount();
    const known = renderUi004("/org/org-demo-sahyadri/settings", "konkan-reviewer");
    await screen.findByRole("heading", { level: 1, name: "Access unavailable" });
    expect(known.container.querySelector("main")?.innerHTML).toBe(unknownMarkup);
    expect(known.container).not.toHaveTextContent("Sahyadri Media Cooperative");
    expect(screen.getByText("Demonstration only — production authorization is not evaluated here")).toBeInTheDocument();
  });

  it("renders identical access surfaces for unknown, wrong-scope, and known-ungranted publications", async () => {
    const paths = [
      "/org/org-demo-konkan/pub/pub-unknown/overview",
      "/org/org-demo-konkan/pub/pub-demo-pune-daily/overview",
      "/org/org-demo-sahyadri/pub/pub-demo-pune-daily/overview",
    ];
    const markups: string[] = [];
    for (const path of paths) {
      const view = renderUi004(path, "konkan-reviewer");
      await screen.findByRole("heading", { level: 1, name: "Access unavailable" });
      markups.push(view.container.querySelector("main")?.innerHTML ?? "");
      view.unmount();
    }
    expect(new Set(markups).size).toBe(1);
  });

  it("checks grants before calling disallowed organization/publication/edition lookups", async () => {
    const environment = createMockApplicationEnvironment();
    environment.sessionController.setPreset("konkan-reviewer");
    const getOrganization = vi.spyOn(environment.workspace, "getOrganization");
    const getPublication = vi.spyOn(environment.workspace, "getPublication");
    const getEdition = vi.spyOn(environment.workspace, "getEdition");
    renderUi004("/org/org-demo-sahyadri/pub/pub-demo-pune-daily/editions/edition-demo-001/content", undefined, environment);
    await screen.findByRole("heading", { level: 1, name: "Access unavailable" });
    expect(getOrganization).not.toHaveBeenCalled();
    expect(getPublication).not.toHaveBeenCalled();
    expect(getEdition).not.toHaveBeenCalled();
  });

  it("keeps invalid editions distinct under an allowed publication", async () => {
    renderUi004("/org/org-demo-sahyadri/pub/pub-demo-pune-daily/editions/edition-unknown/content");
    expect(await screen.findByRole("heading", { level: 1, name: "Not available" })).toBeInTheDocument();
    expect(screen.getByText("This edition is not available in this publication.")).toBeInTheDocument();
  });

  it("switches publication route, active session, and RTL context together", async () => {
    const { environment, container } = renderUi004(PUNE);
    const user = userEvent.setup();
    const select = await screen.findByRole("combobox", { name: "Publication" });
    await user.selectOptions(select, "pub-demo-urdu-evening");
    expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeInTheDocument();
    expect(window.location.pathname).toContain("pub-demo-urdu-evening");
    expect(container.querySelector(".pg-shell--workspace")).toHaveAttribute("dir", "rtl");
    expect(container.querySelector(".pg-shell--workspace")).toHaveAttribute("lang", "ur-IN");
    expect(await environment.session.getSession()).toMatchObject({ ok: true, value: { session: { activePublicationId: "pub-demo-urdu-evening" } } });
  });

  it("switches organizations to the grant's canonical publication and role", async () => {
    const { environment, container } = renderUi004(PUNE);
    const organization = await screen.findByRole("combobox", { name: "Organization" });
    await userEvent.setup().selectOptions(organization, "org-demo-konkan");
    await waitFor(() => expect(container).toHaveTextContent("reviewer"));
    expect(screen.getByRole("heading", { level: 1, name: "Overview" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/org/org-demo-konkan/pub/pub-demo-ratnagiri-tide/overview");
    expect(await environment.session.getSession()).toMatchObject({ ok: true, value: { session: { activeOrganizationId: "org-demo-konkan", activePublicationId: "pub-demo-ratnagiri-tide" } } });
  });

  it("switches fictional profile, filtered options, role, and route together", async () => {
    const { container } = renderUi004(PUNE);
    const profile = await screen.findByRole("combobox", { name: "Demonstration identity and role" });
    await userEvent.setup().selectOptions(profile, "user-demo-konkan-reviewer");
    await waitFor(() => expect(window.location.pathname).toBe("/org/org-demo-konkan/pub/pub-demo-ratnagiri-tide/overview"));
    await waitFor(() => expect(container).toHaveTextContent("Konkan Demo Reviewer"));
    expect(container).toHaveTextContent("reviewer");
    expect(screen.getByRole("combobox", { name: "Organization" }).querySelectorAll("option")).toHaveLength(1);
    expect(container).not.toHaveTextContent("Sahyadri Media Cooperative");
  });

  it("logs out from protected content without preserving returnTo", async () => {
    renderUi004(PUNE);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/login");
    expect(window.location.search).toBe("");
  });

  it("preserves unmatched workspace shape as NotFound for any session", async () => {
    renderUi004("/org/unknown/pub/unknown/not-a-route", "signed-out");
    expect(await screen.findByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
    expect(document.querySelector(".pg-shell--workspace")).toBeInTheDocument();
  });
});

describe("UI004 UI003 scenario integration", () => {
  it("renders temporary failure distinctly and recovers through Retry", async () => {
    const environment = createMockApplicationEnvironment();
    environment.scenarios.setScenario({ mode: "failure", operations: ["organization.list"] });
    renderUi004(PUNE, undefined, environment);
    expect(await screen.findByText("The demonstration service is temporarily unavailable. Try again.")).toBeInTheDocument();
    expect(window.location.pathname).toBe(PUNE);
    environment.scenarios.setScenario({ mode: "normal" });
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeInTheDocument();
  });

  it("keeps loading visible until an injected latency boundary resolves", async () => {
    let release!: () => void;
    const environment = createMockApplicationEnvironment({ delay: () => new Promise<void>((resolve) => { release = resolve; }) });
    environment.scenarios.setScenario({ mode: "latency", delayMs: 50, operations: ["organization.list"] });
    renderUi004(PUNE, undefined, environment);
    expect(await screen.findByText("Loading workspace context")).toBeInTheDocument();
    await waitFor(() => expect(release).toBeTypeOf("function"));
    release();
    expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeInTheDocument();
  });
});
