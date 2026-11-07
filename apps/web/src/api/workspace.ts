/**
 * The person's workspace from the API's `/me` (docs/product/10-l2-newsroom-plan.md §5.2): their organisations, their
 * roles and grants on each publication, and each organisation's two-step rule, checked against the API's own schema
 * (@pageinator/contracts `Me`). The active organisation and publication are this browser's choice, remembered here
 * for the person who made it (and forgotten at sign-out, so the next person on a shared computer starts from their own
 * /me), and fall back to the first ones /me lists.
 */
import { Me } from "@pageinator/contracts";
import type {
  ApiProblem,
  OrgAccessDto,
  ServiceResult,
  WorkspaceAccessDto,
  WorkspaceAccessService,
  WorkspaceQueryService,
} from "../services/index.ts";
import { grantsOf } from "../services/index.ts";
import type { ApiClient } from "./client.ts";

/** The browser storage key that remembers the last organisation and publication. */
export const WORKSPACE_STORAGE_KEY = "pageinator.workspace";

const UNEXPECTED: ApiProblem = { kind: "answer", status: 200, code: "unexpected_answer", message: "" };
/** A choice /me does not list: the API's answer for an organisation the person is not in. */
const NOT_FOUND: ApiProblem = { kind: "answer", status: 404, code: "not_found", message: "" };

interface Remembered {
  readonly organizationId?: string;
  readonly publicationId?: string;
}

/** The choice remembered for this person; another person's is ignored. */
function remembered(userId: string): Remembered {
  try {
    const value = JSON.parse(window.localStorage.getItem(WORKSPACE_STORAGE_KEY) ?? "{}") as unknown;
    if (typeof value !== "object" || value === null || (value as { userId?: unknown }).userId !== userId) return {};
    const { organizationId, publicationId } = value as Remembered;
    return { ...(organizationId ? { organizationId } : {}), ...(publicationId ? { publicationId } : {}) };
  } catch {
    return {};
  }
}

function remember(userId: string, choice: Remembered): void {
  try {
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({ userId, ...choice }));
  } catch {
    // the choice then lasts until the page is closed
  }
}

function forgetChoice(): void {
  try {
    window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
  } catch {
    // nothing was kept
  }
}

/** The workspace /me gives, with the remembered (or else the first) organisation and publication active. */
export function workspaceFrom(organizations: readonly OrgAccessDto[], choice: Remembered): WorkspaceAccessDto | null {
  const org = organizations.find((candidate) => candidate.org.id === choice.organizationId) ?? organizations[0];
  if (!org) return null;
  const publication =
    org.publications.find((candidate) => candidate.id === choice.publicationId) ?? org.publications[0];
  return {
    access: grantsOf(organizations),
    activeOrganizationId: org.org.id,
    activePublicationId: publication?.id ?? "",
    organizations,
  };
}

export function createApiWorkspace(client: ApiClient): {
  access: WorkspaceAccessService;
  workspace: WorkspaceQueryService;
  /** Sign-out: drops the cached /me and the remembered choice. */
  forget: () => void;
} {
  /** The last /me, and whose it was. */
  let last: { readonly userId: string; readonly organizations: readonly OrgAccessDto[] } | null = null;

  async function load(): Promise<ServiceResult<readonly OrgAccessDto[], ApiProblem>> {
    const answer = await client.get("/api/v1/me");
    if (!answer.ok) return { ok: false, error: answer.problem };
    const me = Me.safeParse(answer.value);
    if (!me.success) return { ok: false, error: UNEXPECTED };
    last = { userId: me.data.user.id, organizations: me.data.memberships };
    return { ok: true, value: last.organizations };
  }

  function choose(userId: string, organizationId: string, publicationId?: string): ServiceResult<WorkspaceAccessDto, ApiProblem> {
    const organizations = last?.userId === userId ? last.organizations : null;
    const org = organizations?.find((candidate) => candidate.org.id === organizationId);
    if (!organizations || !org) return { ok: false, error: NOT_FOUND };
    if (publicationId !== undefined && !org.publications.some((publication) => publication.id === publicationId)) {
      return { ok: false, error: NOT_FOUND };
    }
    const choice = { organizationId, ...(publicationId !== undefined ? { publicationId } : {}) };
    remember(userId, choice);
    const workspace = workspaceFrom(organizations, choice);
    return workspace ? { ok: true, value: workspace } : { ok: false, error: NOT_FOUND };
  }

  const access: WorkspaceAccessService = {
    async getAccess() {
      const loaded = await load();
      if (!loaded.ok) return loaded;
      return { ok: true, value: workspaceFrom(loaded.value, remembered(last?.userId ?? "")) };
    },
    selectOrganization: async ({ userId, organizationId }) => choose(userId, organizationId),
    selectPublication: async ({ userId, organizationId, publicationId }) => choose(userId, organizationId, publicationId),
  };

  async function organizations(): Promise<readonly OrgAccessDto[] | null> {
    if (last) return last.organizations;
    const loaded = await load();
    return loaded.ok ? loaded.value : null;
  }
  const unavailable = (resource: "organization" | "publication" | "edition") => ({
    ok: false as const,
    error: {
      code: "unavailable" as const,
      resource,
      displayMessage:
        resource === "organization"
          ? "This organization is not available."
          : resource === "publication"
            ? "This publication is not available in this organization."
            : "This edition is not available in this publication.",
    },
  });
  const failed = {
    ok: false as const,
    error: {
      code: "temporary-failure" as const,
      displayMessage: "The workspace could not be loaded from the API.",
    },
  };
  // The publications' languages are not in /me yet (a publications endpoint comes later): the workspace chrome is in
  // the interface language, so a publication is marked with no content language of its own.
  const publicationDto = (orgId: string, publication: OrgAccessDto["publications"][number]) => ({
    id: publication.id,
    orgId,
    name: publication.name,
    locale: "",
    direction: "ltr" as const,
  });

  const workspace: WorkspaceQueryService = {
    async listOrganizations() {
      const orgs = await organizations();
      return orgs ? { ok: true, value: orgs.map((org) => ({ id: org.org.id, name: org.org.name })) } : failed;
    },
    async getOrganization({ organizationId }) {
      const orgs = await organizations();
      if (!orgs) return failed;
      const org = orgs.find((candidate) => candidate.org.id === organizationId);
      return org ? { ok: true, value: { id: org.org.id, name: org.org.name } } : unavailable("organization");
    },
    async listPublications({ organizationId }) {
      const orgs = await organizations();
      if (!orgs) return failed;
      const org = orgs.find((candidate) => candidate.org.id === organizationId);
      return org
        ? { ok: true, value: org.publications.map((publication) => publicationDto(org.org.id, publication)) }
        : unavailable("organization");
    },
    async getPublication({ organizationId, publicationId }) {
      const orgs = await organizations();
      if (!orgs) return failed;
      const org = orgs.find((candidate) => candidate.org.id === organizationId);
      if (!org) return unavailable("organization");
      const publication = org.publications.find((candidate) => candidate.id === publicationId);
      return publication ? { ok: true, value: publicationDto(org.org.id, publication) } : unavailable("publication");
    },
    // the edition workspace (its tabs and editor) is a development placeholder; the editions list has its own service
    getEdition: async () => unavailable("edition"),
  };

  return {
    access,
    workspace,
    forget: () => {
      last = null;
      forgetChoice();
    },
  };
}
