/**
 * The settings double, answered as the API's settings routes answer (apps/api/src/modules/settings/routes.ts):
 * organization settings and adding a publication for org.settings (Owner, Admin), a publication's settings read with
 * settings.view and changed with settings.edit; 404 for an organisation or publication the person does not reach, 403
 * two_step_required, 403 not_allowed, 400 as the API checks the input. Fictional data only.
 */
import type {
  ApiProblem,
  OrgSettingsDto,
  PublicationSettingsDto,
  ServiceResult,
  SettingsService,
} from "../services/index.ts";
import { reach, type Permission, type PublicationAccess } from "../services/permissions.ts";
import type { MockOrgStanding } from "./create-mock-notifications.ts";

export type MockSettingsOperation =
  | "settings.org"
  | "settings.renameOrg"
  | "settings.addPublication"
  | "settings.publication"
  | "settings.setPublication";

export interface MockSettingsDeps {
  person(): { readonly userId: string } | undefined;
  orgStanding(userId: string, orgId: string): MockOrgStanding | undefined;
  /** undefined: the publication is not one the person reaches. */
  standing(
    userId: string,
    orgId: string,
    pubId: string,
  ): { readonly orgRole: MockOrgStanding["orgRole"]; readonly access: PublicationAccess; readonly twoStepBlocked: boolean } | undefined;
  gate(operation: MockSettingsOperation): Promise<ApiProblem | undefined>;
  signedOut<T>(): ServiceResult<T, ApiProblem>;
  orgName(orgId: string): string;
  renameOrg(orgId: string, name: string): void;
  publications(orgId: string): readonly { readonly id: string; readonly name: string }[];
  renamePublication(pubId: string, name: string): void;
  addPublication(orgId: string, pubId: string, name: string): void;
}

type Answer = Extract<ApiProblem, { kind: "answer" }>;
const answer = (status: number, code: string, message: string): Answer => ({ kind: "answer", status, code, message, requestId: "mock-request" });
const NOT_FOUND = answer(404, "not_found", "There is nothing here, or you do not have access to it.");
const NOT_ALLOWED = answer(403, "not_allowed", "Your role cannot do this. Ask an editor or the owner.");
const TWO_STEP = answer(403, "two_step_required", "Your role needs two-step sign-in. Set it up in Account → Security.");
/** The keys a publication settings change may carry (contracts PublicationSettingsInput, a strict object). */
const CHANGEABLE = new Set(["name", "languages", "primaryLanguage", "timezone"]);
const invalid = (field: string, message: string): Answer => ({ ...answer(400, "invalid_request", "Some fields are not right."), details: [{ field, message }] });
const fail = <T,>(error: ApiProblem): ServiceResult<T, ApiProblem> => ({ ok: false, error: { ...error } });

/** The API's name check: trimmed, one line, 1 to 200 characters. */
const cleanName = (value: string) => value.normalize("NFC").trim();
const badName = (name: string) => name === "" || name.length > 200 || name.includes("\n");
const TIMEZONES = new Set(["Asia/Kolkata", "Asia/Calcutta", "Asia/Dubai", "UTC", "Europe/London"]);

