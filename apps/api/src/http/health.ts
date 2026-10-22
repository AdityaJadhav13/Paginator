// /healthz answers while the process is up. /readyz reports each dependency as "ok", "failing" or "not_configured",
// and answers 503 when one is failing. main.ts gives the database's check (src/db/pools.ts: both pools answer a
// query); a test app without it reports "not_configured".
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

/** Resolves true when the dependency answers; false, a rejection or no answer within CHECK_TIMEOUT_MS is failing. */
export type Check = () => Promise<boolean>;
export type Checks = { database?: Check; storage?: Check };
export const CHECK_TIMEOUT_MS = 2000;

const State = z.enum(["ok", "failing", "not_configured"]);
const Readiness = z.object({
  status: z.enum(["ready", "not_ready"]),
  dependencies: z.object({ database: State, storage: State }),
});

async function state(check: Check | undefined): Promise<z.infer<typeof State>> {
  if (!check) return "not_configured";
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<false>((resolve) => {
    timer = setTimeout(resolve, CHECK_TIMEOUT_MS, false);
  });
  try {
    return (await Promise.race([check(), late])) ? "ok" : "failing";
  } catch {
    return "failing";
  } finally {
    clearTimeout(timer);
  }
}

export const health: FastifyPluginAsyncZod<{ checks: Checks }> = async (app, { checks }) => {
  const Alive = z.object({ status: z.literal("ok") });
  app.get("/healthz", { schema: { response: { 200: Alive } } }, async () => ({ status: "ok" as const }));
  app.get("/readyz", { schema: { response: { 200: Readiness, 503: Readiness } } }, async (_request, reply) => {
    const [database, storage] = await Promise.all([state(checks.database), state(checks.storage)]);
    const dependencies = { database, storage };
    const ready = !Object.values(dependencies).includes("failing");
    return reply.code(ready ? 200 : 503).send({ status: ready ? "ready" : "not_ready", dependencies });
  });
};
