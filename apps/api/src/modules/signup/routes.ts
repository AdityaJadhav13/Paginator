// A new paper signs up (packages/contracts/src/signup.ts):
//   - POST /api/v1/signup/paper (open to anyone): keeps an application (identity.paper_application, src/db/paper-signup.ts)
//     and emails a link to confirm the address. Protected like the contact form (src/modules/contact/routes.ts): the
//     API's per-address budget first; then per address SIGNUP_PER_HOUR and SIGNUP_PER_DAY, and SIGNUP_PER_DAY_ALL from
//     every address together (429 signup_limit, read first and counted once the request was kept or dropped); a trap
//     field and a minimum fill time drop it after a pause like a real one's. The answer is always {received: true}:
//     an address with an application open already is not told apart (no second email goes then, and mail goes in the
//     background, so the answer takes no longer either way). An address with an account may apply for a new paper:
//     its owner is that account (bootstrapOrg uses it), once an operator approves.
//   - POST /api/v1/signup/paper/confirm (open to anyone): the link's token, once, within CONFIRM_TTL_MS; the application
//     then waits for a person at Pageinator (scripts/review-paper.ts). A token unknown, used or expired: 404 not_found.
//   - GET /api/v1/orgs/:o/pubs/:p/paper (publication.view): the publication's name and languages, for /onboarding.
// The log says only that an application was kept, dropped or confirmed, with its language: never a name or an email.
import {
  CONTACT_MIN_FILL_MS,
  PaperDetails,
  PaperSignupAccepted,
  PaperSignupConfirm,
  PaperSignupConfirmed,
  PaperSignupRequest,
} from "@pageinator/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Database } from "../../db/pools.ts";
import { ApiError } from "../../http/errors.ts";
import { accessOf, auditRefusals } from "../access/access.ts";
import type { Mailer } from "../notifications/mailer.ts";
import { confirmEmail } from "./emails.ts";
import { signupStore } from "../../db/paper-signup.ts";

export const SIGNUP_PER_HOUR = 3;
export const SIGNUP_PER_DAY = 10;
export const SIGNUP_PER_DAY_ALL = 100;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export type SignupOptions = {
  database: Database;
  mailer: Mailer;
  /** The web app's public origin: the confirmation link leads there (/signup?confirm=…). */
  origin: string;
  /** For tests: smaller limits, and no pause before a dropped application's answer. */
  limits?: { perHour: number; perDay: number; perDayAll: number };
  dropPause?: () => number;
};

type Check = ReturnType<FastifyInstance["createRateLimit"]>;

async function notUsedUp(check: Check, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const limit = await check(request, { increment: false });
  if (limit.isAllowed || limit.remaining > 0) return;
  reply.header("retry-after", Math.max(1, limit.ttlInSeconds));
  throw new ApiError("signup_limit");
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const Pub = z.strictObject({ o: z.string(), p: z.string() });

export const signupRoutes: FastifyPluginAsyncZod<SignupOptions> = async (app, options) => {
  const { database, mailer, origin } = options;
  const store = signupStore(database.auth);
  const limits = options.limits ?? { perHour: SIGNUP_PER_HOUR, perDay: SIGNUP_PER_DAY, perDayAll: SIGNUP_PER_DAY_ALL };
  const dropPause = options.dropPause ?? (() => 300 + Math.floor(Math.random() * 600));
  const hourly = app.createRateLimit({ max: limits.perHour, timeWindow: HOUR_MS });
  const daily = app.createRateLimit({ max: limits.perDay, timeWindow: DAY_MS });
  const everyone = app.createRateLimit({ max: limits.perDayAll, timeWindow: DAY_MS, keyGenerator: () => "signup" });
  auditRefusals(app, database);

  app.post(
    "/api/v1/signup/paper",
    {
      config: { access: "public" },
      bodyLimit: 4096,
      schema: { body: PaperSignupRequest, response: { 200: PaperSignupAccepted } },
    },
    async (request, reply) => {
      const body = request.body;
      await notUsedUp(hourly, request, reply);
      await notUsedUp(daily, request, reply);
      await notUsedUp(everyone, request, reply);
      await hourly(request);
      await daily(request);
      if (body.website !== "" || body.filledInMs < CONTACT_MIN_FILL_MS) {
        await pause(dropPause());
        request.log.info(
          { language: body.language, reason: body.website !== "" ? "trap" : "too-fast" },
          "signup: dropped",
        );
        return { received: true as const };
      }
      await everyone(request);
      const token = await store.apply(body);
      if (token !== null) {
        const url = `${origin}/signup?confirm=${token}`;
        mailer.send({ to: body.email, ...confirmEmail({ ...body, url }) });
      }
      request.log.info({ language: body.language }, "signup: kept");
      return { received: true as const };
    },
  );

  app.post(
    "/api/v1/signup/paper/confirm",
    { config: { access: "public" }, schema: { body: PaperSignupConfirm, response: { 200: PaperSignupConfirmed } } },
    async (request) => {
      const confirmed = await store.confirm(request.body.token);
      if (!confirmed) throw new ApiError("not_found");
      request.log.info({ language: confirmed.language }, "signup: confirmed");
      return { state: "waiting" as const };
    },
  );

  app.get(
    "/api/v1/orgs/:o/pubs/:p/paper",
    { config: { permission: "publication.view" }, schema: { params: Pub, response: { 200: PaperDetails } } },
    async (request) => {
      const access = accessOf(request);
      const row = await database.withTenant(access.tenant, (tx) =>
        tx
          .selectFrom("app.publication")
          .select(["name", "languages", "primary_language"])
          .where("id", "=", request.params.p)
          .executeTakeFirst(),
      );
      if (!row) throw new ApiError("not_found");
      return { name: row.name, languages: row.languages, primaryLanguage: row.primary_language };
    },
  );
};
