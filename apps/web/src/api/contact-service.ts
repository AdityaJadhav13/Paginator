/**
 * The website's contact form over the API (apps/api/src/modules/contact/routes.ts), through the app's one client, so
 * a message carries `X-Pageinator: 1` and passes the API's Origin guard like every other change:
 *   - GET /api/v1/contact: whether the form is connected;
 *   - POST /api/v1/contact: send a message. One filled in faster than the API's minimum fill time is held until that
 *     time has passed (the API would drop it as a program's), and then says the time it really took.
 */
import { CONTACT_MIN_FILL_MS, ContactStatus } from "@pageinator/contracts";
import type { ContactConnection, ContactOutcome, ContactRequestDto, ContactService } from "../services/index.ts";
import type { ApiClient } from "./client.ts";

export function createApiContactService(
  client: ApiClient,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): ContactService {
  return {
    async connection(): Promise<ContactConnection> {
      const result = await client.get("/api/v1/contact");
      if (!result.ok) return "unknown";
      const status = ContactStatus.safeParse(result.value);
      if (!status.success) return "unknown";
      return status.data.connected ? "connected" : "notConnected";
    },
    async send(request: ContactRequestDto): Promise<ContactOutcome> {
      const early = CONTACT_MIN_FILL_MS + 250 - request.filledInMs;
      if (early > 0) await wait(early);
      const result = await client.post("/api/v1/contact", {
        ...request,
        filledInMs: Math.min(86_400_000, request.filledInMs + Math.max(0, early)),
      });
      if (result.ok) return { kind: "sent" };
      const { problem } = result;
      if (problem.kind !== "answer") return { kind: "failed" };
      if (problem.code === "contact_unavailable") return { kind: "unavailable" };
      if (problem.code === "contact_limit" || problem.code === "slow_down" || problem.status === 429) {
        return { kind: "busy" };
      }
      if (problem.code === "bad_origin") return { kind: "refused" };
      if (problem.code === "invalid_request") {
        const fields = (problem.details ?? []).map((detail) => detail.field.replace(/^body\.?/, "").split(".")[0] ?? "");
        return { kind: "invalid", fields: [...new Set(fields)] };
      }
      return { kind: "sendFailed" };
    },
  };
}
