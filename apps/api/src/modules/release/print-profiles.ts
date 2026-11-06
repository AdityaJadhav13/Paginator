// Print profiles' routes (packages/contracts/src/print-profiles.ts, whose header lists them), under
// /api/v1/orgs/:o/pubs/:p, registered inside releaseRoutes (a release pins the version in use: db/release.ts); the
// press test page's route is a plugin of its own (pressTestRoutes), registered in app.ts with the edit gateway.
import { createHash } from "node:crypto";
import {
  ARTWORK_MIN_PPI,
  type ErrorCode,
  type PressTestPage,
  PrintProfile,
  PrintProfileInput,
  PrintProfiles,
} from "@pageinator/contracts";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { recordAudit } from "../../db/audit.ts";
import type { Database } from "../../db/pools.ts";
import {
  type FactsRow,
  type PrintProfileRow,
  addPrintProfile,
  pressFactsOf,
  printProfile,
  printProfiles,
} from "../../db/print-profiles.ts";
import type { Tx } from "../../db/tenant.ts";
import { ApiError } from "../../http/errors.ts";
import { accessOf } from "../access/access.ts";
import type { Gateway } from "../editor/gateway.ts";
import { MIN_PPI } from "../media/library.ts";
import { idempotent } from "../requests/idempotency.ts";

const Pub = z.strictObject({ o: z.string(), p: z.string() });

const view = (row: PrintProfileRow): PrintProfile => ({
  id: row.id,
  version: row.version,
  pressName: row.press_name,
  contact: row.contact,
  note: row.note,
  createdBy: { id: row.created_by, name: row.created_name },
  createdAt: row.created_at.toISOString(),
});

/** The front template's size as recorded (null: not recorded). */
const trimOf = (facts: FactsRow) =>
  facts.page_w_mm !== null && facts.page_h_mm !== null && facts.page_w_mm > 0 && facts.page_h_mm > 0
    ? { wMm: facts.page_w_mm, hMm: facts.page_h_mm }
    : null;

async function viewOf(tx: Tx, pub: string, id: string): Promise<PrintProfile | null> {
  const row = await printProfile(tx, pub, id);
  return row ? view(row) : null;
}

export const printProfileRoutes: FastifyPluginAsyncZod<{ database: Database }> = async (app, { database }) => {
  app.get(
    "/api/v1/orgs/:o/pubs/:p/print-profiles",
    { config: { permission: "print_profiles.view" }, schema: { params: Pub, response: { 200: PrintProfiles } } },
    async (request) => {
      const pub = request.params.p;
      return database.withTenant(accessOf(request).tenant, async (tx) => {
        const facts = await pressFactsOf(tx, pub);
        return {
          items: (await printProfiles(tx, pub)).map(view),
          facts: {
            engineProfileVersion: facts.version,
            trim: trimOf(facts),
            pdfStandard: "PDF/X-1a" as const,
            checkerSha256: facts.checker_sha256,
            iccSha256: facts.icc_sha256,
            adMinPpi: ARTWORK_MIN_PPI,
            photoSharpPpi: MIN_PPI,
            delivery: "download" as const,
          },
        };
      });
    },
  );

  app.post(
    "/api/v1/orgs/:o/pubs/:p/print-profiles",
    {
      config: { permission: "print_profiles.edit" },
      schema: { params: Pub, body: PrintProfileInput, response: { 201: PrintProfile } },
    },
    async (request, reply) => {
      const tenant = accessOf(request).tenant;
      const pub = request.params.p;
      const { pressName, contact, note } = request.body;
      const answer = await idempotent(
        database,
        request,
        tenant,
        async (tx) => {
          const id = await addPrintProfile(tx, tenant, pub, {
            pressName,
            contact: contact || null,
            note: note || null,
          });
          const made = await viewOf(tx, pub, id);
          if (!made) throw new Error("the print profile just made is not found");
          await recordAudit(tx, tenant, {
            action: "print_profile.create",
            targetType: "print_profile",
            targetId: id,
            publicationId: pub,
            data: { version: made.version },
          });
          return { status: 201, body: made, stored: { id } };
        },
        (stored, tx) => viewOf(tx, pub, (stored as { id: string }).id),
      );
      return reply.status(201).send(answer.body as PrintProfile);
    },
  );
};

/** The press test page's trim may differ from the recorded one by this much. */
const TRIM_TOLERANCE_MM = 1;

export const pressTestRoutes: FastifyPluginAsyncZod<{ database: Database; gateway: Gateway | undefined }> = async (
  app,
  { database, gateway },
) => {
  app.get(
    "/api/v1/orgs/:o/pubs/:p/print-profiles/press-test",
    { config: { permission: "print_profiles.view" }, schema: { params: Pub } },
    async (request, reply) => {
      const refuse = (code: ErrorCode, reason: string) => {
        request.log.warn({ reason }, "the press test page was not given");
        return new ApiError(code);
      };
      const facts = await database.withTenant(accessOf(request).tenant, (tx) => pressFactsOf(tx, request.params.p));
      if (!gateway) throw refuse("press_test_unavailable", "the edit gateway is not set up");
      let page: PressTestPage;
      try {
        page = await gateway.pressTest();
      } catch (error) {
        throw refuse("press_test_unavailable", (error as { reason?: string }).reason ?? String(error));
      }
      const pdf = Buffer.from(page.pdf, "base64");
      const sha256 = createHash("sha256").update(pdf).digest("hex");
      if (sha256 !== page.sha256 || pdf.length !== page.bytes) {
        throw refuse("press_test_unavailable", "the PDF's bytes are not the ones the gateway named");
      }
      if (!page.check.passed) throw refuse("press_test_refused", `the PDF/X-1a check failed (${page.check.fails})`);
      const trim = trimOf(facts);
      const [w, h] = page.page_mm;
      if (trim && (Math.abs(trim.wMm - w) > TRIM_TOLERANCE_MM || Math.abs(trim.hMm - h) > TRIM_TOLERANCE_MM)) {
        throw refuse("press_test_refused", `the trim is ${trim.wMm} × ${trim.hMm} mm, the page ${w} × ${h} mm`);
      }
      if (facts.icc_sha256 !== null && facts.icc_sha256 !== page.icc_sha256) {
        throw refuse("press_test_refused", "the gateway's colour profile is not the one the engine was set up with");
      }
      return reply
        .type("application/pdf")
        .headers({
          "content-disposition": `attachment; filename="pageinator-press-test-${sha256.slice(0, 12)}.pdf"`,
          "cache-control": "no-store",
          "x-pageinator-sha256": sha256,
          "x-pageinator-icc-sha256": page.icc_sha256,
          "x-pageinator-check-warnings": String(page.check.warnings),
        })
        .send(pdf);
    },
  );
};
