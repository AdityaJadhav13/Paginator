/**
 * The archive (doc 06 §10.1) on the test double with fictional data: the releases grouped by year and month with
 * "Kept until", the front page's thumbnail only when it loads, the filters and the search sent to the API, the matches
 * shown; a release's view with its files, download (export.press only), the edition's other releases linked, the print
 * profile pinned; "Not available" for a release the API does not give; axe in English and Marathi.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "../../src/test/render.tsx";
import { createMockApplicationEnvironment } from "../../src/mocks/index.ts";
import type { ArchiveEntryDto, ArchiveReleaseDto } from "../../src/services/release-service.ts";
import { groups } from "../../src/features/archive/ArchiveScreen.tsx";
import { renderAuth, resetBrowserState, seriousViolations } from "../auth/helpers.tsx";

vi.setConfig({ testTimeout: 30_000 });

const ORG = "org-demo-sahyadri";
const PUB = "pub-demo-pune-daily";
const LIST = `/org/${ORG}/pub/${PUB}/archive`;
const id = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const AT = "2026-10-24T10:00:00.000+05:30";
const SHA = "ab".repeat(32);

const entry = (n: number, date: string, kind: "release" | "correction" = "release"): ArchiveEntryDto => ({
  releaseId: id(n),
  editionId: id(500 + n),
  editionDate: date,
  number: kind === "correction" ? 2 : 1,
  kind,
  approvedAt: AT,
  retainUntil: "2033-10-24T10:00:00.000+05:30",
  files: 4,
  runId: id(900 + n),
  frontThumb: true,
  matches: [],
});

const releaseView = (printProfile: ArchiveReleaseDto["release"]["printProfile"]): ArchiveReleaseDto => ({
  release: {
    id: id(2),
    editionId: id(502),
    runId: id(902),
    number: 2,
    kind: "correction",
    approvedBy: { id: id(1), name: "Fictional Chief" },
    approvedAt: AT,
    note: null,
    files: [{ page: 3, name: "2026-10-24_P03_v2.pdf", rev: 1, sha256: SHA, bytes: 1_234_567, replaces: "2026-10-24_P03.pdf" }],
    archive: { verifiedAt: AT, retainUntil: "2033-10-24T10:00:00.000+05:30", manifestSha256: SHA },
    deliveries: [],
    printProfile,
  },
  edition: {
    id: id(502),
    date: "2026-10-24",
    releases: [
      { id: id(2), number: 2, kind: "correction", approvedAt: AT },
      { id: id(1), number: 1, kind: "release", approvedAt: AT },
    ],
  },
});

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:fictional");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  resetBrowserState();
  vi.restoreAllMocks();
});

describe("the archive list", () => {
  it("groups by year and month, keeps their order", () => {
    const out = groups([entry(1, "2026-11-02"), entry(2, "2026-10-24"), entry(3, "2026-10-01"), entry(4, "2025-12-31")]);
    expect(out.map(([y, months]) => [y, months.map(([m, items]) => [m, items.length])])).toEqual([
      [2026, [[11, 1], [10, 2]]],
      [2025, [[12, 1]]],
    ]);
  });

  it("shows each release with Kept until and its thumbnail, filters and searches through the API; axe clean", async () => {
    const environment = createMockApplicationEnvironment();
    const archive = vi.spyOn(environment.release, "archive").mockResolvedValue({
      ok: true,
      value: { items: [entry(1, "2026-11-02"), entry(2, "2026-10-24", "correction")], truncated: false },
    });
    const thumb = vi
      .spyOn(environment.layout, "loadFile")
      .mockResolvedValueOnce({ ok: true, value: new Blob(["png"]) })
      .mockResolvedValue({ ok: false, error: { kind: "answer", status: 404, code: "not_found", message: "" } });
    const user = userEvent.setup();
    const { container } = renderAuth(LIST, { preset: "sahyadri-chief-editor", environment });
    expect(await screen.findByRole("heading", { level: 2, name: "2026" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "November 2026" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "October 2026" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edition of 24 October 2026" })).toHaveAttribute(
      "href",
      `${LIST}/${id(2)}`,
    );
    expect(screen.getByText("Correction 2")).toBeInTheDocument();
    expect(screen.getAllByText(/Kept until 24 October 2033/)).toHaveLength(2);
    // one thumbnail loaded; the one that failed shows nothing (never a broken image)
    expect(await screen.findAllByRole("img", { name: /Front page of the edition of/ })).toHaveLength(1);
    expect(thumb).toHaveBeenCalledWith(expect.objectContaining({ runId: id(901), name: "page-01.thumb.png" }));
    expect(await seriousViolations(container)).toEqual([]);

    await user.selectOptions(screen.getByLabelText("Kind"), "correction");
    await waitFor(() => expect(archive).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "correction" })));
    await user.selectOptions(screen.getByLabelText("Month"), "10");
    await waitFor(() => expect(archive).toHaveBeenLastCalledWith(expect.objectContaining({ month: 10 })));
    archive.mockResolvedValue({
      ok: true,
      value: {
        items: [
          {
            ...entry(2, "2026-10-24"),
            matches: [{ storyId: id(77), headline: "Fictional dam opens", reporter: "Asha Kalpit", section: "City" }],
          },
        ],
        truncated: false,
      },
    });
    await user.type(screen.getByLabelText("Headline, reporter or section"), "dam");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() =>
      expect(archive).toHaveBeenLastCalledWith(expect.objectContaining({ q: "dam", kind: "correction", month: 10 })),
    );
    expect(await screen.findByText("Fictional dam opens (Asha Kalpit, City)")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(archive).toHaveBeenLastCalledWith({ orgId: ORG, pubId: PUB }));
  });

  it("says when the archive is empty, in Marathi too; axe clean", async () => {
    const { container } = renderAuth(LIST, { preset: "sahyadri-reporter", language: "mr" });
    expect(await screen.findByText("संग्रहात अजून काही नाही")).toBeInTheDocument();
    expect(await seriousViolations(container)).toEqual([]);
  });
});

describe("an archived release", () => {
  it("shows its files, the edition's releases linked and the print profile; download only with export.press", async () => {
    const environment = createMockApplicationEnvironment();
    vi.spyOn(environment.release, "archiveRelease").mockResolvedValue({
      ok: true,
      value: releaseView({ id: id(40), version: 3, pressName: "Fictional Press" }),
    });
    const { container } = renderAuth(`${LIST}/${id(2)}`, { preset: "sahyadri-chief-editor", environment });
    expect(await screen.findByRole("heading", { level: 1, name: "Edition of 24 October 2026" })).toBeInTheDocument();
    expect(screen.getByText("Kept until 24 October 2033")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Release 1" })).toHaveAttribute("href", `${LIST}/${id(1)}`);
    expect(screen.getByText("Correction 2 (shown here)")).toBeInTheDocument();
    expect(screen.getByText("2026-10-24_P03_v2.pdf")).toBeInTheDocument();
    expect(screen.getByText(SHA)).toBeInTheDocument();
    expect(screen.getByText("Print profile: version 3, Fictional Press")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check the archive copy" })).toBeInTheDocument();
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("has no download for a reporter, and says when no print profile was pinned", async () => {
    const environment = createMockApplicationEnvironment();
    vi.spyOn(environment.release, "archiveRelease").mockResolvedValue({ ok: true, value: releaseView(null) });
    renderAuth(`${LIST}/${id(2)}`, { preset: "sahyadri-reporter", environment });
    expect(await screen.findByText("No print profile was saved when this was approved.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Download/ })).not.toBeInTheDocument();
  });

  it("is Not available when the API does not give it", async () => {
    const { container } = renderAuth(`${LIST}/${id(99)}`, { preset: "sahyadri-chief-editor" });
    expect(await screen.findByRole("heading", { level: 1, name: "Not available" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the archive" })).toHaveAttribute("href", LIST);
    expect(await seriousViolations(container)).toEqual([]);
  });
});
