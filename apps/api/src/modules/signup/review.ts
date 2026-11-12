// A person at Pageinator reviews each new paper's application by hand (scripts/review-paper.ts): list the waiting ones,
// approve one (bootstrapOrg makes the organisation, its Owner and its first publication, audited as org.bootstrap; the
// Owner gets bootstrap's one welcome email (choosing the password confirms the address), and ours with the sign-in link that
// leads to /onboarding), or refuse one (a plain email, with the reason when one is given). Each decision is kept on the
// application: who decided (the operator's name) and when.
import type { Database } from "../../db/pools.ts";
import type { Auth } from "../identity/auth.ts";
import type { Mailer } from "../notifications/mailer.ts";
import { bootstrapOrg } from "../people/bootstrap.ts";
import { approvedEmail, refusedEmail } from "./emails.ts";
import { type Application, signupStore } from "../../db/paper-signup.ts";

export class ReviewError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A slug from the paper's name: lower-case ASCII letters and digits joined by hyphens; "" when none are left (a name
 * in Devanagari: the operator gives one). */
export function slugOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
}

export type ReviewDeps = { auth: Auth; database: Database; mailer: Mailer; origin: string };

export function reviewer({ auth, database, mailer, origin }: ReviewDeps) {
  const store = signupStore(database.auth);
  const waiting = async (id: string): Promise<Application> => {
    if (!UUID.test(id)) throw new ReviewError(`${id} is not an application id.`);
    const found = await store.get(id);
    if (!found) throw new ReviewError(`There is no application ${id}.`);
    if (found.state !== "waiting")
      throw new ReviewError(`Application ${id} is ${found.state}, not waiting for approval.`);
    return found;
  };
  /** The organisation with this slug whose owner is the applicant: an earlier approval's, cut short (a crash between
   * the bootstrap and the decision). Another's slug is not this: the bootstrap then refuses it. */
  const madeBefore = async (slug: string, email: string) => {
    const context = await auth.$context;
    const org = await context.adapter.findOne<{ id: string }>({
      model: "organization",
      where: [{ field: "slug", value: slug }],
    });
    const user = (await context.internalAdapter.findUserByEmail(email))?.user;
    if (!org || !user) return null;
    const member = await context.adapter.findOne<{ role: string }>({
      model: "member",
      where: [
        { field: "organizationId", value: org.id },
        { field: "userId", value: user.id },
      ],
    });
    return member?.role === "owner" ? { orgId: org.id, ownerId: user.id, publicationId: null } : null;
  };
  return {
    /** The applications waiting for a decision (or, with every, all of them), oldest first. */
    list: (every = false) => store.list(every ? ["unconfirmed", "waiting", "approved", "refused"] : ["waiting"]),

    async approve(id: string, by: string, slug?: string) {
      const application = await waiting(id);
      const chosen = slug ?? slugOf(application.paperName);
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(chosen) || chosen.length > 64) {
        throw new ReviewError("The paper's name gives no slug: give one with --slug (a-z, 0-9 and hyphens).");
      }
      // made already, for this application, by an approval that stopped before it was recorded: recorded now
      const made =
        (await madeBefore(chosen, application.email)) ??
        (await bootstrapOrg(
          auth,
          mailer,
          database,
          {
            owner: { name: application.ownerName, email: application.email },
            organization: { name: application.paperName, slug: chosen },
            publication: {
              name: application.paperName,
              slug: chosen,
              languages: [application.language],
              primaryLanguage: application.language,
              digitStyle: application.language === "mr" ? "devanagari" : "latin",
            },
          },
          `review-paper:${id}`,
        ));
      const decided = await store.decide(id, by, { state: "approved", orgId: made.orgId });
      if (!decided) throw new ReviewError(`Application ${id} was decided by someone else meanwhile.`);
      const url = `${origin}/login?returnTo=${encodeURIComponent("/onboarding")}`;
      mailer.send({ to: application.email, ...approvedEmail({ ...application, url }) });
      return { application: decided, ...made };
    },

    async refuse(id: string, by: string, reason: string | null) {
      const application = await waiting(id);
      const decided = await store.decide(id, by, { state: "refused", reason });
      if (!decided) throw new ReviewError(`Application ${id} was decided by someone else meanwhile.`);
      mailer.send({ to: application.email, ...refusedEmail({ ...application, reason }) });
      return decided;
    },
  };
}

/** The command line: list [--all] | approve <id> [--slug s] | refuse <id> [reason]; the operator from --by or
 * PGN_OPERATOR. A usage problem gives its message. */
export type ReviewCommand =
  | { command: "list"; all: boolean }
  | { command: "approve"; id: string; by: string; slug?: string }
  | { command: "refuse"; id: string; by: string; reason: string | null };

export const USAGE =
  "Usage: review-paper list [--all] | approve <id> [--slug <slug>] | refuse <id> [reason]  (--by <name> or PGN_OPERATOR)";

export function parseReview(args: readonly string[], env: Record<string, string | undefined>): ReviewCommand | string {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--all") flags.all = true;
    else if (arg === "--by" || arg === "--slug") {
      const value = args[++i];
      if (value === undefined || value.trim() === "") return `${arg} needs a value. ${USAGE}`;
      flags[arg.slice(2)] = value.trim();
    } else if (arg.startsWith("--")) return `Unknown option ${arg}. ${USAGE}`;
    else positional.push(arg);
  }
  const [command, id, ...rest] = positional;
  if (command === "list" && id === undefined) return { command: "list", all: flags.all === true };
  if ((command !== "approve" && command !== "refuse") || id === undefined) return USAGE;
  const by = typeof flags.by === "string" ? flags.by : (env.PGN_OPERATOR ?? "").trim();
  if (by === "" || by.length > 200) return `Say who decides: --by <name> or PGN_OPERATOR. ${USAGE}`;
  if (command === "approve") {
    if (rest.length > 0) return USAGE;
    return { command, id, by, ...(typeof flags.slug === "string" ? { slug: flags.slug } : {}) };
  }
  const reason = rest.join(" ").trim();
  if (reason.length > 2000) return "The reason is longer than 2000 characters.";
  return { command, id, by, reason: reason === "" ? null : reason };
}
