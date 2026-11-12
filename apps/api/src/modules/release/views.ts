// A release as the API answers it (packages/contracts/src/release.ts Release): for the Release tab's routes
// (routes.ts) and the archive's (archive.ts).
import type { Delivery, Release } from "@pageinator/contracts";
import { type DeliveryRow, type ReleaseRow, deliveries, findRelease, releaseFiles } from "../../db/release.ts";
import type { Tx } from "../../db/tenant.ts";

function deliveryView(row: DeliveryRow): Delivery {
  return {
    id: row.id,
    method: "download",
    sentBy: { id: row.sent_by, name: row.sent_name },
    sentAt: row.sent_at.toISOString(),
    note: row.note,
    files: row.files,
    confirmation:
      row.press_person !== null && row.confirmed_at !== null && row.confirmed_by !== null
        ? {
            pressPerson: row.press_person,
            at: row.confirmed_at.toISOString(),
            note: row.confirm_note,
            recordedBy: { id: row.confirmed_by, name: row.confirmed_name ?? "" },
          }
        : null,
  };
}

/** A release's manifest columns: always written in its own transaction (a release without them is a bug). */
function written<T>(value: T | null, id: string): T {
  if (value === null) throw new Error(`release ${id} has no manifest`);
  return value;
}

export async function releaseViews(tx: Tx, pub: string, rows: readonly ReleaseRow[]): Promise<Release[]> {
  const ids = rows.map((r) => r.id);
  const files = await releaseFiles(tx, pub, ids);
  const sent = await deliveries(tx, pub, ids);
  return rows.map((r) => ({
    id: r.id,
    editionId: r.edition_id,
    runId: r.run_id,
    number: r.number,
    kind: r.kind,
    approvedBy: { id: r.approved_by, name: r.approved_name },
    approvedAt: r.approved_at.toISOString(),
    note: r.note,
    files: files
      .filter((f) => f.release_id === r.id)
      .map((f) => ({
        page: f.page_no,
        name: f.name,
        rev: f.rev,
        sha256: f.sha256,
        bytes: f.bytes,
        replaces: f.replaces,
      })),
    archive: {
      verifiedAt: written(r.verified_at, r.id).toISOString(),
      retainUntil: r.retain_until.toISOString(),
      manifestSha256: written(r.manifest_sha256, r.id),
    },
    deliveries: sent.filter((d) => d.release_id === r.id).map(deliveryView),
    printProfile:
      r.print_profile_id !== null && r.print_profile_version !== null && r.press_name !== null
        ? { id: r.print_profile_id, version: r.print_profile_version, pressName: r.press_name }
        : null,
  }));
}

export async function releaseView(tx: Tx, pub: string, id: string): Promise<Release | null> {
  const row = await findRelease(tx, pub, id);
  return row ? ((await releaseViews(tx, pub, [row]))[0] ?? null) : null;
}

export async function releaseNow(tx: Tx, pub: string, id: string): Promise<Release> {
  const view = await releaseView(tx, pub, id);
  if (!view) throw new Error("the release is not found");
  return view;
}
