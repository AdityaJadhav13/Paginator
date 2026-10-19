import type {
  EditionDto,
  OrganizationDto,
  PublicationDto,
  ServiceError,
  ServiceResult,
  UnavailableResource,
  UserDto,
  UserQueryService,
  WorkspaceQueryService,
} from "../services/index.ts";
import { createCanonicalSeed, type MockSeedSnapshot } from "./seed.ts";
import {
  copyScenario,
  scenarioApplies,
  validateScenario,
  type MockOperation,
  type MockScenario,
  type MockScenarioController,
} from "./scenarios.ts";

export type Delay = (milliseconds: number) => Promise<void>;

export interface CreateMockServiceEnvironmentOptions {
  readonly delay?: Delay;
}

export interface MockServiceEnvironment {
  readonly users: UserQueryService;
  readonly workspace: WorkspaceQueryService;
  readonly scenarios: MockScenarioController;
}

const UNAVAILABLE_MESSAGES: Readonly<Record<UnavailableResource, string>> = {
  user: "This user is not available.",
  organization: "This organization is not available.",
  publication: "This publication is not available in this organization.",
  edition: "This edition is not available in this publication.",
};

const DENIED_ERROR: Extract<ServiceError, { code: "denied" }> = {
  code: "denied",
  displayMessage: "This demonstration action is not available in the current context.",
  qualification: "Demonstration only — production authorization is not evaluated here",
};

const TEMPORARY_FAILURE_ERROR: Extract<ServiceError, { code: "temporary-failure" }> = {
  code: "temporary-failure",
  displayMessage: "The demonstration service is temporarily unavailable. Try again.",
};

const defaultDelay: Delay = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

function success<T>(value: T): ServiceResult<T> {
  return { ok: true, value };
}

function unavailable<T>(resource: UnavailableResource): ServiceResult<T> {
  return {
    ok: false,
    error: {
      code: "unavailable",
      resource,
      displayMessage: UNAVAILABLE_MESSAGES[resource],
    },
  };
}

function denied<T>(): ServiceResult<T> {
  return { ok: false, error: { ...DENIED_ERROR } };
}

function temporaryFailure<T>(): ServiceResult<T> {
  return { ok: false, error: { ...TEMPORARY_FAILURE_ERROR } };
}

function cloneRecord<T extends object>(record: T): T {
  return { ...record };
}

function cloneRecords<T extends object>(records: readonly T[]): T[] {
  return records.map(cloneRecord);
}

export function createMockServiceEnvironment(
  options: CreateMockServiceEnvironmentOptions = {}
): MockServiceEnvironment {
  const delay = options.delay ?? defaultDelay;
  let seed: MockSeedSnapshot = createCanonicalSeed();
  let scenario: MockScenario = { mode: "normal" };

  async function scenarioResult<T>(
    operation: MockOperation
  ): Promise<ServiceResult<T> | undefined> {
    const activeScenario = scenario;
    if (!scenarioApplies(activeScenario, operation)) {
      return undefined;
    }
    if (activeScenario.mode === "latency") {
      await delay(activeScenario.delayMs);
      return undefined;
    }
    if (activeScenario.mode === "failure") {
      return temporaryFailure<T>();
    }
    return denied<T>();
  }

  const users: UserQueryService = {
    async getUser({ userId }) {
      const intercepted = await scenarioResult<UserDto>("user.get");
      if (intercepted) return intercepted;

      const user = seed.users.find((candidate) => candidate.id === userId);
      return user ? success(cloneRecord(user)) : unavailable("user");
    },
  };

  const workspace: WorkspaceQueryService = {
    async listOrganizations() {
      const intercepted = await scenarioResult<readonly OrganizationDto[]>(
        "organization.list"
      );
      if (intercepted) return intercepted;

      return success(cloneRecords(seed.organizations));
    },

    async getOrganization({ organizationId }) {
      const intercepted = await scenarioResult<OrganizationDto>("organization.get");
      if (intercepted) return intercepted;

      const organization = seed.organizations.find(
        (candidate) => candidate.id === organizationId
      );
      return organization
        ? success(cloneRecord(organization))
        : unavailable("organization");
    },

    async listPublications({ organizationId }) {
      const intercepted = await scenarioResult<readonly PublicationDto[]>(
        "publication.list"
      );
      if (intercepted) return intercepted;

      const organization = seed.organizations.find(
        (candidate) => candidate.id === organizationId
      );
      if (!organization) return unavailable("organization");

      return success(
        cloneRecords(
          seed.publications.filter((publication) => publication.orgId === organization.id)
        )
      );
    },

    async getPublication({ organizationId, publicationId }) {
      const intercepted = await scenarioResult<PublicationDto>("publication.get");
      if (intercepted) return intercepted;

      const organization = seed.organizations.find(
        (candidate) => candidate.id === organizationId
      );
      if (!organization) return unavailable("organization");

      const publication = seed.publications.find(
        (candidate) =>
          candidate.id === publicationId && candidate.orgId === organization.id
      );
      return publication
        ? success(cloneRecord(publication))
        : unavailable("publication");
    },

    async getEdition({ organizationId, publicationId, editionId }) {
      const intercepted = await scenarioResult<EditionDto>("edition.get");
      if (intercepted) return intercepted;

      const organization = seed.organizations.find(
        (candidate) => candidate.id === organizationId
      );
      if (!organization) return unavailable("organization");

      const publication = seed.publications.find(
        (candidate) =>
          candidate.id === publicationId && candidate.orgId === organization.id
      );
      if (!publication) return unavailable("publication");

      const edition = seed.editions.find(
        (candidate) =>
          candidate.id === editionId && candidate.publicationId === publication.id
      );
      return edition ? success(cloneRecord(edition)) : unavailable("edition");
    },
  };

  const scenarios: MockScenarioController = {
    setScenario(nextScenario) {
      validateScenario(nextScenario);
      scenario = copyScenario(nextScenario);
    },

    getScenario() {
      return copyScenario(scenario);
    },

    reset() {
      seed = createCanonicalSeed();
      scenario = { mode: "normal" };
    },
  };

  return { users, workspace, scenarios };
}
