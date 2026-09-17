export const MOCK_OPERATIONS = [
  "user.get",
  "organization.list",
  "organization.get",
  "publication.list",
  "publication.get",
  "edition.get",
] as const;

export type MockOperation = (typeof MOCK_OPERATIONS)[number];

export type MockScenario =
  | { readonly mode: "normal" }
  | {
      readonly mode: "latency";
      readonly delayMs: number;
      readonly operations?: readonly MockOperation[];
    }
  | {
      readonly mode: "failure";
      readonly operations?: readonly MockOperation[];
    }
  | {
      readonly mode: "denial";
      readonly operations?: readonly MockOperation[];
    };

export interface MockScenarioController {
  setScenario(scenario: MockScenario): void;
  getScenario(): MockScenario;
  reset(): void;
}

const OPERATION_SET = new Set<string>(MOCK_OPERATIONS);

export function validateScenario(scenario: MockScenario): void {
  const candidate = scenario as MockScenario & Record<string, unknown>;
  if (!candidate || typeof candidate !== "object") {
    throw new TypeError("Mock scenario must be an object.");
  }

  if (!(["normal", "latency", "failure", "denial"] as const).includes(candidate.mode)) {
    throw new TypeError("Unknown mock scenario mode.");
  }

  if (candidate.mode === "normal") {
    if ("delayMs" in candidate || "operations" in candidate) {
      throw new TypeError("Normal mode does not accept delay or operation targeting.");
    }
    return;
  }

  if (candidate.operations !== undefined) {
    if (
      !Array.isArray(candidate.operations) ||
      candidate.operations.some((operation) => !OPERATION_SET.has(String(operation)))
    ) {
      throw new TypeError("Mock scenario contains an unknown operation.");
    }
  }

  if (candidate.mode === "latency") {
    if (
      !Number.isFinite(candidate.delayMs) ||
      !Number.isInteger(candidate.delayMs) ||
      candidate.delayMs < 0 ||
      candidate.delayMs > 10_000
    ) {
      throw new RangeError("Latency delayMs must be an integer from 0 through 10000.");
    }
  } else if ("delayMs" in candidate) {
    throw new TypeError("Only latency mode accepts delayMs.");
  }
}

export function copyScenario(scenario: MockScenario): MockScenario {
  if (scenario.mode === "normal") {
    return { mode: "normal" };
  }
  if (scenario.mode === "latency") {
    return {
      mode: "latency",
      delayMs: scenario.delayMs,
      ...(scenario.operations ? { operations: [...scenario.operations] } : {}),
    };
  }
  return {
    mode: scenario.mode,
    ...(scenario.operations ? { operations: [...scenario.operations] } : {}),
  };
}

export function scenarioApplies(scenario: MockScenario, operation: MockOperation): boolean {
  if (scenario.mode === "normal") {
    return false;
  }
  return scenario.operations === undefined || scenario.operations.includes(operation);
}