export function createMockSettings(deps: MockSettingsDeps) {
  /** Each publication's languages and timezone, once changed (the demo's start as Marathi first, in India). */
  let kept = new Map<string, Omit<PublicationSettingsDto, "id" | "name">>();
  let added = 0;

  const settingsOf = (id: string, name: string): PublicationSettingsDto => ({
    id,
    name,
    ...(kept.get(id) ?? { languages: ["mr", "en"], primaryLanguage: "mr", timezone: "Asia/Kolkata" }),
  });
  const orgSettings = (orgId: string): OrgSettingsDto => ({
    name: deps.orgName(orgId),
    publications: [...deps.publications(orgId)]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((pub) => settingsOf(pub.id, pub.name)),
  });

  async function orgCheck<T>(operation: MockSettingsOperation, orgId: string): Promise<ServiceResult<T, ApiProblem> | null> {
    const problem = await deps.gate(operation);
    if (problem) return fail(problem);
    const person = deps.person();
    if (!person) return deps.signedOut();
    const standing = deps.orgStanding(person.userId, orgId);
    if (!standing) return fail(NOT_FOUND);
    if (standing.twoStepBlocked) return fail(TWO_STEP);
    if (reach("org.settings", standing.orgRole, standing.union) === null) return fail(NOT_ALLOWED);
    return null;
  }

  async function pubCheck<T>(
    operation: MockSettingsOperation,
    permission: Permission,
    orgId: string,
    pubId: string,
  ): Promise<ServiceResult<T, ApiProblem> | null> {
    const problem = await deps.gate(operation);
    if (problem) return fail(problem);
    const person = deps.person();
    if (!person) return deps.signedOut();
    const standing = deps.standing(person.userId, orgId, pubId);
    if (!standing) return fail(NOT_FOUND);
    if (standing.twoStepBlocked) return fail(TWO_STEP);
    if (reach(permission, standing.orgRole, standing.access) === null) return fail(NOT_ALLOWED);
    return null;
  }

  const settings: SettingsService = {
    async getOrg({ orgId }) {
      return (await orgCheck<OrgSettingsDto>("settings.org", orgId)) ?? { ok: true, value: orgSettings(orgId) };
    },
    async renameOrg({ orgId, name }) {
      const refused = await orgCheck<OrgSettingsDto>("settings.renameOrg", orgId);
      if (refused) return refused;
      const clean = cleanName(name);
      if (badName(clean)) return fail(invalid("body.name", "must be one line, not empty"));
      deps.renameOrg(orgId, clean);
      return { ok: true, value: orgSettings(orgId) };
    },
    async addPublication({ orgId, publication }) {
      const refused = await orgCheck<OrgSettingsDto>("settings.addPublication", orgId);
      if (refused) return refused;
      const name = cleanName(publication.name);
      if (badName(name)) return fail(invalid("body.name", "must be one line, not empty"));
      if (deps.publications(orgId).some((pub) => pub.name.toLowerCase() === name.toLowerCase())) {
        return fail(invalid("body.name", "a publication of the organisation has this name"));
      }
      const languages = [...new Set(publication.languages)];
      if (languages.length === 0) return fail(invalid("body.languages", "too small"));
      if (!languages.includes(publication.primaryLanguage)) {
        return fail(invalid("body.primaryLanguage", "must be one of the languages"));
      }
      const timezone = publication.timezone ?? "Asia/Kolkata";
      if (!TIMEZONES.has(timezone)) return fail(invalid("body.timezone", "is not a timezone the database knows"));
      added += 1;
      const id = `pub-demo-added-${added}`;
      deps.addPublication(orgId, id, name);
      kept.set(id, { languages, primaryLanguage: publication.primaryLanguage, timezone });
      return { ok: true, value: orgSettings(orgId) };
    },
    async getPublication({ orgId, pubId }) {
      const refused = await pubCheck<PublicationSettingsDto>("settings.publication", "settings.view", orgId, pubId);
      if (refused) return refused;
      const pub = deps.publications(orgId).find((candidate) => candidate.id === pubId);
      return pub ? { ok: true, value: settingsOf(pub.id, pub.name) } : fail(NOT_FOUND);
    },
    async setPublication({ orgId, pubId, change }) {
      const refused = await pubCheck<PublicationSettingsDto>("settings.setPublication", "settings.edit", orgId, pubId);
      if (refused) return refused;
      const pub = deps.publications(orgId).find((candidate) => candidate.id === pubId);
      if (!pub) return fail(NOT_FOUND);
      // the API's body is strict: a key it does not know is refused, as there
      const unknown = Object.keys(change).find((key) => !CHANGEABLE.has(key));
      if (unknown) return fail(invalid("body", `Unrecognized key: "${unknown}"`));
      const now = settingsOf(pub.id, pub.name);
      const name = change.name === undefined ? now.name : cleanName(change.name);
      if (badName(name)) return fail(invalid("body.name", "must be one line, not empty"));
      const primaryLanguage = change.primaryLanguage ?? now.primaryLanguage;
      const languages = [...new Set(change.languages ?? now.languages)];
      if (languages.length === 0) return fail(invalid("body.languages", "too small"));
      if (!languages.includes(primaryLanguage)) return fail(invalid("body.primaryLanguage", "must be one of the languages"));
      const timezone = change.timezone ?? now.timezone;
      if (timezone !== now.timezone && !TIMEZONES.has(timezone)) {
        return fail(invalid("body.timezone", "is not a timezone the database knows"));
      }
      if (name !== now.name) deps.renamePublication(pubId, name);
      kept.set(pubId, { languages, primaryLanguage, timezone });
      return { ok: true, value: settingsOf(pubId, name) };
    },
  };

  return {
    settings,
    reset() {
      kept = new Map();
      added = 0;
    },
  };
}
