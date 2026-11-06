/**
 * The release's double (docs/product/10-l2-newsroom-plan.md §1 L2.5), answered as the API's release routes, built on
 * the layout double's board run: the preflight list (laid out, the independent check, approval, ad images, the press
 * test, stories not placed), page approval and unlocking (409 approval_stale on another revision or bytes, not_approved),
 * a release bound to the candidate's SHA-256 (409 approval_stale, release_refused), its files by link, "Mark as sent",
 * the press's confirmation (409 already_confirmed), the archive check and the press test. Every page PDF's SHA-256 is
 * fictional and never changes here, so a correction is not modelled (tests stub one). The archive lists the releases made
 * here (the search over stories is not modelled: a search finds nothing); print profiles are kept in memory, and a
 * release pins the newest; the press test page is a fictional file with a fictional SHA-256. Permissions are not
 * modelled: the screen hides what the API would refuse. Fictional data only.
 */
import type {
  ApiProblem,
  EditionReleaseDto,
  LayoutService,
  PageApprovalDto,
  PressTestDto,
  ReleaseItemDto,
  ReleasePageDto,
  ReleaseService,
  ServiceResult,
} from "../services/index.ts";
import type { PrintProfileDto } from "../services/release-service.ts";

export interface MockReleaseDeps {
  readonly layout: LayoutService;
  person(): { readonly userId: string; readonly name: string } | undefined;
}

