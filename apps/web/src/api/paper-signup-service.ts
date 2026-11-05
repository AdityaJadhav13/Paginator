/**
 * A new paper's sign-up over the API (apps/api/src/modules/signup/routes.ts), through the app's one client, so each
 * request carries `X-Pageinator: 1` and passes the API's Origin guard. An application filled in faster than the API's
 * minimum fill time is held until that time has passed (the API would drop it as a program's), as the contact form's.
 */
import { CONTACT_MIN_FILL_MS, PaperDetails } from "@pageinator/contracts";
import type { PaperConfirmOutcome, PaperSignupOutcome, PaperSignupService } from "../services/index.ts";
import type { ApiClient } from "./client.ts";

export function createApiPaperSignupService(
  client: ApiClient,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): PaperSignupService {
  return {
    async apply(request): Promise<PaperSignupOutcome> {
      const early = CONTACT_MIN_FILL_MS + 250 - request.filledInMs;
      if (early > 0) await wait(early);
      const result = await client.post("/api/v1/signup/paper", {
        ...request,
        filledInMs: Math.min(86_400_000, request.filledInMs + Math.max(0, early)),
      });
      if (result.ok) return { kind: "sent" };
      const { problem } = result;
      if (problem.kind !== "answer") return { kind: "failed" };
      if (problem.code === "signup_limit" || problem.code === "slow_down" || problem.status === 429) {
        return { kind: "busy" };
      }
      if (problem.code === "invalid_request") {
        const fields = (problem.details ?? []).map((detail) => detail.field.replace(/^body\.?/, "").split(".")[0] ?? "");
        return { kind: "invalid", fields: [...new Set(fields)] };
      }
      return { kind: "failed" };
    },
    async confirm(token): Promise<PaperConfirmOutcome> {
      const result = await client.post("/api/v1/signup/paper/confirm", { token });
      if (result.ok) return "waiting";
      const { problem } = result;
      return problem.kind === "answer" && (problem.code === "not_found" || problem.code === "invalid_request")
        ? "invalid"
        : "failed";
    },
    async paper(orgId, pubId) {
      const result = await client.get(`/api/v1/orgs/${encodeURIComponent(orgId)}/pubs/${encodeURIComponent(pubId)}/paper`);
      if (!result.ok) return { ok: false, error: result.problem };
      const parsed = PaperDetails.safeParse(result.value);
      if (!parsed.success) {
        return { ok: false, error: { kind: "answer", status: 200, code: "unexpected_answer", message: "" } };
      }
      return { ok: true, value: parsed.data };
    },
  };
}
