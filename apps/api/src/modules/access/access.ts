// Who may use an /api/v1 route (docs/product/10-l2-newsroom-plan.md §3.2, §4.2, §4.4). Every route declares, in its
// config, either `access: "public"`, `access: "signed_in"`, or the one `permission` it needs: the app refuses to
// register one that does not, and a meta-test walks the router's table after ready() (test/db/people.test.ts). The
// check goes by the route's pattern, not the request's URL, so no spelling of a path (%76 for v, say) reaches a
// handler around it. For a permission, on a route under /api/v1/orgs/:o (and /pubs/:p):
//   1. no session: 401 signed_out;
//   2. no membership of the organisation (Better Auth's identity.member, read on the auth pool): 404, as for an
//      organisation that does not exist;
//   3. a role the organisation requires two-step sign-in for, without it: 403 two_step_required;
//   4. a publication the person does not reach: 404;
//   5. the permission missing: 403 not_allowed, recorded in the audit log.
// The publications a person reaches are every one of the organisation for Owner and Admin, and those of their
// publication_grant rows for everyone else, read under the organisation wall (app, pgn_app). request.access then
// carries the tenant for withTenant, the person's roles, and how far the permission reaches ("scoped" for a ◐ cell).
import {
  ORG_ROLES,
  type OrgRole,
  type Permission,
  PERMISSIONS,
  type PublicationAccess,
  type PublicationRole,
  type Reach,
  reach,
} from "@pageinator/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Database } from "../../db/pools.ts";
import type { Tenant } from "../../db/tenant.ts";
import { ApiError } from "../../http/errors.ts";
import type { Actor } from "../identity/session.ts";

declare module "fastify" {
  interface FastifyContextConfig {
    /** The permission the route needs (src/modules/access/access.ts). */
    permission?: Permission;
    /** Instead of a permission: anyone (rate-limited), or any signed-in person. */
    access?: "public" | "signed_in";
  }
  interface FastifyRequest {
    /** Set by the access check on routes that declare a permission. */
    access: Access | null;
  }
  interface FastifyInstance {
    /** Every /api/v1 route as registered, with its declaration (for the route-table meta-test). */
    readonly apiRoutes: readonly ApiRoute[];
  }
}

export type ApiRoute = { method: string; url: string; access: unknown; permission: unknown };

/** Whether a route's pattern is an /api/v1 one. */
export const isApiRoute = (pattern: string | undefined) => pattern?.startsWith("/api/v1/") === true;