const NOW = "2026-10-24T10:00:00.000+05:30";
const id = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, "0")}`;
/** A page PDF's fictional SHA-256: "03" 32 times for page 3. */
const sha = (page: number) => String(page).padStart(2, "0").repeat(32);
const fail = (status: number, code: string, current?: unknown): { ok: false; error: ApiProblem } => ({
  ok: false,
  error: { kind: "answer", status, code, message: code, ...(current !== undefined ? { current } : {}) },
});

export function createMockRelease(deps: MockReleaseDeps): {
  readonly release: ReleaseService;
  approvalOf(runId: string, page: number): PageApprovalDto | null;
  reset(): void;
} {
  let approvals = new Map<string, PageApprovalDto>();
  let releases: ReleaseItemDto[] = [];
  let pressTest: PressTestDto | null = null;
  let profiles: PrintProfileDto[] = [];
  let counter = 0;
  /** the newest view of each run's pages, for an approval */
  let runs = new Map<string, { editionId: string; pages: ReleasePageDto[] }>();
  const key = (runId: string, page: number) => `${runId}:${page}`;
  const me = () => {
    const person = deps.person();
    return { id: person?.userId ?? id(0), name: person?.name ?? "Fictional Editor" };
  };

  async function build(
    orgId: string,
    pubId: string,
    editionId: string,
  ): Promise<ServiceResult<EditionReleaseDto, ApiProblem>> {
    const layout = await deps.layout.getLayout({ orgId, pubId, editionId });
    if (!layout.ok) return layout;
    const board = layout.value.board;
    const mine = releases.filter((r) => r.editionId === editionId);
    const lastOf = (page: number) => mine.flatMap((r) => r.files).find((f) => f.page === page) ?? null;
    const pages: ReleasePageDto[] = (board?.pages ?? []).map((p) => {
      const pdfSha256 = p.pdf ? sha(p.page) : null;
      const last = lastOf(p.page);
      const approval = approvals.get(key(board!.id, p.page)) ?? null;
      return {
        runId: board!.id,
        page: p.page,
        role: p.role,
        rev: 0,
        pdfSha256,
        check: p.pdf ? p.check : null,
        needsSave: false,
        approval: approval && approval.pdfSha256 === pdfSha256 ? approval : null,
        released: last ? { name: last.name, sha256: last.sha256, changed: last.sha256 !== pdfSha256 } : null,
      };
    });
    if (board) runs.set(board.id, { editionId, pages });
    const failing = (test: (p: (typeof pages)[number]) => boolean) => pages.filter(test).map((p) => p.page);
    type Item = EditionReleaseDto["preflight"]["items"][number];
    const item = (check: Item["check"], bad: number[], failed = bad.length > 0): Item => ({
      check,
      state: failed ? "failed" : "passed",
      pages: bad,
      slots: [],
      printsOld: false,
      stories: [],
    });
    const needsPressTest = !!board;
    const notReady = layout.value.slots.filter((s) => s.state !== "ready").map((s) => s.slot);
    const items: Item[] = [
      item("laid_out", board?.pages.filter((p) => p.state !== "done").map((p) => p.page) ?? [], !board || undefined),
      item(
        "pdf_check",
        failing((p) => !p.check?.passed),
      ),
      item("saved", []),
      item("placement", []),
      item("folio", []),
      ...(layout.value.slots.length ? [{ ...item("ad_artwork", [], notReady.length > 0), slots: notReady }] : []),
      item(
        "approved",
        failing((p) => !p.approval),
      ),
      ...(needsPressTest ? [item("press_test", [], !pressTest)] : []),
      {
        ...item("not_placed", []),
        state: board?.notPlaced.length ? "warning" : "passed",
        stories: (board?.notPlaced ?? []).map((s) => ({ ...s })),
      },
    ];
    const date = /\d{4}-\d{2}-\d{2}/.exec(editionId)?.[0] ?? "2026-10-24";
    const files = pages
      .filter((p) => p.pdfSha256 && (!p.released || p.released.changed))
      .map((p) => {
        const version = mine.filter((r) => r.files.some((f) => f.page === p.page)).length + 1;
        return {
          page: p.page,
          name: `${date}_P${String(p.page).padStart(2, "0")}${version > 1 ? `_v${version}` : ""}.pdf`,
          rev: p.rev,
          sha256: p.pdfSha256!,
          bytes: 1_200_000 + p.page,
          replaces: p.released?.name ?? null,
        };
      });
    return {
      ok: true,
      value: {
        editionId,
        runId: board?.id ?? null,
        preflight: { items, passed: items.every((i) => i.state !== "failed") },
        pages,
        candidate:
          board && files.length ? { kind: mine.length ? "correction" : "release", runId: board.id, files } : null,
        releases: mine.map((r) => structuredClone(r)),
        needsPressTest,
        pressTest,
      },
    };
  }

  const releaseOf = (releaseId: string) => releases.find((r) => r.id === releaseId);

  const release: ReleaseService = {
    get: ({ orgId, pubId, editionId }) => build(orgId, pubId, editionId),
    async approvePage({ runId, page, rev, pdfSha256 }) {
      const current = runs.get(runId)?.pages.find((p) => p.page === page);
      if (!current) return fail(404, "not_found");
      if (current.rev !== rev || current.pdfSha256 !== pdfSha256 || current.needsSave)
        return fail(409, "approval_stale", current);
      const approval = approvals.get(key(runId, page)) ?? { by: me(), at: NOW, rev, pdfSha256 };
      approvals.set(key(runId, page), approval);
      return { ok: true, value: { ...current, approval } };
    },
    async unlockPage({ runId, page }) {
      const current = runs.get(runId)?.pages.find((p) => p.page === page);
      if (!current) return fail(404, "not_found");
      if (!approvals.delete(key(runId, page))) return fail(409, "not_approved");
      return { ok: true, value: { ...current, approval: null } };
    },
    async create({ orgId, pubId, editionId, files, note }) {
      const now = await build(orgId, pubId, editionId);
      if (!now.ok) return now;
      const { candidate, preflight } = now.value;
      const same =
        !!candidate &&
        candidate.files.length === files.length &&
        candidate.files.every((f, i) => f.page === files[i]?.page && f.sha256 === files[i]?.sha256);
      if (!same) return fail(409, "approval_stale", candidate);
      if (!preflight.passed) return fail(409, "release_refused");
      counter += 1;
      const made: ReleaseItemDto = {
        id: id(100 + counter),
        editionId,
        runId: candidate.runId,
        number: releases.filter((r) => r.editionId === editionId).length + 1,
        kind: candidate.kind,
        approvedBy: me(),
        approvedAt: NOW,
        note: note ?? null,
        files: candidate.files,
        archive: { verifiedAt: NOW, retainUntil: "2033-10-24T10:00:00.000+05:30", manifestSha256: "a".repeat(64) },
        deliveries: [],
        printProfile: profiles[0]
          ? { id: profiles[0].id, version: profiles[0].version, pressName: profiles[0].pressName }
          : null,
      };
      releases = [made, ...releases];
      return { ok: true, value: structuredClone(made) };
    },
    async fileLink({ releaseId, name }) {
      if (!releaseOf(releaseId)?.files.some((f) => f.name === name)) return fail(404, "not_found");
      return {
        ok: true,
        value: { url: `mock-store://releases/${releaseId}/${name}`, expiresAt: "2099-01-01T00:05:00.000Z" },
      };
    },
    async markSent({ releaseId, note }) {
      const found = releaseOf(releaseId);
      if (!found) return fail(404, "not_found");
      counter += 1;
      found.deliveries.push({
        id: id(200 + counter),
        method: "download",
        sentBy: me(),
        sentAt: NOW,
        note: note ?? null,
        files: found.files.map((f) => ({ name: f.name, sha256: f.sha256, bytes: f.bytes })),
        confirmation: null,
      });
      return { ok: true, value: structuredClone(found) };
    },
    async confirm({ releaseId, deliveryId, pressPerson, at, note }) {
      const delivery = releaseOf(releaseId)?.deliveries.find((d) => d.id === deliveryId);
      if (!delivery) return fail(404, "not_found");
      if (delivery.confirmation) return fail(409, "already_confirmed");
      delivery.confirmation = { pressPerson, at: at ?? NOW, note: note ?? null, recordedBy: me() };
      return { ok: true, value: structuredClone(releaseOf(releaseId)!) };
    },
    async verify({ releaseId }) {
      const found = releaseOf(releaseId);
      if (!found) return fail(404, "not_found");
      return {
        ok: true,
        value: {
          checkedAt: NOW,
          ok: true,
          files: found.files.map((f) => ({ name: f.name, sha256: f.sha256, ok: true })),
        },
      };
    },
    async setPressTest({ pageSha256, acceptedOn, note }) {
      const person = me();
      pressTest = { pageSha256, acceptedOn, note: note ?? null, recordedBy: person, recordedAt: NOW };
      return { ok: true, value: { ...pressTest } };
    },
    async archive({ year, month, kind, q }) {
      const items = releases
        .map((r) => ({ r, date: /\d{4}-\d{2}-\d{2}/.exec(r.editionId)?.[0] ?? "2026-10-24" }))
        .filter(
          ({ r, date }) =>
            (year === undefined || Number(date.slice(0, 4)) === year) &&
            (month === undefined || Number(date.slice(5, 7)) === month) &&
            (!kind || r.kind === kind) &&
            !q,
        )
        .map(({ r, date }) => ({
          releaseId: r.id,
          editionId: r.editionId,
          editionDate: date,
          number: r.number,
          kind: r.kind,
          approvedAt: r.approvedAt,
          retainUntil: r.archive.retainUntil,
          files: r.files.length,
          runId: r.runId,
          frontThumb: true,
          matches: [],
        }));
      return { ok: true, value: { items, truncated: false } };
    },
    async archiveRelease({ releaseId }) {
      const found = releaseOf(releaseId);
      if (!found) return fail(404, "not_found");
      const mine = releases.filter((r) => r.editionId === found.editionId);
      return {
        ok: true,
        value: {
          release: structuredClone(found),
          edition: {
            id: found.editionId,
            date: /\d{4}-\d{2}-\d{2}/.exec(found.editionId)?.[0] ?? "2026-10-24",
            releases: mine.map((r) => ({ id: r.id, number: r.number, kind: r.kind, approvedAt: r.approvedAt })),
          },
        },
      };
    },
    async printProfiles() {
      return {
        ok: true,
        value: {
          items: structuredClone(profiles),
          facts: {
            engineProfileVersion: 1,
            trim: { wMm: 330, hMm: 520 },
            pdfStandard: "PDF/X-1a",
            checkerSha256: "c".repeat(64),
            iccSha256: "d".repeat(64),
            adMinPpi: 200,
            photoSharpPpi: 150,
            delivery: "download",
          },
        },
      };
    },
    async addPrintProfile({ pressName, contact, note }) {
      counter += 1;
      const made: PrintProfileDto = {
        id: id(300 + counter),
        version: profiles.length + 1,
        pressName,
        contact: contact || null,
        note: note || null,
        createdBy: me(),
        createdAt: NOW,
      };
      profiles = [made, ...profiles];
      return { ok: true, value: structuredClone(made) };
    },
    async pressTestPage() {
      // a fictional file: not a PDF, never made or checked by the engine here
      const sha256 = "e".repeat(64);
      const file = new Blob(["fictional press test page"], { type: "application/pdf" });
      return { ok: true, value: { file, filename: `pageinator-press-test-${sha256.slice(0, 12)}.pdf`, sha256, warnings: 2 } };
    },
  };
  return {
    release,
    approvalOf: (runId, page) => approvals.get(key(runId, page)) ?? null,
    reset() {
      approvals = new Map();
      releases = [];
      pressTest = null;
      profiles = [];
      counter = 0;
      runs = new Map();
    },
  };
}