export type Access = {
  tenant: Tenant;
  orgRole: OrgRole;
  /** The person's roles and grants on each publication they reach (empty for Owner and Admin, who reach all). */
  publications: ReadonlyMap<string, PublicationAccess>;
  /** How far the route's permission reaches: "scoped" leaves the rule of a ◐ cell to the service. */
  reach: Reach;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Better Auth keeps a member's roles as one string ("owner", or several joined by commas): the strongest counts. */
export function orgRoleOf(stored: string): OrgRole | null {
  const roles = stored.split(",").map((role) => role.trim());
  return ORG_ROLES.find((role) => roles.includes(role)) ?? null;
}

/** Whether the organisation's two-step rule applies to someone with these roles (org_settings.mfa_required_roles). */
export function needsTwoStep(required: readonly string[], orgRole: OrgRole, roles: Iterable<string>): boolean {
  if (required.includes(orgRole)) return true;
  for (const role of roles) if (required.includes(role)) return true;
  return false;
}

export type OrgView = {
  orgRole: OrgRole;
  mfaRequiredRoles: string[];
  publications: Map<string, PublicationAccess>;
  /** Every publication of the organisation, with its name. */
  allPublications: { id: string; name: string }[];
};

/** A member's view of an organisation: their role, its two-step rule, and the publications they reach. Null when
 * they are not a member (or the organisation was never set up in app). */
export async function orgView(
  database: Database,
  actor: Actor,
  orgId: string,
  requestId: string,
): Promise<OrgView | null> {
  const membership = await database.identity.membership(orgId, actor.userId);
  const orgRole = membership ? orgRoleOf(membership.role) : null;
  if (!orgRole) return null;
  const tenant: Tenant = { orgId, userId: actor.userId, pubIds: [], requestId };
  return database.withTenant(tenant, async (tx) => {
    const settings = await tx.selectFrom("app.org_settings").select("mfa_required_roles").executeTakeFirst();
    if (!settings) return null;
    const allPublications = await tx.selectFrom("app.publication").select(["id", "name"]).orderBy("name").execute();
    const grants = await tx
      .selectFrom("app.publication_grant")
      .select(["publication_id", "roles", "grants"])
      .where("user_id", "=", actor.userId)
      .execute();
    const publications = new Map<string, PublicationAccess>();
    if (orgRole === "owner" || orgRole === "admin") {
      for (const pub of allPublications) publications.set(pub.id, { roles: [], grants: [] });
    }
    for (const grant of grants) {
      publications.set(grant.publication_id, {
        roles: grant.roles as PublicationRole[],
        grants: grant.grants as PublicationAccess["grants"],
      });
    }
    return { orgRole, mfaRequiredRoles: settings.mfa_required_roles, publications, allPublications };
  });
}

/** The union of a person's roles and grants on every publication they reach (for an organisation-wide permission). */
function union(publications: ReadonlyMap<string, PublicationAccess>): PublicationAccess {
  const roles = new Set<PublicationRole>();
  const grants = new Set<PublicationAccess["grants"][number]>();
  for (const access of publications.values()) {
    for (const role of access.roles) roles.add(role);
    for (const grant of access.grants) grants.add(grant);
  }
  return { roles: [...roles], grants: [...grants] };
}

async function refuse(
  database: Database,
  request: FastifyRequest,
  tenant: Tenant,
  permission: Permission,
): Promise<never> {
  await database.withTenant(tenant, async (tx) => {
    await tx
      .insertInto("app.audit_event")
      .values({
        org_id: tenant.orgId,
        actor_kind: "user",
        actor_id: tenant.userId,
        action: "access.denied",
        target_type: "route",
        data: JSON.stringify({ permission, method: request.method, route: request.routeOptions.url ?? "" }),
        ip: request.ip,
        user_agent: request.headers["user-agent"]?.slice(0, 512) ?? null,
        request_id: tenant.requestId,
      })
      .execute();
  });
  throw new ApiError("not_allowed");
}

export async function decide(database: Database, request: FastifyRequest, permission: Permission): Promise<Access> {
  const actor = request.actor;
  if (!actor) throw new ApiError("signed_out");
  const params = (request.params ?? {}) as { o?: unknown; p?: unknown };
  const orgId = typeof params.o === "string" ? params.o : "";
  const pubId = typeof params.p === "string" ? params.p : undefined;
  if (!UUID.test(orgId) || (pubId !== undefined && !UUID.test(pubId))) throw new ApiError("not_found");
  const view = await orgView(database, actor, orgId, request.id);
  if (!view) throw new ApiError("not_found");
  const everyRole = [...view.publications.values()].flatMap((access) => access.roles);
  if (needsTwoStep(view.mfaRequiredRoles, view.orgRole, everyRole) && !actor.twoStep) {
    throw new ApiError("two_step_required");
  }
  if (pubId !== undefined && !view.publications.has(pubId)) throw new ApiError("not_found");
  const tenant: Tenant = { orgId, userId: actor.userId, pubIds: [...view.publications.keys()], requestId: request.id };
  const rule = PERMISSIONS[permission];
  const here =
    rule.scope === "publication" && pubId !== undefined
      ? (view.publications.get(pubId) ?? { roles: [], grants: [] })
      : union(view.publications);
  const reached = reach(permission, view.orgRole, here);
  if (!reached) return refuse(database, request, tenant, permission);
  return { tenant, orgRole: view.orgRole, publications: view.publications, reach: reached };
}

/** The check, on every /api/v1 request, after the session is read (identity's preHandler). */
export function registerAccess(app: FastifyInstance, database: Database): void {
  app.decorateRequest("access", null);
  const routes: ApiRoute[] = [];
  app.decorate("apiRoutes", routes);
  // every /api/v1 route declares exactly one of access and permission, or the app does not start
  app.addHook("onRoute", (route) => {
    if (!isApiRoute(route.url)) return;
    const config = (route.config ?? {}) as { access?: unknown; permission?: unknown };
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      routes.push({ method, url: route.url, access: config.access, permission: config.permission });
    }
    const declared = [config.access, config.permission].filter((value) => value !== undefined);
    const known = config.permission === undefined || Object.hasOwn(PERMISSIONS, String(config.permission));
    const access = config.access === undefined || config.access === "public" || config.access === "signed_in";
    if (declared.length !== 1 || !known || !access) {
      throw new Error(`${route.method} ${route.url} must declare one access ("public", "signed_in") or permission`);
    }
  });
  app.addHook("preHandler", async (request) => {
    if (request.is404 || !isApiRoute(request.routeOptions.url)) return;
    const config = request.routeOptions.config;
    if (config.access === "public") return;
    if (!request.actor) throw new ApiError("signed_out");
    if (config.access === "signed_in") return;
    // a route without a declaration is refused (none can be registered)
    if (!config.permission) throw new ApiError("not_found");
    request.access = await decide(database, request, config.permission);
  });
}

/** The signed-in person of a route that declares `access: "signed_in"` or a permission. */
export function actorOf(request: FastifyRequest): Actor {
  if (!request.actor) throw new ApiError("signed_out");
  return request.actor;
}

/** The access check's result, on a route that declares a permission. */
export function accessOf(request: FastifyRequest): Access {
  if (!request.access) throw new ApiError("not_found");
  return request.access;
}
